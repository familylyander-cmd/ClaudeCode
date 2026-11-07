import json

from booli_saver import app as app_mod, db, parser, stats, sync


def page(objs):
    data = {"props": {"pageProps": {"__APOLLO_STATE__": {
        f"Listing:{o['booliId']}": o for o in objs}}}}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></html>'


def listing(bid, price=12_000_000, area=75, rooms=3, addr="Testgatan 1", zip_="11346", **kw):
    return {"booliId": bid, "streetAddress": addr, "descriptiveAreaName": "Vasastan",
            "latitude": 59.34, "longitude": 18.05, "postcode": zip_,
            "livingArea": {"raw": area, "formatted": f"{area} m²"}, "rooms": {"raw": rooms},
            "listPrice": {"raw": price, "formatted": "x"}, "objectType": "Lägenhet",
            "url": f"/annons/{bid}", "published": "2026-10-01 10:00:00", **kw}


def test_parse_and_criteria():
    items = parser.parse_page(page([
        listing(1), listing(2, price=14_000_000), listing(3, area=60),
        listing(4, rooms=2), listing(5, zip_="12030"), listing(6, objectType="Villa"),
    ]))
    ok = {i["booli_id"] for i in items if db.matches_criteria(i)}
    assert ok == {"1"}
    one = next(i for i in items if i["booli_id"] == "1")
    assert one["url"] == "https://www.booli.se/annons/1"
    assert one["published"] == "2026-10-01"


def test_sync_lifecycle():
    con = db.connect(":memory:")
    pages = {
        "for1": page([listing(1), listing(2, addr="Annan gatan 5")]),
        "sold1": page([]),
    }

    def fetcher(url):
        if "till-salu" in url:
            return pages["for1"] if "page=" not in url else page([])
        if "slutpriser" in url:
            return pages["sold1"] if "page=" not in url else page([])
        return page([])

    sync.run(con, fetcher)
    assert {l["status"] for l in db.all_listings(con)} == {"for_sale"}

    # Objekt 1 försvinner och dyker upp som sålt (annat id, matchas på adress)
    pages["for1"] = page([listing(2, addr="Annan gatan 5")])
    pages["sold1"] = page([{"booliId": 999, "streetAddress": "Testgatan 1", "latitude": 59.34,
                            "longitude": 18.05, "livingArea": 75, "soldPrice": {"raw": 12_600_000},
                            "soldDate": "2026-11-01"}])
    sync.run(con, fetcher)
    by = {l["booli_id"]: l for l in db.all_listings(con)}
    assert by["1"]["status"] == "sold"
    assert by["1"]["sold_price"] == 12_600_000
    assert by["1"]["sold_date"] == "2026-11-01"
    assert by["2"]["status"] == "for_sale"

    s = stats.compute(db.all_listings(con))
    assert s["counts"] == {"for_sale": 1, "removed": 0, "sold": 1}
    assert round(s["sold"]["avg_diff_pct"], 1) == 5.0
    assert s["sold"]["median_days_to_sale"] == 31
    assert s["by_area"][0]["area"] == "Vasastan"


def test_removed_then_sold_via_listing_page():
    con = db.connect(":memory:")
    state = {"for": page([listing(7)])}

    def fetcher(url):
        if "till-salu" in url:
            return state["for"] if "page=" not in url else page([])
        if "/annons/7" in url:
            return page([{**listing(7), "soldPrice": 11_900_000, "soldDate": "2026-11-05"}])
        return page([])

    sync.run(con, fetcher)
    state["for"] = page([listing(8)])
    sync.run(con, fetcher)
    by = {l["booli_id"]: l for l in db.all_listings(con)}
    assert by["7"]["status"] == "sold" and by["7"]["sold_price"] == 11_900_000


def test_api(tmp_path, monkeypatch):
    monkeypatch.setattr(app_mod, "_con", db.connect(str(tmp_path / "t.db")))
    c = app_mod.app.test_client()
    r = c.post("/api/import", json={"html": page([listing(1)])})
    assert r.json["ok"]
    assert len(c.get("/api/listings").json) == 1
    assert c.patch("/api/listings/1", json={"sold_price": 13_000_000}).json["ok"]
    s = c.get("/api/stats").json
    assert s["counts"]["sold"] == 1
    assert c.get("/").status_code == 200
