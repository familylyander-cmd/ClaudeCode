"""Tolkar Booli-sidor till objekt.

Booli.se är en Next.js-app; söksidor och annonssidor bäddar in data som JSON
i <script id="__NEXT_DATA__">. Den exakta strukturen är inte dokumenterad och
kan ändras, därför letar parsern generellt efter JSON-objekt som ser ut som
bostäder (har booliId + koordinater) och provar flera fältnamn.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable

NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL
)


def _raw(v: Any) -> Any:
    """Booli lagrar ofta värden som {"raw": 123, "formatted": "123 kr"}."""
    if isinstance(v, dict):
        for k in ("raw", "value", "amount"):
            if k in v:
                return v[k]
        if "formatted" in v:
            return v["formatted"]
        return None
    return v


def _num(v: Any) -> float | None:
    v = _raw(v)
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.replace("\xa0", "").replace(" ", "").replace(",", ".")
        m = re.search(r"-?\d+(\.\d+)?", s)
        return float(m.group(0)) if m else None
    return None


def _first(d: dict, *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _date(v: Any) -> str | None:
    v = _raw(v)
    if not v:
        return None
    if isinstance(v, (int, float)):  # epoch
        import datetime as dt
        ts = v / 1000 if v > 1e11 else v
        return dt.datetime.fromtimestamp(ts, dt.UTC).date().isoformat()
    m = re.search(r"\d{4}-\d{2}-\d{2}", str(v))
    return m.group(0) if m else None


def _walk(node: Any) -> Iterable[dict]:
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def extract_next_data(html: str) -> Any:
    m = NEXT_DATA_RE.search(html)
    if not m:
        raise ValueError("Hittade ingen __NEXT_DATA__ i sidan (Booli kan ha ändrat format).")
    return json.loads(m.group(1))


def _location(d: dict) -> tuple[float | None, float | None]:
    lat = _num(_first(d, "latitude", "lat"))
    lng = _num(_first(d, "longitude", "lng", "lon"))
    if lat is None or lng is None:
        for key in ("location", "position", "coordinates", "point"):
            sub = d.get(key)
            if isinstance(sub, dict):
                lat = lat if lat is not None else _num(_first(sub, "latitude", "lat"))
                lng = lng if lng is not None else _num(_first(sub, "longitude", "lng", "lon"))
                pos = sub.get("position")
                if isinstance(pos, dict):
                    lat = lat if lat is not None else _num(_first(pos, "latitude", "lat"))
                    lng = lng if lng is not None else _num(_first(pos, "longitude", "lng", "lon"))
    return lat, lng


def _address(d: dict) -> str | None:
    a = _first(d, "streetAddress", "address")
    if isinstance(a, dict):
        a = _first(a, "streetAddress", "street", "formatted")
    if a is None and isinstance(d.get("location"), dict):
        loc = d["location"]
        addr = loc.get("address")
        if isinstance(addr, dict):
            a = _first(addr, "streetAddress", "street")
    return str(a) if a else None


def _area_name(d: dict) -> str | None:
    n = _first(d, "descriptiveAreaName", "areaName", "neighbourhood", "district")
    if n is None and isinstance(d.get("location"), dict):
        loc = d["location"]
        named = loc.get("namedAreas")
        if isinstance(named, list) and named:
            n = named[0] if isinstance(named[0], str) else _first(named[0], "name")
    return str(_raw(n)) if n else None


def _zip(d: dict) -> str | None:
    z = _first(d, "postcode", "zipCode", "postalCode")
    if z is None:
        for key in ("location", "address"):
            sub = d.get(key)
            if isinstance(sub, dict):
                z = _first(sub, "postcode", "zipCode", "postalCode")
                if z is None and isinstance(sub.get("address"), dict):
                    z = _first(sub["address"], "postcode", "zipCode", "postalCode")
            if z:
                break
    z = _raw(z)
    return re.sub(r"\D", "", str(z)) if z else None


def normalize(d: dict) -> dict | None:
    """Gör om ett rått Booli-objekt till vårt format, eller None om det inte är en bostad."""
    bid = _first(d, "booliId", "id")
    if bid is None:
        return None
    lat, lng = _location(d)
    if lat is None or lng is None:
        return None
    sold_price = _num(_first(d, "soldPrice", "finalPrice"))
    list_price = _num(_first(d, "listPrice", "price", "askingPrice"))
    if sold_price is None and list_price is None:
        return None
    url = _first(d, "url", "listingUrl")
    if url and str(url).startswith("/"):
        url = "https://www.booli.se" + url
    obj_type = _raw(_first(d, "objectType", "propertyType", "type"))
    return {
        "booli_id": str(_raw(bid)),
        "address": _address(d),
        "area_name": _area_name(d),
        "zip": _zip(d),
        "lat": lat,
        "lng": lng,
        "living_area": _num(_first(d, "livingArea", "area")),
        "rooms": _num(_first(d, "rooms", "numberOfRooms")),
        "floor": _num(_first(d, "floor")),
        "rent": _num(_first(d, "rent", "monthlyFee", "fee")),
        "object_type": str(obj_type) if obj_type else None,
        "list_price": list_price,
        "sold_price": sold_price,
        "sold_date": _date(_first(d, "soldDate", "dateSold")),
        "published": _date(_first(d, "published", "publishedDate", "firstPublished")),
        "url": str(url) if url else None,
    }


def parse_page(html: str) -> list[dict]:
    """Returnerar alla bostadsobjekt i en Booli-sida (dubbletter borttagna)."""
    data = extract_next_data(html)
    out: dict[str, dict] = {}
    for node in _walk(data):
        if "booliId" not in node:
            continue
        obj = normalize(node)
        if obj is None:
            continue
        prev = out.get(obj["booli_id"])
        if prev is None:
            out[obj["booli_id"]] = obj
        else:  # slå ihop – behåll icke-tomma fält
            for k, v in obj.items():
                if prev.get(k) in (None, "") and v not in (None, ""):
                    prev[k] = v
    return list(out.values())
