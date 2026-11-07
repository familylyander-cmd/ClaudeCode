# Bostadsbevakning – Android-app

Fristående Android-app (ingen Termux eller server). Sparar lägenheter i Stockholms innerstad från Booli
(≥ 70 kvm, ≥ 3 rum, utgångspris ≤ 13 mkr), behåller dem efter försäljning med slutpris, och visar
lista, karta (blå = till salu, orange = såld) och statistik.

## Installera

1. Öppna repots **Releases → "Bostadsbevakning – senaste Android-version"** på mobilen och ladda ned `Bostadsbevakning.apk`.
2. Öppna filen. Android frågar om du vill tillåta installation från webbläsaren – godkänn.
3. Nya versioner installeras på samma sätt, ovanpå den gamla; sparade objekt ligger kvar.

## Använda

1. Tryck **Uppdatera från Booli** → **Hämta nya objekt och slutpriser**. Booli öppnas i appens inbyggda webbläsare.
2. Vänta tills sidan har laddat. Visar Booli en robotkontroll klarar du den själv.
3. Tryck på den blå knappen **Hämta objekt (7 områden)**. Appen gör då samma anrop som Boolis egen
   sida (`/graphql`) i din session och hämtar, för varje område:
   - alla lägenheter till salu med ≥ 3 rum, ≥ 70 kvm och utgångspris ≤ 13 mkr
   - de senaste slutpriserna (3 sidor per område)
4. Appen går tillbaka till listan. Objekt som inte längre finns till salu markeras *borttagna* tills
   slutpriset dyker upp; sålda objekt matchas på Boolis bostads-id (`/bostad/<id>`), annars adress + boarea.
   Sålda objekt inom kriterierna som aldrig setts till salu läggs också till, för statistiken.

**Områden** (ändras under **Mer…**): Gärdet, Östermalm, Norrmalm, Vasastan, Kungsholmen, Gamla stan, Södermalm.
Namnen slås upp till Boolis område-id vid första hämtningen; under **Mer…** syns vilket Booli-område varje namn
blev, så att du kan kontrollera det.

Slutpris kan också anges för hand (**Ange slutpris**). **Mer…** har även export/import av säkerhetskopia.

Inget hämtas automatiskt i bakgrunden – bara när du trycker på knappen.

Hur Boolis GraphQL ser ut är hämtat från dokumentationen i
[chrischall/booli-mcp](https://github.com/chrischall/booli-mcp/blob/main/docs/BOOLI-API.md).

## Utveckling

```bash
npm install
npm test                      # tester för tolkning, kriterier och statistik
npx cap sync android
cd android && ./gradlew assembleDebug   # kräver JDK 21 och Android SDK 36
```

- `www/booli-fetch.js` – körs i Booli-sidan när du trycker på hämta-knappen (GraphQL-anrop)
- `www/core.js` – tolkning av Booli-data, kriterier, matchning, statistik (testas i Node)
- `www/app.js`, `www/index.html` – gränssnitt; data sparas med Capacitor Preferences
- `android/app/src/main/java/.../BooliBrowserActivity.java` – inbyggd webbläsare med hämta-knapp
- `.github/workflows/android.yml` – bygger APK och publicerar den som release vid varje push

APK:n signeras med `android/app/bostadsbevakning.keystore` (lösenord `android`) så att uppdateringar kan
installeras ovanpå varandra. Nyckeln är bara för privat sidladdning, inte Google Play.
