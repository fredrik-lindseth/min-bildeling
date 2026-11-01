# Utvikling

Repoet har to selvstendige utvidelser: `stats/` for statistikk og `flex/` for fleksibelt booking-søk (se `flex/README.md` og `flex/AGENTS.md`). Konvensjonene for `stats/` står i `AGENTS.md`.

## Kom i gang

Last inn stats-utvidelsen:

- **Firefox:** `about:debugging#/runtime/this-firefox`, «Last inn midlertidig tillegg», velg `stats/manifest.json`.
- **Chrome:** `chrome://extensions`, slå på Utviklermodus, «Last inn upakket», velg `stats/`-mappen.

Endringer i HTML, JS og CSS på utvidelsessidene trenger bare at du laster siden på nytt. Endrer du `background.js` eller `manifest.json`, klikker du «Last inn på nytt» (Firefox) eller oppdater-ikonet (Chrome).

Tester: `cd stats && node --test`.

Demomodus: legg `?demo=1` på `dashboard/dashboard.html`, `popup/popup.html` eller `summary/summary.html`. Sidene viser da rundt 180 oppdiktede turer fra `lib/demo-data.js` (fast seed, stasjoner i Bergen og Trondheim), skjuler Synkroniser, viser merket «Demodata» og skriver ingenting til storage. Demomodus bruker ingen utvidelses-API, så sidene kan åpnes over vanlig http med `cd stats && python3 -m http.server 8765`, for eksempel `http://127.0.0.1:8765/dashboard/dashboard.html?demo=1`. Det er grunnlaget for skjermbilder, og det en reviewer kan se uten dele.no-konto.

## Teknologi

Vanilla JS, HTML og CSS uten byggesteg eller npm, med [Chart.js](https://www.chartjs.org/) for grafer og [html2canvas](https://html2canvas.hertzen.com/) for PNG-eksport. WebExtension API (Manifest V3) for Firefox og Chrome.

## Prosjektstruktur

Filene ligger i `stats/`.

```text
manifest.json              # Manifest V3
background.js              # Innlogging og lesing av lagrede data
content.js                 # Leser auth fra dele.no localStorage
debug.html, debug.js       # Eksport av lagrede data for feilsøking
popup/                     # Rask oversikt
dashboard/                 # Dashboard med grafer
summary/                   # Årsoppsummering
lib/
  api.js                   # API-klient (paginering, pauser, retry)
  browser-polyfill.js      # Firefox/Chrome-kompatibilitet
  categories.js            # Turkategorier fra notater
  chart-helpers.js         # Chart.js-hjelpere
  co2.js                   # CO₂ per drivstofftype og kategori
  formatters.js            # NOK- og datoformatering
  ownership-cost.js        # Eierkostnader og Volvo EX C40
  stats.js                 # Statistikk (rene funksjoner)
  sync.js                  # Synkmotoren
  sync-page.js             # Kobler synken til popup og dashboard
  sync-messages.js         # Norske tekster for synkstatus
  transport.js             # Transportkalkulator
scripts/                   # Pakking, release og ikoner
test/                      # node --test
vendor/                    # Chart.js og html2canvas
icons/
```

## Dataflyt

1. `content.js` kjører på `app.dele.no` og leser auth-token fra localStorage.
2. Synken kjører i siden som ba om den (popup eller dashboard), ikke i background, siden Firefox kan avslutte background midt i en lang synk. Background skaffer bare innloggingen.
3. Reservasjonene lagres i `browser.storage.local`, og sidene regner ut statistikken ved visning.
4. Turkategorier og transportdata lagres separat i `browser.storage.local`.

## Tillatelser

| Tillatelse          | Brukes til                                      |
| ------------------- | ----------------------------------------------- |
| `storage`           | Lagre data lokalt                               |
| `unlimitedStorage`  | Full reservasjonshistorikk                      |
| `scripting`         | Hente innloggingen når content-scriptet mangler |
| `*://app.dele.no/*` | Auth og API-kall                                |

## Estimater og kilder

| Estimat               | Kilde                           |
| --------------------- | ------------------------------- |
| Eierkostnader         | NAF Bilkostnadsindeks, OFV      |
| Volvo EX C40 2026     | Nypris, forsikring, strøm       |
| CO₂ bildeling         | Miljødirektoratet (per biltype) |
| CO₂ buss              | TØI/Skyss (~50 g/passasjer-km)  |
| CO₂ taxi              | Miljødirektoratet (~120 g/km)   |
| CO₂ fly               | Avinor (~150 g/passasjer-km)    |
| Substitusjonseffekter | TØI 1895/2022                   |

## Release

`./stats/scripts/package.sh` lager `stats/dist/bildeleringen-stats-v<versjon>.zip`. Selve utgivelsen gjøres med `./stats/scripts/release.sh`, se [publisering.md](publisering.md).
