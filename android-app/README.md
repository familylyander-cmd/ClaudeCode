# Bostadsbevakning – Android-app

Fristående Android-app (ingen Termux eller server). Sparar lägenheter i Stockholms innerstad från Booli
(≥ 70 kvm, ≥ 3 rum, utgångspris ≤ 13 mkr), behåller dem efter försäljning med slutpris, och visar
lista, karta (blå = till salu, orange = såld) och statistik.

## Installera

1. Öppna repots **Releases → "Bostadsbevakning – senaste Android-version"** på mobilen och ladda ned `Bostadsbevakning.apk`.
2. Öppna filen. Android frågar om du vill tillåta installation från webbläsaren – godkänn.
3. Nya versioner installeras på samma sätt, ovanpå den gamla; sparade objekt ligger kvar.

## Använda

1. Tryck **Öppna Booli** → *Till salu – sökning med kriterierna*. Booli öppnas i appens inbyggda webbläsare.
   Du surfar som vanligt (och klarar själv eventuella robotkontroller).
2. Tryck **Spara objekten på sidan** längst ned. Bläddra till nästa sida i sökresultatet och tryck igen.
3. För slutpriser: *Slutpriser – sökning med kriterierna*, eller tryck på ett objekts adress i listan för att
   öppna annonsen, och tryck **Spara objekten på sidan**. Sålda objekt matchas på Booli-id, annars adress + boarea.
4. Slutpris kan också anges för hand (**Ange slutpris**).

**Mer…** innehåller område-id för sökningen (verifiera `areaIds` för Stockholms innerstad på booli.se),
export av säkerhetskopia och import (även JSON från datorappens `/api/listings`).

Inget hämtas automatiskt i bakgrunden – appen läser bara sidor du själv öppnar.

## Utveckling

```bash
npm install
npm test                      # tester för tolkning, kriterier och statistik
npx cap sync android
cd android && ./gradlew assembleDebug   # kräver JDK 21 och Android SDK 36
```

- `www/core.js` – tolkning av Booli-sidor, kriterier, statistik (testas i Node)
- `www/app.js`, `www/index.html` – gränssnitt; data sparas med Capacitor Preferences
- `android/app/src/main/java/.../BooliBrowserActivity.java` – inbyggd webbläsare med spara-knapp
- `.github/workflows/android.yml` – bygger APK och publicerar den som release vid varje push

APK:n signeras med `android/app/bostadsbevakning.keystore` (lösenord `android`) så att uppdateringar kan
installeras ovanpå varandra. Nyckeln är bara för privat sidladdning, inte Google Play.
