# Utvikling

Repoet har to selvstendige utvidelser: `stats/` for statistikk og `flex/` for fleksibelt booking-søk (se [flex/README.md](../flex/README.md)). Reglene for agenter står i [AGENTS.md](../AGENTS.md) og [flex/AGENTS.md](../flex/AGENTS.md), hvordan delene henger sammen i [arkitektur.md](arkitektur.md).

## Kom i gang

Last inn stats-utvidelsen:

- **Firefox:** `about:debugging#/runtime/this-firefox`, «Last inn midlertidig tillegg», velg `stats/manifest.json`.
- **Chrome:** `chrome://extensions`, slå på Utviklermodus, «Last inn upakket», velg `stats/`-mappen.

Endringer i HTML, JS og CSS på utvidelsessidene trenger bare at du laster siden på nytt. Endrer du `background.js` eller `manifest.json`, klikker du «Last inn på nytt» (Firefox) eller oppdater-ikonet (Chrome).

Tester: `cd stats && node --test` og `cd flex && node --test` (Node 24, ingen avhengigheter, `package.json` er bare `{"type":"module"}`). Bare de rene funksjonene i `lib/` testes, og `stats/test/docs.test.js` sjekker [api-bruk.md](api-bruk.md) mot konstantene. UI og lagring røyktestes i nettleseren.

## Firefox via MCP

Agenter styrer utvidelsene med `firefox-devtools`-MCP-en. Den kjører en egen Firefox-instans med profilen `~/.firefox-devtools-mcp-profile`, ikke den vanlige nettleseren. Innloggingen hentes fra en app.dele.no-fane i den instansen.

- **HTML, JS og CSS på utvidelsessider:** ikke installer på nytt. Filene leses ferskt fra disk ved hver sidelasting, så last fanen på nytt. `install_extension` erstatter det midlertidige tillegget og lukker fanene dets, og det er det som tvinger fram ny innlasting for hånd.
- **`background.js` og `manifest.json`:** installer på nytt med `install_extension` (`type: "path"`, stien til `stats/` eller `flex/`).
- **For hånd:** bruk «Last inn på nytt» på tillegget i `about:debugging`, ikke fjern og legg til. Da beholdes UUID-en.

Fallgruver:

- Broen mister forbindelsen innimellom. `/reload-plugins` og nye tilkoblinger starter nye serverprosesser uten å rydde de gamle. Hoper de seg opp (`pgrep -fl firefox-devtools-mcp`), kjør `pkill -f firefox-devtools-mcp`, så starter én ren server ved neste kall.
- `install_extension` kan gi ny intern UUID. Den står i `webextensions.uuids` i `~/.firefox-devtools-mcp-profile/prefs.js`.
- `list_pages` viser bare tittelen, ikke URL-en. Fanene bytter rekkefølge ved ny installasjon.
- MCP-en nekter å navigere til `moz-extension://` og `about:debugging`. Server en kopi av siden over http med et stubbet `browser`-API, eller be Fredrik klikke.
- WebDriver avviser `window.confirm`, `alert` og `prompt`: `confirm("test")` gir `false` uten at noen dialog vises. Bruk `<dialog>` for bekreftelser, så kan de testes.
- Synken i stats må testes uten DevTools koblet til tillegget, ellers avslutter ikke Firefox event-pagen, og feilen synes ikke (se [arkitektur.md](arkitektur.md)).

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

## Ikoner

Stats-ikonet er eget (bil med stolpediagram) og har ingenting fra Dele-logoen, så det kan publiseres. Kildene er `stats/icons/icon.svg` (lys verktøylinje) og `icon-dark.svg` (mørk). I manifestets `theme_icons` beskriver nøklene temaets tekstfarge, ikke ikonet: `"dark"` vises på lyst tema og `"light"` på mørkt, så `"light"` peker på `icon-dark-*.png`. PNG-ene rendres med `stats/scripts/render-icons.sh` (krever `rsvg-convert`), som feiler hvis koblingen snus. Motivet er tegnet på et 16-rutenett med kanter på hele enheter, så 16 px blir skarpt. `icons/listing/icon-256.png` er til AMO-listingen og holdes utenfor zip-en.

## Release

`./stats/scripts/package.sh` lager `stats/dist/bildeleringen-stats-v<versjon>.zip`. Selve utgivelsen gjøres med `./stats/scripts/release.sh`, se [publisering.md](publisering.md).
