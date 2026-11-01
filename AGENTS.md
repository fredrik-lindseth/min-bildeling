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
| `reservations` | Array av fulle reservasjonsobjekter (detaljsvar), hver med `detailFetchedAt` (ms) | `lib/sync.js` |
| `lastSync` | Timestamp (ms) for siste fullførte synk | `lib/sync.js` |
| `syncState` | `{ phase, initial, startedAt, pendingIds, failed, total, done, calls, reason?, pausedAt? }` | `lib/sync.js` |
| `syncLock` | `{ owner, expiresAt }` eller null | `lib/sync.js` |
| `syncHistory` | De tre siste synkene: `{ startedAt, durationMs, status, error, calls, fetched, failed }` | `lib/sync.js` |
| `tripCategories` | `{ reservationId: categoryKey }` | dashboard (bruker-input) |
| `transportData` | `{ "2025": { taxi: {...}, buss: {...} } }` | dashboard (bruker-input) |

Reservasjoner, lastSync og sync-nøklene er API-data. Rør dem ikke direkte. tripCategories og transportData er bruker-data. Slett aldri ved sync.

`reservations` inneholder bare detaljsvar, aldri listeelementer. Listesvaret fra `/reservations/historic` er en slank variant uten `price`, `drivenKm`, `canceled`, `noTrips`, `car` og `created`, og `location` er en streng der detaljen har et objekt. Et listeelement i `reservations` ville fått stats-funksjonene til å regne feil uten synlig feil. Id-er som venter på detalj, står i `syncState.pendingIds`.

## API-regler

Integrasjonen skal tåle innsyn fra Dele. `docs/api-bruk.md` beskriver API-bruken for dem og må stemme med koden. Endrer du tallene under, oppdater den også.

- **Hvem kjører synken:** utvidelsessiden som ber om den (dashbordet eller popupen), via `lib/sync-page.js` → `lib/sync.js`. Ikke background. Firefox avslutter MV3-event-pagen på idle (ca. 30 s uten WebExtension-API-aktivitet), også midt i en synk med åpne `fetch`-kall, og da gikk alt i minnet tapt. Med DevTools koblet til utvidelsen skjer det ikke, så test synk uten DevTools. Background eier bare innloggingen (`GET_SYNC_AUTH`, `CLEAR_AUTH`) og `GET_DATA`.
- **Lås mellom sider:** `syncLock` med lease på 45 s, fornyet ved hver batch og forlenget over Retry-After-ventetider. En side som lukkes midt i, slipper låsen når leasen går ut. En annen side får `BUSY` i mellomtiden.
- **Lagre fortløpende:** etter listefasen skrives `syncState` med `pendingIds`. Detaljer hentes ett kall om gangen og lagres i batcher på 20. En avbrutt synk fortsetter fra `pendingIds` neste gang en side åpnes, uten nytt listekall og uten å vente på timegrensen.
- **Paginering:** listen er sortert `start,desc`. Synken stopper på siden der den møter en kjent id, så sant kjente pluss nye id-er dekker `x-totalelements` fra svaret. Førstegangssync går til siste side. `full: true` tvinger full paginering.
- **Hvilke detaljer hentes:** nye reservasjoner, og lagrede som kan ha endret seg. En reservasjon hentes på nytt høyst én gang i døgnet (`DETAIL_REFRESH_MS`) til detaljen er hentet minst sju dager etter `end` (`SETTLE_WINDOW_MS`). Deretter er den fryst og hentes aldri igjen. Data fra før `detailFetchedAt` fantes, bruker `lastSync` som hentetidspunkt. Dele sender verken ETag eller Last-Modified (sjekket autentisert 2026-11-01), så betingede kall er ikke mulig.
- **Pause:** 250 ms mellom kall ved førstegangssync, 100 ms ellers.
- **Feil:** 429, 5xx og nettverksfeil venter så lenge `Retry-After` sier (sekunder eller dato), ellers backoff 2 s × 2^n med ±50 % jitter. Tre slike feil på rad (bryteren) stopper synken med `SERVICE_UNAVAILABLE`, lagrer det som er hentet, og automatiske synker venter ti minutter. Ber serveren om over to minutters pause, stopper synken med en gang. 401 gir `AUTH_EXPIRED`. 404 eller annen 4xx på en detalj markerer id-en i `syncState.failed` og hopper over den. Den prøves igjen ved de neste synkene, maks tre ganger.
- **Sync-intervall:** automatisk synk (side åpnes) høyst én gang i timen (`SYNC_INTERVAL_MS`). Synkroniser-knappen og Prøv igjen tvinger synk. Ingen bakgrunnspolling.
- **Popupen** henter maks 25 detaljer per synk, siden den lukkes så fort brukeren klikker utenfor. Resten tar dashbordet.
- **X-Client:** alle kall har `X-Client: bildeleringen-stats/<versjon fra manifest>` så Dele kan kjenne oss igjen.
- **Telling:** `calls = { list, detail, retries, failed }` per synk, vist i `?dev=1`-panelet fra `syncHistory`.
- **Feil i UI:** synkfeil og delvise resultater vises i statusfeltet med Prøv igjen-knapp og overskrives ikke av tom-tilstanden.
- **Tester:** `cd stats && node --test` (ingen avhengigheter, `stats/package.json` er bare `{"type":"module"}`). `test/sync.test.js` kjører motoren mot fetch- og storage-stubs.
- **Token:** Kan utløpe (401). background.js spør først content script via `tabs.sendMessage`. Hvis content-scriptet ikke er injisert (Firefox MV3-begrensning ved oppstart), faller den tilbake til `scripting.executeScript` som leser `localStorage("persist:data")` direkte. Derfor `scripting`-permission i `manifest.json`. Feiler stille hvis ingen app.dele.no-fane er åpen.

Endepunkter:
- `GET /api/reservations/historic?page=0&size=100&sort=start,desc&membershipId=<UUID>`
- `GET /api/reservations/{id}`
- Auth: `authorization`-header med bearer token fra `localStorage("persist:data")` på app.dele.no

## Turkategorier

`lib/categories.js` har `KEYWORD_MAP`: substring-match mot `notes` (lowercased, ingen ordgrenser). Rekkefølgen betyr noe: første kategori som matcher vinner, så `handletur` ligger før `hoytid` for at "juleshopping" havner riktig. Manuelt valg i UI (lagret i `tripCategories`) overstyrer alltid.

Kartet inneholder Fredriks personlige keywords (navn, stedsnavn, arbeidsgiver, hyttenavn osv.). Andre brukere må fjerne/erstatte før utvidelsen er nyttig for dem. Treffer ca. 82 % av notes med default-listen. Uten personlige nøkkelord faller det betydelig.

## Varemerke

Ikonene i `icons/` er basert på Dele AS sitt offisielle logo. For privat sideloading er det greit. For Chrome Web Store / AMO-publisering: lag eget Dele-inspirert symbol (samme lilla, `#51289D`, er fritt fram).
