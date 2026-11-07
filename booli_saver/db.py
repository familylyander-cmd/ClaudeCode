from __future__ import annotations

import os
import re
import sqlite3
from datetime import date

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    booli_id     TEXT PRIMARY KEY,
    address      TEXT,
    area_name    TEXT,
    zip          TEXT,
    lat          REAL,
    lng          REAL,
    living_area  REAL,
    rooms        REAL,
    floor        REAL,
    rent         REAL,
    object_type  TEXT,
    list_price   REAL,
    first_list_price REAL,
    sold_price   REAL,
    sold_date    TEXT,
    published    TEXT,
    url          TEXT,
    status       TEXT NOT NULL DEFAULT 'for_sale',  -- for_sale | removed | sold
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    note         TEXT
);
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ok INTEGER NOT NULL,
    message TEXT
);
"""

FIELDS = ("address", "area_name", "zip", "lat", "lng", "living_area", "rooms",
          "floor", "rent", "object_type", "published", "url")


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or config.DB_PATH
    if path != ":memory:":
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    con = sqlite3.connect(path, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def matches_criteria(o: dict) -> bool:
    if o.get("living_area") is None or o["living_area"] < config.MIN_LIVING_AREA:
        return False
    if o.get("rooms") is None or o["rooms"] < config.MIN_ROOMS:
        return False
    if o.get("list_price") is not None and o["list_price"] > config.MAX_LIST_PRICE:
        return False
    t = (o.get("object_type") or "").lower()
    if t and "lägenhet" not in t and "apartment" not in t:
        return False
    z = o.get("zip")
    if z and not z.startswith(config.INNERSTAD_ZIP_PREFIXES):
        return False
    return True


def _today() -> str:
    return date.today().isoformat()


def upsert_for_sale(con: sqlite3.Connection, o: dict, today: str | None = None) -> bool:
    """Sparar/uppdaterar ett objekt till salu. Returnerar True om nytt."""
    today = today or _today()
    row = con.execute("SELECT * FROM listings WHERE booli_id=?", (o["booli_id"],)).fetchone()
    if row is None:
        cols = ("booli_id",) + FIELDS + ("list_price", "first_list_price", "status", "first_seen", "last_seen")
        vals = [o["booli_id"]] + [o.get(f) for f in FIELDS] + [
            o.get("list_price"), o.get("list_price"), "for_sale", today, today]
        con.execute(f"INSERT INTO listings ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
        return True
    sets = {f: o[f] for f in FIELDS if o.get(f) is not None}
    if o.get("list_price") is not None:
        sets["list_price"] = o["list_price"]
    sets["last_seen"] = today
    if row["status"] != "sold":
        sets["status"] = "for_sale"
    con.execute(
        f"UPDATE listings SET {','.join(k + '=?' for k in sets)} WHERE booli_id=?",
        [*sets.values(), o["booli_id"]],
    )
    return False


def _norm_addr(a: str | None) -> str:
    return re.sub(r"[^a-zåäö0-9]", "", (a or "").lower())


def find_match(con: sqlite3.Connection, sold: dict) -> sqlite3.Row | None:
    row = con.execute("SELECT * FROM listings WHERE booli_id=?", (sold["booli_id"],)).fetchone()
    if row:
        return row
    addr = _norm_addr(sold.get("address"))
    if not addr:
        return None
    for r in con.execute("SELECT * FROM listings WHERE status != 'sold'"):
        if _norm_addr(r["address"]) != addr:
            continue
        if sold.get("living_area") and r["living_area"] and abs(sold["living_area"] - r["living_area"]) > 2:
            continue
        return r
    return None


def mark_sold(con: sqlite3.Connection, booli_id: str, price: float, sold_date: str | None,
              today: str | None = None) -> None:
    con.execute(
        "UPDATE listings SET status='sold', sold_price=?, sold_date=COALESCE(?, sold_date, ?) WHERE booli_id=?",
        (price, sold_date, today or _today(), booli_id),
    )


def mark_missing_removed(con: sqlite3.Connection, seen_ids: set[str]) -> int:
    """Objekt som inte längre syns bland till salu men saknar slutpris."""
    n = 0
    for r in con.execute("SELECT booli_id FROM listings WHERE status='for_sale'").fetchall():
        if r["booli_id"] not in seen_ids:
            con.execute("UPDATE listings SET status='removed' WHERE booli_id=?", (r["booli_id"],))
            n += 1
    return n


def all_listings(con: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in con.execute("SELECT * FROM listings ORDER BY first_seen DESC, booli_id")]


def log_sync(con: sqlite3.Connection, ok: bool, msg: str) -> None:
    from datetime import datetime
    con.execute("INSERT INTO sync_log (ts, ok, message) VALUES (?,?,?)",
                (datetime.now().isoformat(timespec="seconds"), int(ok), msg))
    con.commit()


def last_sync(con: sqlite3.Connection) -> dict | None:
    r = con.execute("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").fetchone()
    return dict(r) if r else None
