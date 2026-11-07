#!/data/data/com.termux/files/usr/bin/bash
# Startar appen i bakgrunden och öppnar den i webbläsaren.
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$DIR" || exit 1
mkdir -p data
command -v termux-wake-lock >/dev/null && termux-wake-lock   # hindrar Android från att stänga appen

if ! curl -s -o /dev/null http://127.0.0.1:5000/api/status; then
  nohup python -m booli_saver.app >> data/server.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -s -o /dev/null http://127.0.0.1:5000/api/status && break
    sleep 0.5
  done
fi
termux-open-url http://127.0.0.1:5000 2>/dev/null || echo "Öppna http://127.0.0.1:5000 i webbläsaren"
