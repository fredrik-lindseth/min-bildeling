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

Demomodus: legg `?demo=1` på `dashboard/dashboard.html`, `popup/popup.html` eller `summary/summary.html`. Sidene viser da rundt 180 oppdiktede turer fra `lib/demo-data.js` (fast seed, stasjoner i Bergen og Trondheim), skjuler Synkroniser, viser merket «Demodata» og skriver ingenting til storage. Demomodus bruker ingen utvidelses-API, så sidene kan åpnes over vanlig http med `cd stats && python3 -m http.server 8765`, for eksempel `http://127.0.0.1:8765/dashboard/dashboard.html?demo=1`. Det er grunnlaget for skjermbilder, og det en reviewer kan se uten dele.no-konto.

Skjermbilder: `./stats/scripts/skjermbilder.sh` lager bildene i `skjermbilder/` (eller mappen du gir som argument). Det starter `python3 -m http.server` fra `stats/` på en ledig port, tar dashboardet (Kostnader og `#bruksmonster`) og popupen i lys og mørk modus og to tallsider i årsoppsummeringen (`#brukt` og `#spart`) i mørk, og rydder server og profiler etterpå. Krever Firefox, Node og python3. Fargemodus settes i to midlertidige profiler med `ui.systemUsesDarkTheme` og `layout.css.prefers-color-scheme.content-override`, så systemets utseende spiller ingen rolle. Dashboardet og årsoppsummeringen tas i 1280×800, som AMO anbefaler, popupen i 350 px bredde og hele høyden.

`firefox --headless --screenshot` holder ikke. Den tar bildet ved load, og da har Chart.js ennå ikke tegnet diagrammene som ble laget i skjulte elementer. Den fotograferer dessuten alltid fra toppen av dokumentet, så et anker gir feil utsnitt. Derfor styrer `stats/scripts/skjermbilde.mjs` Firefox over WebDriver BiDi (`--remote-debugging-port`, WebSocket fra Node), venter på load, fonter og to animasjonsrammer og tar så bildet av viewporten. Metadata strippes med `magick` når den finnes, så to kjøringer samme dag gir like filer. Demodataene regnes fra dagens dato, så tallene endrer seg over tid, men utsnittene er de samme. Se på hvert bilde før det sjekkes inn.

Utviklerpanelet: legg `?dev=1` på dashboardet i utvidelsen. Panelet viser antall lagrede reservasjoner, storage-bruk, kall mot dele.no for de tre siste synkene og den første lagrede reservasjonen som JSON, og har eksport, import og «Nullstill alt». Det leser ekte storage og er derfor av i demomodus.

## Teknologi

Vanilla JS, HTML og CSS uten byggesteg eller npm, med [Chart.js](https://www.chartjs.org/) for grafer og [html2canvas](https://html2canvas.hertzen.com/) for PNG-eksport. WebExtension API (Manifest V3) for Firefox og Chrome.

## Prosjektstruktur

Filene ligger i `stats/`.

```text
manifest.json              # Manifest V3
background.js              # Innlogging og lesing av lagrede data
content.js                 # Leser auth fra dele.no localStorage
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
  method-panel.js/.css     # «Slik beregnes det»: ett panel for alle metodene
  ownership-cost.js        # Bilregnestykket mot referansebilen
  referansebil.js          # Volvo EX40: forutsetningene med kilde og dato
  stats.js                 # Statistikk (rene funksjoner)
  sync.js                  # Synkmotoren
  sync-page.js             # Kobler synken til popup og dashboard
  sync-messages.js         # Norske tekster for synkstatus, og om hele historikken er hentet
  auth-state.js            # Tilstand og tekst når innloggingen mangler (ren)
  auth-banner.js           # Banneret og knappen for den tilstanden
  transport.js             # Transportkalkulator
scripts/                   # Pakking, release, ikoner og skjermbilder
test/                      # node --test
vendor/                    # Chart.js og html2canvas
icons/
```

## Tillatelser

| Tillatelse              | Brukes til                                      |
| ----------------------- | ----------------------------------------------- |
| `storage`               | Lagre data lokalt                               |
| `unlimitedStorage`      | Full reservasjonshistorikk                      |
| `scripting`             | Hente innloggingen når content-scriptet mangler |
| `https://app.dele.no/*` | Auth og API-kall                                |

## Estimater og kilder

| Estimat               | Kilde                                                   |
| --------------------- | ------------------------------------------------------- |
| Eierkostnader         | OFV kalkyle 2026 (elbil, 10 000 km), NAF                |
| Parkering             | Bergen eller Trondheim kommune, etter organisasjonen    |
| Volvo EX40            | Volvo Norge-pris 10.09.2026 (Elbil24, Finn)             |
| CO₂ bildeling         | Miljødirektoratet (per biltype)                         |
| CO₂ buss              | SSB, buss 2019 (~59 g/passasjer-km)                     |
| CO₂ taxi              | 0 g/km etter nullutslippskravet, før det 229 g/km       |
| CO₂ fly               | Avinor (~150 g/passasjer-km)                            |
| Substitusjonseffekter | TØI 1895/2022                                           |

Forutsetningene skal gjelde alle medlemmene i Bilparaplyen. Er en verdi lokal, velges den ut fra `organizationId` (`regionForOrganization` i `lib/ownership-cost.js`), og begge byene står i «Slik beregnes det». For et år som pågår tas de faste eierkostnadene for den delen av året som er gått (`yearFraction`), så «Spart i år» ikke stiller helårskostnaden mot bildelingen hittil.

## Ikoner

Stats-ikonet er eget (bil med stolpediagram) og har ingenting fra Dele-logoen, så det kan publiseres. Kildene er `stats/icons/icon.svg` (lys verktøylinje) og `icon-dark.svg` (mørk). I manifestets `theme_icons` beskriver nøklene temaets tekstfarge, ikke ikonet: `"dark"` vises på lyst tema og `"light"` på mørkt, så `"light"` peker på `icon-dark-*.png`. PNG-ene rendres med `stats/scripts/render-icons.sh` (krever `rsvg-convert`), som feiler hvis koblingen snus. Motivet er tegnet på et 16-rutenett med kanter på hele enheter, så 16 px blir skarpt. `icons/listing/icon-256.png` er til AMO-listingen og holdes utenfor zip-en.

## Release

`./stats/scripts/package.sh` kjører kontrastsjekken (`stats/scripts/kontrast.sh`) og stilsjekken (`stats/scripts/sjekk-stil.sh`: farger bare i `lib/tokens.css`, ingen skygger, `border-radius` bare som `var(--radius)` eller 0, ingen `!important`) og lager så `stats/dist/bildeleringen-stats-v<versjon>.zip`. Feiler et fargepar eller en stilregel, blir det ingen pakke. Selve utgivelsen gjøres med `./stats/scripts/release.sh`, se [publisering.md](publisering.md).
