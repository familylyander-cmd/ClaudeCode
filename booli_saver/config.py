"""Sökkriterier och inställningar. Kan överstyras med miljövariabler."""
import os

MIN_LIVING_AREA = float(os.environ.get("BOOLI_MIN_AREA", 70))
MIN_ROOMS = float(os.environ.get("BOOLI_MIN_ROOMS", 3))
MAX_LIST_PRICE = int(os.environ.get("BOOLI_MAX_PRICE", 13_000_000))

# Booli-område för Stockholms innerstad. Verifiera id:t genom att söka
# "Stockholms innerstad" på booli.se och kopiera areaIds från URL:en.
AREA_ID = os.environ.get("BOOLI_AREA_ID", "115355")

# Postnummer 111-118 = Stockholms innerstad. Används som extra filter
# när postnummer finns i datat.
INNERSTAD_ZIP_PREFIXES = ("111", "112", "113", "114", "115", "116", "117", "118")

DB_PATH = os.environ.get(
    "BOOLI_DB", os.path.join(os.path.dirname(__file__), "..", "data", "booli.db")
)

# Automatisk synk i bakgrunden (minuter). 0 = av.
SYNC_INTERVAL_MIN = int(os.environ.get("BOOLI_SYNC_INTERVAL", 0))

USER_AGENT = os.environ.get(
    "BOOLI_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36",
)


def search_url(sold: bool, page: int = 1) -> str:
    base = "https://www.booli.se/sok/slutpriser" if sold else "https://www.booli.se/sok/till-salu"
    params = [
        f"areaIds={AREA_ID}",
        "objectType=L%C3%A4genhet",
        f"minLivingArea={int(MIN_LIVING_AREA)}",
        f"minRooms={int(MIN_ROOMS)}",
    ]
    if not sold:
        params.append(f"maxListPrice={MAX_LIST_PRICE}")
    if page > 1:
        params.append(f"page={page}")
    return base + "?" + "&".join(params)
