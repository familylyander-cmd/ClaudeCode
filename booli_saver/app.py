from __future__ import annotations

import threading
import time

from flask import Flask, jsonify, request, send_from_directory

from . import config, db, parser, stats, sync

app = Flask(__name__, static_folder="static")
_con = None
_lock = threading.Lock()


def con():
    global _con
    if _con is None:
        _con = db.connect()
    return _con


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/manifest.json")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json", mimetype="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    r = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/api/listings")
def listings():
    with _lock:
        return jsonify(db.all_listings(con()))


@app.get("/api/stats")
def get_stats():
    with _lock:
        return jsonify(stats.compute(db.all_listings(con())))


@app.get("/api/status")
def status():
    with _lock:
        return jsonify({
            "last_sync": db.last_sync(con()),
            "criteria": {
                "min_area": config.MIN_LIVING_AREA, "min_rooms": config.MIN_ROOMS,
                "max_price": config.MAX_LIST_PRICE, "area_id": config.AREA_ID,
                "search_url": config.search_url(False),
            },
        })


@app.post("/api/sync")
def run_sync():
    with _lock:
        try:
            return jsonify({"ok": True, "message": sync.run(con())})
        except Exception as e:  # noqa: BLE001
            return jsonify({"ok": False, "message": str(e)}), 502


@app.post("/api/import")
def import_page():
    """Importera objekt från en Booli-URL eller inklistrad HTML (om hämtning blockeras)."""
    body = request.get_json(force=True)
    try:
        html = body.get("html") or sync.fetch(body["url"])
        items = parser.parse_page(html)
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "message": str(e)}), 400
    with _lock:
        c = con()
        added, sold = 0, 0
        for o in items:
            if o.get("sold_price") is not None:
                row = db.find_match(c, o)
                if row is not None:
                    db.mark_sold(c, row["booli_id"], o["sold_price"], o.get("sold_date"))
                    sold += 1
            elif db.matches_criteria(o):
                added += db.upsert_for_sale(c, o)
        c.commit()
    return jsonify({"ok": True, "message": f"{len(items)} objekt i sidan, {added} nya, {sold} markerade sålda"})


@app.patch("/api/listings/<booli_id>")
def update_listing(booli_id):
    """Manuell inmatning av slutpris eller anteckning."""
    body = request.get_json(force=True)
    with _lock:
        c = con()
        if c.execute("SELECT 1 FROM listings WHERE booli_id=?", (booli_id,)).fetchone() is None:
            return jsonify({"ok": False, "message": "Finns inte"}), 404
        if body.get("sold_price"):
            db.mark_sold(c, booli_id, float(body["sold_price"]), body.get("sold_date") or None)
        if "note" in body:
            c.execute("UPDATE listings SET note=? WHERE booli_id=?", (body["note"], booli_id))
        c.commit()
    return jsonify({"ok": True})


@app.delete("/api/listings/<booli_id>")
def delete_listing(booli_id):
    with _lock:
        con().execute("DELETE FROM listings WHERE booli_id=?", (booli_id,))
        con().commit()
    return jsonify({"ok": True})


def _background():
    while True:
        time.sleep(config.SYNC_INTERVAL_MIN * 60)
        with _lock:
            try:
                sync.run(con())
            except Exception:  # noqa: BLE001
                pass  # loggas i sync_log


def main():
    if config.SYNC_INTERVAL_MIN > 0:
        threading.Thread(target=_background, daemon=True).start()
    app.run(host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
