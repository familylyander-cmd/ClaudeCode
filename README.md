# Bostadsbevakning – Booli, Stockholms innerstad

> **Android-app utan Termux:** se [android-app/README.md](android-app/README.md). Nedan beskrivs Python-versionen (dator eller Termux).

Sparar Booli-objekt som uppfyller:

- Lägenhet i Stockholms innerstad
- minst 70 kvm, minst 3 rum
- utgångspris högst 13 000 000 kr

Objekten ligger kvar efter försäljning och slutpris sparas. Lista, karta (blå = till salu, orange = såld, grå = borttagen utan känt slutpris) och statistik över sålda objekt.

## Starta

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m booli_saver.app        # http://127.0.0.1:5000
```

## Köra på Android-mobil (Termux)

Appen körs direkt på mobilen – ingen dator eller server behövs.

1. Installera från **F-Droid** (inte Google Play – den versionen är föråldrad):
   **Termux**, **Termux:API** (för automatisk synk) och gärna **Termux:Widget** (genväg på hemskärmen).
2. Öppna Termux och kör:
   ```bash
   pkg install -y git
   git clone -b claude/booli-stockholm-apartment-saver-raa0mp https://github.com/familylyander-cmd/ClaudeCode.git ~/bostader
   bash ~/bostader/termux/setup.sh
   ```
   Är repot privat frågar git efter användarnamn och en *personal access token* (inte lösenord).
3. Starta: `bash ~/bostader/termux/start.sh` – appen öppnas i webbläsaren på http://127.0.0.1:5000.
4. I Chrome: meny ⋮ → **Lägg till på startskärmen** för en app-ikon. Termux måste köra (steg 3) för att ikonen ska fungera.

`setup.sh` installerar Python och Flask, skapar Termux:Widget-genvägarna *Bostadsbevakning*, *Synka Booli* och *Stoppa bostadsappen*, och schemalägger synk från Booli var 6:e timme (även när appen inte är öppen). Synklogg: `~/bostader/data/sync.log`.

Uppdatera till senaste versionen: `cd ~/bostader && git pull`.

Tips: undanta Termux från batterioptimering (Inställningar → Appar → Termux → Batteri → Obegränsad), annars kan Android stoppa appen och den schemalagda synken.

## Uppdatera data

- Knappen **Uppdatera från Booli** i appen, eller
- `python -m booli_saver.sync` via cron, t.ex. `0 7,19 * * * cd /sökväg && .venv/bin/python -m booli_saver.sync`, eller
- `BOOLI_SYNC_INTERVAL=360` (minuter) för synk i bakgrunden när appen kör.

Synken:
1. Hämtar söksidan för till salu (`/sok/till-salu`) och sparar matchande objekt.
2. Objekt som inte längre syns markeras *borttagna*.
3. Hämtar slutprissidan (`/sok/slutpriser`) och matchar mot sparade objekt (Booli-id, annars adress + boarea).
4. Besöker annonssidan för borttagna objekt och letar efter slutpris.

Slutpris kan också anges manuellt (knappen *Ange slutpris*), och sidor kan importeras via URL eller inklistrad HTML (**Importera…**) om Booli blockerar serverns anrop.

## Inställningar (miljövariabler)

| Variabel | Standard | |
|---|---|---|
| `BOOLI_AREA_ID` | `115355` | Booli-områdes-id för Stockholms innerstad – **verifiera** genom att söka på booli.se och kopiera `areaIds` från URL:en |
| `BOOLI_MIN_AREA` / `BOOLI_MIN_ROOMS` / `BOOLI_MAX_PRICE` | 70 / 3 / 13000000 | Kriterier |
| `BOOLI_DB` | `data/booli.db` | SQLite-fil |
| `BOOLI_SYNC_INTERVAL` | 0 | Bakgrundssynk i minuter |

## Begränsningar

- Booli har inget öppet API. Appen läser JSON som Booli bäddar in i sidorna (`__NEXT_DATA__`). Parsern är skriven för att tåla formatändringar, men är **inte testad mot riktiga Booli-sidor** (booli.se var inte nåbart i utvecklingsmiljön). Kontrollera första körningen.
- Kontrollera Boolis användarvillkor; håll synkfrekvensen låg.
- Innerstad avgörs av område-id samt postnummer 111–118 när postnummer finns.

## Tester

```bash
.venv/bin/pip install pytest && .venv/bin/python -m pytest
```
