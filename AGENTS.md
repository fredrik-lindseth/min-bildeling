# Bildeleringen Stats: Prosjektkonvensjoner

## Monorepo

Repoet har to selvstendige utvidelser: `stats/` (denne, statistikk/analyse) og `flex/` (fleksibelt booking-søk, egen `flex/AGENTS.md`). Delte docs i `docs/`. Konvensjonene under gjelder `stats/`.

## Innlasting i Firefox (gjelder begge utvidelser)

Utvikling skjer via `firefox-devtools`-MCP-en, som styrer en **egen, dedikert Firefox-instans** (profil `~/.firefox-devtools-mcp-profile`), ikke din vanlige nettleser.

- **UI-endringer** (HTML/JS/CSS på utvidelses-sider): IKKE reinstaller. Sidefiler leses ferskt fra disk ved hver lasting, så bare naviger/refresh fanen. Reinstall (`install_extension`) erstatter den midlertidige add-on-en og lukker fanene dens, det er det som tvinger fram manuell ny-innlasting.
- **background.js / manifest.json**: da må du reinstallere.
- Manuelt: bruk **"Reload"** på utvidelsen i `about:debugging`, ikke fjern + legg til på nytt (beholder UUID).
- Hoper MCP-serverne seg opp (bridgen dropper forbindelsen ved reconnect/`/reload-plugins`): `pkill -f firefox-devtools-mcp`, så én ren server ved neste kall. Full liste over MCP-fallgruver i `flex/AGENTS.md`.

## Regler

- **Ingen build-step.** Vanilla JS, HTML, CSS. Ingen bundler eller npm. Vendor-libs i `vendor/`.
- **Alle farger via CSS custom properties i `:root`.** Ingen hardkodede hex/rgb utenfor `:root`. Maks 5 chart-farger (`--color-chart-1` til `--color-chart-5`). Legg til ny CSS-variabel før du bruker en 6. farge.
- **Mørk modus er påkrevd.** All UI må fungere i lys og mørk modus (`prefers-color-scheme`). Nye CSS-variabler trenger dark mode override.
- **Norsk UI-tekst.** Alt brukeren ser (labels, feilmeldinger, status) på norsk. Console.log kan være engelsk.
- **ES modules overalt**, unntatt `content.js` (content scripts støtter ikke modules).
- **Stats-funksjoner er rene.** `lib/stats.js`, `lib/co2.js`, `lib/ownership-cost.js` har ingen sideeffekter: tar data inn, returnerer resultater. Ikke kall browser-API-er eller storage fra disse.
- **Vis 'Slik beregner vi'-knapp med kilder** ved alle estimater (eierkostnader, CO₂). Prefix estimerte tall med "ca." eller "~".
- **Cross-browser:** `typeof browser !== "undefined" ? browser : chrome` for API-tilgang. `lib/browser-polyfill.js` eksporterer `browserAPI` og `storage`.

## API-feltnavn (kritisk)

Reservasjonsobjekter fra dele.no bruker disse feltnavnene, IKKE det du kanskje ville gjettet:

| Felt | Type | Beskrivelse |
|---|---|---|
| `price.total` | number | Kostnad i NOK (IKKE `totalPrice`) |
| `price.lines[]` | array | Prislinjer: startavgift, timepris, km-pris, gebyr |
| `drivenKm` | number/null | Kjørte km (IKKE `distance`) |
| `car.model` | string | Bilmodell (IKKE `vehicleName`) |
| `car.category` | string | Småbil / Minibil / Kombi / Stasjonsvogn / SUV / Varebil |
| `car.properties[]` | array | `groupKey: "FUEL_TYPE"` → `name: "Bensin"/"Diesel"/"Elektrisitet"` |
| `canceled` | datetime/null | null = ikke avbestilt (IKKE `status`) |
| `noTrips` | boolean | Booket men ikke kjørt. Kan ha kostnad > 0 (gebyr). |
| `notes` | string/null | Brukerens turnotater, brukes til auto-kategorisering |
| `start`, `end` | datetime | ISO-strenger |
| `created` | datetime | Opprettelsestidspunkt (for booking lead time) |

Full OpenAPI-spec i `docs/api/openapi.json`. Anonymiserte eksempler i `docs/api/sample-*.json`.

## Filtrering

Alle stats-funksjoner bruker én av to filtre:

- **`filterValid()`**: `canceled == null` OG `price.total != null`. Inkluderer noTrips (bruker betalte). Brukes av: `costStats()`, `monthlyCosts()`, `yearlyCosts()`, `bookingPatterns()`.
- **`filterDriven()`**: `filterValid()` OG `!noTrips`. Kun faktisk kjøring. Brukes av: `usagePatterns()`, `mileageStats()`, `totalCO2()`, `estimateOwnershipCost()`.

Bruk feil filter → feil tall uten synlig feil.

`bookingPatterns()` krever i tillegg `created != null` og dropper reservasjoner uten feltet (eldre data kan mangle det). Negative lead times (booking opprettet etter starttid, rettelser, spontan-bruk) klampes til 0.

## Storage-nøkler

Alt i `browser.storage.local`:

| Nøkkel | Struktur | Oppdateres av |
|---|---|---|
| `reservations` | Array av fulle reservasjonsobjekter | background.js (sync) |
| `lastSync` | Timestamp (ms) | background.js (sync) |
| `tripCategories` | `{ reservationId: categoryKey }` | dashboard (bruker-input) |
| `transportData` | `{ "2025": { taxi: {...}, buss: {...} } }` | dashboard (bruker-input) |

Reservasjoner og lastSync er API-data. Rør dem ikke direkte. tripCategories og transportData er bruker-data. Slett aldri ved sync.

## API-regler

- **Rate-limiting:** `lib/api.js` legger inn 50ms delay mellom kall. 429-svar → eksponentiell backoff (2^attempt × 1000ms). Endre ikke uten grunn.
- **Sync-intervall:** Maks én gang per time (`SYNC_INTERVAL_MS`). Manuell sync trigges av brukeren.
- **Inkrementell sync:** Henter kun nye reservasjoner (sammenligner ID-er mot cache). Eksisterende data oppdateres IKKE ved re-sync.
- **Single-flight sync-lock:** `background.js` holder én `syncInFlight`-promise. Parallelle SYNC_NOW-meldinger (f.eks. popup + dashboard åpne samtidig) deler samme promise. Uten dette gikk progress-telleren baklengs.
- **Token:** Kan utløpe (401). background.js spør først content script via `tabs.sendMessage`. Hvis content-scriptet ikke er injisert (Firefox MV3-begrensning ved oppstart), faller den tilbake til `scripting.executeScript` som leser `localStorage("persist:data")` direkte. Derfor `scripting`-permission i `manifest.json`. Feiler stille hvis ingen app.dele.no-fane er åpen.

Endepunkter:
- `GET /api/reservations/historic?page=0&size=100&sort=start,desc&membershipId=<UUID>`
- `GET /api/reservations/{id}`
- Auth: `authorization`-header med bearer token fra `localStorage("persist:data")` på app.dele.no

## Turkategorier

`lib/categories.js` har `KEYWORD_MAP`: substring-match mot `notes` (lowercased, ingen ordgrenser). Rekkefølgen betyr noe: første kategori som matcher vinner, så `handletur` ligger før `hoytid` for at "juleshopping" havner riktig. Manuelt valg i UI (lagret i `tripCategories`) overstyrer alltid.

Kartet inneholder Fredriks personlige keywords (navn, stedsnavn, arbeidsgiver, hyttenavn osv.). Andre brukere må fjerne/erstatte før utvidelsen er nyttig for dem. Treffer ca. 82 % av notes med default-listen. Uten personlige nøkkelord faller det betydelig.

## Varemerke

Stats-ikonet er eget (bil med stolpediagram) og har ingenting fra Dele-logoen, så det kan publiseres. Kildene er `stats/icons/icon.svg` (lys verktøylinje) og `icon-dark.svg` (mørk). I manifestets `theme_icons` beskriver nøklene temaets tekstfarge, ikke ikonet: `"dark"` vises på lyst tema og `"light"` på mørkt, så `"light"` peker på `icon-dark-*.png`. `render-icons.sh` feiler hvis koblingen snus. PNG-ene rendres med `stats/scripts/render-icons.sh` (krever `rsvg-convert`), aldri for hånd. Motivet er tegnet på et 16-rutenett med kanter på hele enheter så 16 px blir skarpt; hold det slik ved endringer. `icons/listing/icon-256.png` er til AMO-listingen og holdes utenfor zip-en.

`flex/icons/` er fortsatt Dele sitt symbol: greit for privat sideloading, men må byttes før flex publiseres. Lilla `#51289D` er fritt fram.
