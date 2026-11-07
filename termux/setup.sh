#!/data/data/com.termux/files/usr/bin/bash
# Engångsinstallation i Termux. Kör:  bash termux/setup.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

pkg update -y
pkg install -y python curl termux-api
pip install -r "$DIR/requirements.txt"
chmod +x "$DIR"/termux/*.sh

# Genvägar för Termux:Widget (hemskärmswidget)
mkdir -p ~/.shortcuts
ln -sf "$DIR/termux/start.sh" ~/.shortcuts/Bostadsbevakning
ln -sf "$DIR/termux/sync.sh"  ~/.shortcuts/"Synka Booli"
ln -sf "$DIR/termux/stop.sh"  ~/.shortcuts/"Stoppa bostadsappen"

# Automatisk synk var 6:e timme när mobilen har nät (kräver appen Termux:API)
if command -v termux-job-scheduler >/dev/null; then
  termux-job-scheduler --job-id 4711 --script "$DIR/termux/sync.sh" \
    --period-ms 21600000 --network any --persisted true \
    || echo "Kunde inte schemalägga synk – är appen Termux:API installerad?"
fi

echo
echo "Klart! Starta appen med:  bash $DIR/termux/start.sh"
