"""Hämtar objekt från Booli och uppdaterar databasen.

Kör manuellt eller via cron:  python -m booli_saver.sync
"""
from __future__ import annotations

import gzip
import sys
import time
import urllib.request

from . import config, db, parser

MAX_PAGES = 30
MAX_SOLD_PAGES = 5


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": config.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "sv-SE,sv;q=0.9",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return body.decode("utf-8", errors="replace")


def _pages(sold: bool, max_pages: int, fetcher) -> list[dict]:
    seen: dict[str, dict] = {}
    for page in range(1, max_pages + 1):
        items = parser.parse_page(fetcher(config.search_url(sold, page)))
        new = [i for i in items if i["booli_id"] not in seen]
        if not new:
            break
        for i in new:
            seen[i["booli_id"]] = i
        time.sleep(0.5 if fetcher is fetch else 0)
    return list(seen.values())


def apply_for_sale(con, items: list[dict]) -> tuple[int, set[str]]:
    new, ids = 0, set()
    for o in items:
        if o.get("sold_price") is not None or not db.matches_criteria(o):
            continue
        ids.add(o["booli_id"])
        new += db.upsert_for_sale(con, o)
    return new, ids


def apply_sold(con, items: list[dict]) -> int:
    n = 0
    for s in items:
        if s.get("sold_price") is None:
            continue
        row = db.find_match(con, s)
        if row is not None and row["status"] != "sold":
            db.mark_sold(con, row["booli_id"], s["sold_price"], s.get("sold_date"))
            n += 1
    return n


def check_removed(con, fetcher) -> int:
    """Besök annonssidan för objekt som försvunnit – visar den slutpris?"""
    n = 0
    rows = con.execute("SELECT booli_id, url FROM listings WHERE status='removed' AND url IS NOT NULL").fetchall()
    for r in rows:
        try:
            items = parser.parse_page(fetcher(r["url"]))
        except Exception:
            continue
        for s in items:
            if s.get("sold_price") is not None and (s["booli_id"] == r["booli_id"] or len(items) == 1):
                db.mark_sold(con, r["booli_id"], s["sold_price"], s.get("sold_date"))
                n += 1
                break
    return n


def run(con=None, fetcher=fetch) -> str:
    con = con or db.connect()
    try:
        for_sale = _pages(False, MAX_PAGES, fetcher)
        if not for_sale:
            raise RuntimeError("Inga objekt hittades på söksidan – kontrollera AREA_ID eller om Booli ändrat format.")
        new, ids = apply_for_sale(con, for_sale)
        removed = db.mark_missing_removed(con, ids)
        sold = apply_sold(con, _pages(True, MAX_SOLD_PAGES, fetcher))
        sold += check_removed(con, fetcher)
        con.commit()
        msg = f"{len(ids)} till salu ({new} nya), {removed} borttagna, {sold} nya sålda"
        db.log_sync(con, True, msg)
        return msg
    except Exception as e:  # noqa: BLE001
        con.rollback()
        db.log_sync(con, False, f"{type(e).__name__}: {e}")
        raise


if __name__ == "__main__":
    try:
        print(run())
    except Exception as e:  # noqa: BLE001
        print(f"Synk misslyckades: {e}", file=sys.stderr)
        sys.exit(1)
