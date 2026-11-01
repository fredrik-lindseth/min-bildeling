# Utvikling

Monorepo med to selvstendige utvidelser: `stats/` (denne, statistikk/analyse) og `flex/` (fleksibelt booking-søk, se `flex/README.md` og `flex/AGENTS.md`). Delte docs i `docs/`. Konvensjoner for `stats/` i `AGENTS.md`.

## Kom i gang

```bash
git clone <repo-url>
cd bildeleringen
```

Last inn stats-utvidelsen:
- **Firefox:** `about:debugging#/runtime/this-firefox` → «Last inn midlertidig tillegg» → velg `stats/manifest.json`
- **Chrome:** `chrome://extensions` → Utviklermodus → «Last inn upakket» → velg `stats/`-mappen

Etter endringer, klikk «Last inn på nytt» (Firefox) eller oppdater-ikonet (Chrome). UI-endringer (HTML/JS/CSS på utvidelses-sider) trenger bare sidelasting, ikke full ny-innlasting.

## Teknologi

- Vanilla JS, HTML, CSS: ingen build-step, ingen npm
- [Chart.js](https://www.chartjs.org/) for grafer
- [html2canvas](https://html2canvas.hertzen.com/) for PNG-eksport
- WebExtension API (Manifest V3): Firefox + Chrome

## Prosjektstruktur

Utvidelsesfilene under ligger i `stats/`; `docs/` er delt med `flex/`.

```
manifest.json              # Manifest V3
background.js              # Synkronisering, caching, meldinger
content.js                 # Leser auth fra dele.no localStorage
popup/                     # Popup: rask oversikt
dashboard/                 # Dashboard: 8 seksjoner med grafer
summary/                   # Årsoppsummering
lib/
  api.js                   # API-klient (paginering, retry, rate-limiting)
  browser-polyfill.js      # Firefox/Chrome kompatibilitetslag
  categories.js            # Turkategorisering fra notater
  chart-helpers.js         # Chart.js wrappere
  co2.js                   # CO₂-beregning per drivstofftype/kategori
  formatters.js            # NOK- og datoformatering
  ownership-cost.js        # Eierkostnadsmodell + Volvo EX C40
  stats.js                 # Statistikkberegninger (rene funksjoner)
  transport.js             # Transportkalkulator (taxi, buss, fly, etc.)
vendor/
  chart.min.js             # Chart.js 4.x UMD
  html2canvas.min.js       # html2canvas
icons/                     # Utvidelsesikoner
docs/
  research/                # TØI-rapporter og forskningsgrunnlag
  plans/                   # Design- og implementasjonsplaner
  visjon.md                # Nordstjerne-visjon
```

## Dataflyt

1. `content.js` kjører på `app.dele.no`, leser auth-token fra localStorage
2. `background.js` henter reservasjoner fra API, cacher i `browser.storage.local`
3. Popup/dashboard leser fra cache, beregner statistikk on-the-fly
4. Turkategorier og transportdata lagres separat i `browser.storage.local`

## Tillatelser

| Tillatelse | Brukes til |
|---|---|
| `storage` | Lagre data lokalt |
| `unlimitedStorage` | Full reservasjonshistorikk |
| `*://app.dele.no/*` | Auth og API-kall |

## Estimater og kilder

| Estimat | Kilde |
|---|---|
| Eierkostnader | NAF Bilkostnadsindeks, OFV |
| Volvo EX C40 2026 | Nypris, forsikring, strøm |
| CO₂ bildeling | Miljødirektoratet (per biltype) |
| CO₂ buss | TØI/Skyss (~50 g/passasjer-km) |
| CO₂ taxi | Miljødirektoratet (~120 g/km) |
| CO₂ fly | Avinor (~150 g/passasjer-km) |
| Substitusjonseffekter | TØI 1895/2022 |

## Pakking av release

```bash
./stats/scripts/package.sh
```

Lager `stats/dist/bildeleringen-stats-v<versjon>.zip`. Selve utgivelsen gjøres med `./stats/scripts/release.sh`, se [publisering.md](publisering.md), avsnittet «Release på GitHub».
