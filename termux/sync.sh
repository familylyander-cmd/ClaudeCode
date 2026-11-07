#!/data/data/com.termux/files/usr/bin/bash
# Hämtar från Booli. Körs av termux-job-scheduler eller manuellt.
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$DIR" || exit 1
mkdir -p data
{ date "+%F %T"; python -m booli_saver.sync 2>&1; } >> data/sync.log
tail -n 1 data/sync.log
