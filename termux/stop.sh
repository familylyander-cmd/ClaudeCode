#!/data/data/com.termux/files/usr/bin/bash
pkill -f "python -m booli_saver.app" && echo "Appen stoppad."
command -v termux-wake-unlock >/dev/null && termux-wake-unlock
