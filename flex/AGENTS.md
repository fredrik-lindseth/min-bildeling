# Bildeleringen Fleksibel: prosjektkonvensjoner

Egen Firefox-utvidelse ved siden av stats-utvidelsen (`../stats/`). Alternativt booking-søk oppå dele.no sitt `/api/search`: finn *når* en bil faktisk er ledig, ikke bare "opptatt". Spec + plan i `../docs/superpowers/`.

## Regler (arver fra stats)

- **Ingen build-step.** Vanilla JS, HTML, CSS. Ingen bundler, ingen npm-avhengigheter.
- **ES modules overalt** unntatt `content.js` (content scripts støtter ikke modules).
- **Alle farger via CSS custom properties i `:root`.** Ingen hardkodet hex/rgb utenfor `:root`. Nye variabler trenger dark mode-override (`prefers-color-scheme: dark`).
- **Norsk UI-tekst.** Console.log kan være engelsk.
- **Rene motor-funksjoner.** `lib/flex.js` har ingen sideeffekter, ingen browser-API, ingen storage. Data inn, resultat ut.
- **Cross-browser:** `typeof browser !== "undefined" ? browser : chrome`. `lib/browser-polyfill.js` er guardet så `chrome` ikke gir ReferenceError under node (importeres av `storage.js` i test).

## Utvikling og verifisering i Firefox

Utvidelsen drives via `firefox-devtools`-MCP-en, som styrer en **egen, dedikert Firefox-instans** (profil `~/.firefox-devtools-mcp-profile`), ikke din vanlige nettleser. Auth hentes fra en app.dele.no-fane i *den* instansen.

**Reload vs reinstall (viktig, sparer masse styr):**
- **UI-endringer** (`finder.html/js/css`, `popup/`): IKKE reinstaller. Filene til en utvidelses-side leses ferskt fra disk ved hver sidelasting, så bare naviger/refresh finder-fanen (`navigate_page` til `moz-extension://<uuid>/finder.html`). Reinstall erstatter den midlertidige add-on-en og lukker fanene dens, det er det som tvinger fram manuell ny-innlasting.
- **background.js / manifest.json**: da må du reinstallere (`install_extension` med `type: "path"`, path til `flex/`).
- Manuelt i nettleser: bruk **"Reload"** på utvidelsen i `about:debugging`, ikke fjern + legg til på nytt (beholder UUID).

**MCP-fallgruver:**
- Bridgen dropper forbindelsen med jevne mellomrom. `/reload-plugins` og reconnects spawner nye server-prosesser uten å rydde de gamle. Hoper det seg opp (sjekk `pgrep -fl firefox-devtools-mcp`): `pkill -f firefox-devtools-mcp`, så én ny ren server ved neste kall.
- `install_extension` kan gi ny intern UUID. Hent den fra profilens prefs ved behov: `webextensions.uuids` i `~/.firefox-devtools-mcp-profile/prefs.js`.
- `list_pages` viser bare tittel, ikke URL. Faner stokker om ved reinstall.

**Tester:** `cd flex && node --test` (Node 24, ESM native via `package.json` `{"type":"module"}`). Kun de rene funksjonene i `lib/` testes; UI og storage-touch røyktestes i nettleser.

## Arkitektur

- `content.js`: leser token fra `localStorage("persist:data")` på app.dele.no. Klassisk script. Pusher token til `storage.local` (`authToken`) ved hver sidelasting, så polleren har noe å gå på når ingen fane er åpen.
- `background.js`: `getAuth()` (content script først, `scripting.executeScript` som fallback), `SEARCH`-proxy mot `/api/search`. Nuller `currentAuth` ved `AUTH_EXPIRED`. Eier også varsler: eneste skriver på `watches`, `alarms`-poller (`pollWatches`) og dispatcher (browser-varsel + relay-POST).
- `lib/search-api.js`: `searchAvailability(point, start, end, token)`, `fetchLocations(token)`. 50ms delay + 429-backoff.
- `lib/places.js`: rene hjelpere for stedsvalg. `stationPlaces` gjør `/api/locations` om til steder med ett punkt per stasjon (snitt av hjørnene i Point/LineString/Polygon). Finderen henter listen via `GET_LOCATIONS` i background og tilbyr i tillegg «Min posisjon» (geolokasjon) og «Husk stedet».
- `lib/flex.js`: motoren, med `freeBlocks`, `fitCar`, `solve` (buckets whole/adjusted/siblings), `splitPairs`. Rene funksjoner. `matchesFilters`/`withinDistance` er eksportert så `watch.js` gjenbruker dem.
- `lib/watch.js`: rene `detectHits(searchResult, watch, window)` (bil ledig ≥ terskel i vinduet) + `reconcile(hits, notified, now)` (de-dup på blokkslutt, rydding, relay-retry). Ingen browser-API.
- `lib/format.js`: `parseLocalISO`/`toLocalISO`, naiv lokal ISO uten tidssone.
- `lib/storage.js`: brukerens lagrede steder (ingen innebygde, `DEFAULT_PLACES` er tom fordi koden er offentlig) + favoritter + overvåkninger (`getWatches`/`setWatches`) + varsel-innstillinger (`getSettings`/`saveSettings`).
- `finder.html/js/css`: fullside-søk (med "Overvåk dette søket"). `watches.html/js`: overvåkninger + innstillinger. `popup/`: inngang til begge.

## API-fakta (`/api/search`)

`GET /api/search?start=<lokal ISO>&end=<lokal ISO>&location=<URL-enkodet GeoJSON Point [lng,lat]>`, Bearer-token.

- Returnerer **alle** biler i org (~356), sortert med `location.distance` (meter), men ikke rent distansesortert. Distansefilter gjøres klientside. Derfor: sekundærsøk med større radius koster ingen ekstra nettverkskall, bare kjør `solve` på nytt med mildere `maxDistanceM`.
- Hver bil har `availability[]`: sammenhengende segmenter med `state` = `AVAILABLE` / `RESERVED` / `UNAVAILABLE`. Kun `AVAILABLE` er bookbart. Segmenter er ikke klippet til søkevinduet og er snappet til hel time.
- `carProperties[]` bruker `carPropertyGroup` / `carPropertyName` (f.eks. group "Drivstoff"), IKKE `groupKey`/`group` som reservasjons-API-et i stats.
- **Flere organisasjoner:** søket returnerer biler fra alle bilkollektiv på dele.no. Vi filtrerer alltid til Bildeleringen (`ORG_BILDELERINGEN` i `lib/flex.js`) + et region-tak på 100 km (`REGION_CEILING_M` i `finder.js`) for å holde både Trondheim Bilkollektiv og Bildeleringen sine beboer-restringerte Tromsø-biler ute. Org-tabell og Tromsø-jokeren i `../docs/api/README.md`.

## Gotchas (lært, ikke gjenoppdages)

- **Deep-link til dele.no: rå colon i tidsstempel.** `findcar?start=2026-07-10T23:00:00` funker; `encodeURIComponent` (→ `%3A`) gir "Invalid date" i app-en. Ikke enkod tidsdelen.
- **`location`-param i deep-link ignoreres** av app.dele.no (faller til default-punkt). Kun tid følger med. Derfor viser vi stedsnavnet så brukeren velger stasjon manuelt.
- **"Skjul opptatte biler" i dele.no er ren klient-filtrering**, ikke URL-styrt. Kan ikke forhåndssettes via deep-link (verifisert i nettverksloggen).
- **Ikke bruk `datetime-local`.** Den arver nettleser-locale (ga AM/PM + US-format). Vi bruker egen range-kalender + tid-selects, full kontroll, ingen locale-avhengighet.
- **Auth krever en app.dele.no-fane** (tokenet bor i den origin-ens localStorage). Ved manglende innlogging åpner finder-en fanen ufokusert i bakgrunnen og poller til token er lest, så kjører søket på nytt.

## Varsler (overvåkning)

Overvåk et sted + filtre over et tidsvindu, varsle når en bil blir ledig en sammenhengende blokk ≥ terskel. Pollingen skjer i nettleseren (dele.no-token bor kun i nettleser-sesjonen), så det poller bare mens Firefox er åpen. Full design + plan i `../docs/superpowers/{specs,plans}/2026-07-16-varsler*`.

**Flyt:** `alarms` (default 15 min) → `pollWatches` søker per aktiv watch → `detectHits` → `reconcile` → dispatcher fyrer ÉN browser-notifikasjon + ÉN POST til backend per watch. Backenden (egen tjeneste, eget repo) relayer til Signal.

**Tillatelser:** `alarms`, `notifications`, og relay-verten som valgfri tillatelse (`optional_host_permissions`).

**Relay-adressen står aldri i koden.** Den settes på innstillingssiden (`watches.html`, også `options_ui`, så den nås fra `about:addons`), lagres i `notifySettings.backendUrl` og gis tilgang ved kjøretid med `permissions.request` for akkurat den verten. `lib/relay.js` vasker adressen (https, eller http mot localhost) og lager match-mønsteret. Lagre-knappen må kalle `permissions.request` før første `await`, ellers avviser Firefox kallet fordi det ikke lenger regnes som brukerhandling. Mangler tilgangen, kaster `relay()`, og treffet blir stående med `relayed: false` til tilgangen er gitt. Bytter du adresse, trekkes tilgangen til den gamle verten tilbake.

**Nye storage-nøkler:**

| Nøkkel | Struktur | Skriver |
|---|---|---|
| `watches` | Array av watch-objekter (id, point, filters, earliestStart, latestEnd, minHours, active, lastChecked, `notified`) | KUN background.js (UI sender ADD/TOGGLE/DELETE-meldinger) |
| `authToken` | `{ token, ts }` | content.js (push), background nuller ved 401 |
| `notifySettings` | `{ backendUrl, backendToken, pollMinutes }` | background (via SAVE_SETTINGS) |

**Gotchas:**
- **De-dup-nøkkel = `<carId>|<blokksluttISO>`, ikke blokkstart.** `freeBlocks` klipper blokkstart til vindusstart, og vindusstart = `max(earliestStart, nå)`. Etter at vinduet har begynt drifter blokkstart for hver poll → nytt varsel hvert kvarter. Blokkslutt er stabil.
- **Relay-feil dropper ikke varselet.** `notified`-verdien er `{ notifiedAt, relayed }`. Mislykket POST står `relayed: false` og retryes neste runde uten nytt browser-varsel. Relayen er den kritiske stien (du er borte fra laptopen).
- **`detectHits` får det effektive vinduet eksplisitt** (samme som søket), leser aldri `watch.earliestStart` selv.

## Design

Deler token-systemet til stats (gråblå bg, hvite kort med subtil dybde, tre-nivås teksthierarki), men med Dele-lilla (`#51289D`) som aksent og **2px hjørner** overalt.

- Biltype/drivstoff er toggle-brikker, ikke dropdowns. Default: Småbil + Varebil av, resten på.
- Sjeldne filtre (biltype/drivstoff/gangavstand) ligger bak sammenleggbar "Flere filtre", lukket som standard, med hint om aktive valg.
- "Søk" er festet i egen bunn-fot (`.wish__foot`); panelet capes til viewport-høyde og kroppen scroller internt, så Søk alltid er synlig uten scrolling.
- Tidslinjen tegner alle segmenter (grønn ledig / grå opptatt) med hover-tooltip (én egen stylet, ikke native `title`).
