from __future__ import annotations

from collections import defaultdict
from datetime import date
from statistics import mean, median


def _days(a: str | None, b: str | None) -> int | None:
    try:
        return (date.fromisoformat(b) - date.fromisoformat(a)).days
    except (TypeError, ValueError):
        return None


def compute(listings: list[dict]) -> dict:
    sold = [l for l in listings if l["status"] == "sold" and l.get("sold_price")]
    out = {
        "counts": {
            "for_sale": sum(l["status"] == "for_sale" for l in listings),
            "removed": sum(l["status"] == "removed" for l in listings),
            "sold": len(sold),
        },
        "sold": None, "by_area": [], "by_month": [],
    }
    if not sold:
        return out

    def ppsqm(l):
        return l["sold_price"] / l["living_area"] if l.get("living_area") else None

    def diff(l):
        base = l.get("first_list_price") or l.get("list_price")
        return (l["sold_price"] / base - 1) * 100 if base else None

    prices = [l["sold_price"] for l in sold]
    sqm = [v for v in map(ppsqm, sold) if v]
    diffs = [v for v in map(diff, sold) if v is not None]
    days = [d for d in (_days(l.get("published") or l["first_seen"], l.get("sold_date")) for l in sold)
            if d is not None and d >= 0]
    out["sold"] = {
        "avg_price": mean(prices), "median_price": median(prices),
        "min_price": min(prices), "max_price": max(prices),
        "avg_sqm_price": mean(sqm) if sqm else None,
        "median_sqm_price": median(sqm) if sqm else None,
        "avg_diff_pct": mean(diffs) if diffs else None,
        "share_over_list_pct": 100 * sum(d > 0 for d in diffs) / len(diffs) if diffs else None,
        "median_days_to_sale": median(days) if days else None,
    }

    groups = defaultdict(list)
    for l in sold:
        groups[l.get("area_name") or "Okänt"].append(l)
    out["by_area"] = sorted(({
        "area": a, "count": len(ls),
        "median_sqm_price": median([v for v in map(ppsqm, ls) if v] or [0]),
        "avg_diff_pct": mean([v for v in map(diff, ls) if v is not None] or [0]),
    } for a, ls in groups.items()), key=lambda x: -x["count"])

    months = defaultdict(list)
    for l in sold:
        if l.get("sold_date"):
            months[l["sold_date"][:7]].append(l)
    out["by_month"] = [{
        "month": m, "count": len(ls),
        "median_price": median([l["sold_price"] for l in ls]),
        "median_sqm_price": median([v for v in map(ppsqm, ls) if v] or [0]),
    } for m, ls in sorted(months.items())]
    return out
