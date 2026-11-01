# Arkitektur

Hvordan utvidelsene henger sammen inni: lagring, synk, filtrering og varsler. Feltnavn og endepunkter står i [api/README.md](api/README.md), hva stats gjør mot API-et og hvor ofte i [api-bruk.md](api-bruk.md), filstrukturen for stats i [DEVELOPMENT.md](DEVELOPMENT.md).

## Stats

### Dataflyt

1. `content.js` kjører på app.dele.no og leser token og `membershipId` fra `localStorage("persist:data")`.
2. Popupen eller dashbordet starter synken via `lib/sync-page.js`, som kjører motoren i `lib/sync.js` i selve siden.
3. Reservasjonene lagres i `browser.storage.local`. Sidene regner ut statistikken ved visning med de rene funksjonene i `lib/stats.js`, `lib/co2.js` og `lib/ownership-cost.js`.

Background kjører ikke synken. Firefox avslutter MV3-event-pagen på idle (rundt 30 s uten WebExtension-API-aktivitet), også midt i en synk med åpne `fetch`-kall, og da gikk alt i minnet tapt. Med DevTools koblet til utvidelsen skjer det ikke, så synken må testes uten DevTools. Background eier bare innloggingen (`GET_SYNC_AUTH`, `CLEAR_AUTH`, `GET_AUTH_STATUS`) og lesing av lagrede data (`GET_DATA`, `DEBUG_DUMP`).

### Innlogging

`getAuth()` i `background.js` spør først content-scriptet i en app.dele.no-fane med `tabs.sendMessage`. Er det ikke injisert (Firefox MV3 ved oppstart), leser den `localStorage` direkte med `scripting.executeScript`, derfor `scripting`-tillatelsen. Uten åpen app.dele.no-fane får synken ingen innlogging og stopper med `NOT_LOGGED_IN`. 401 gir `AUTH_EXPIRED`, og siden ber background nullstille innloggingen med `CLEAR_AUTH`.

### Storage-nøkler

Alt ligger i `browser.storage.local`.

| Nøkkel           | Struktur                                                                                    | Skrives av                         |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| `reservations`   | Array av fulle reservasjonsobjekter (detaljsvar), hver med `detailFetchedAt` (ms)           | `lib/sync.js`                      |
| `lastSync`       | Tidspunkt (ms) for siste fullførte synk                                                     | `lib/sync.js`                      |
| `syncState`      | `{ phase, initial, startedAt, pendingIds, failed, total, done, calls, reason?, pausedAt? }` | `lib/sync.js`                      |
| `syncLock`       | `{ owner, expiresAt }` eller null                                                           | `lib/sync.js`                      |
| `syncHistory`    | De tre siste synkene: `{ startedAt, durationMs, status, error, calls, fetched, failed }`    | `lib/sync.js`                      |
| `tripCategories` | `{ reservationId: categoryKey }`                                                            | dashbordet (brukerens valg)        |
| `transportData`  | `{ "2025": { taxi: {...}, buss: {...} } }`                                                  | dashbordet (brukerens valg)        |
| `userKeywords`   | `{ categoryKey: ["ord", ...] }`                                                             | dashbordet (egne nøkkelord, import) |

`reservations`, `lastSync` og sync-nøklene er API-data som bare synken skriver. `tripCategories`, `transportData` og `userKeywords` er brukerdata og slettes aldri av synken.

`reservations` inneholder bare detaljsvar, aldri listeelementer. Listesvaret mangler pris, km, `canceled`, `noTrips`, `car` og `created`, og har `location` som streng (se [api/README.md](api/README.md)). Et listeelement i `reservations` ville fått stats-funksjonene til å regne feil uten synlig feil. Id-er som venter på detalj, står i `syncState.pendingIds`.

### Filtrering

Stats-funksjonene bruker ett av to filtre fra `lib/stats.js`. Feil filter gir feil tall uten synlig feil.

- `filterValid()`: `canceled == null` og `price.total != null`. Tar med noTrips, siden brukeren betalte. Brukes av `costStats()`, `monthlyCosts()`, `yearlyCosts()`, `bookingPatterns()` og `currentMonthStats()`.
- `filterDriven()`: `filterValid()` og `!noTrips`, altså bare faktisk kjøring. Brukes av `usagePatterns()`, `mileageStats()`, `totalCO2()`, `monthlyCO2()` og funksjonene i `lib/ownership-cost.js`.

`bookingPatterns()` krever i tillegg `created != null` og dropper reservasjoner uten feltet, siden eldre data kan mangle det. Negative ledetider (booking opprettet etter start, rettelser, spontanbruk) settes til 0.

### Synk

Tallene for pauser, batcher, låsen, bryteren, fryseregelen, popupens grense og nye forsøk står i [api-bruk.md](api-bruk.md). `stats/test/docs.test.js` binder dem til konstantene i `lib/sync.js` og `lib/api.js`. Her står mekanismen.

- **Lås mellom sider:** `syncLock` er en lease (`LOCK_LEASE_MS`) som fornyes etter tid før et kall (`LOCK_RENEW_MS`) og forlenges over Retry-After-ventetider. Eierskapet sjekkes før hvert kall og hver skriving. Har en annen side tatt over, stopper synken med `BUSY` uten å skrive. Fornyelse per batch holdt ikke: med trege svar gikk leasen ut og to sider synket parallelt. Innen samme side deler parallelle kall ett løfte (`inFlight` i `sync-page.js`).
- **Lagre fortløpende:** etter listefasen skrives `syncState` med `pendingIds`. Detaljer hentes ett kall om gangen og lagres i batcher (`DETAIL_BATCH_SIZE`). En avbrutt synk fortsetter fra `pendingIds` neste gang en side åpnes, uten nytt listekall og uten å vente på timegrensen.
- **Paginering:** listen er sortert `start,desc`. Synken stopper på siden der den møter en kjent id, så sant kjente og nye id-er dekker `x-totalelements`. Førstegangssynk går til siste side. `full: true` tvinger full paginering.
- **Hvilke detaljer hentes:** nye reservasjoner, og lagrede som ikke er fryst (`DETAIL_REFRESH_MS`, `SETTLE_WINDOW_MS`). Data fra før `detailFetchedAt` fantes, bruker `lastSync` som hentetidspunkt.
- **Feil i tjenesten:** 429, 502, 503, 504 og nettverksfeil gir Retry-After eller backoff med jitter. Bryteren (`BREAKER_THRESHOLD`) stopper synken med `SERVICE_UNAVAILABLE`, lagrer det som er hentet og setter automatiske synker på pause (`SERVICE_PAUSE_MS`).
- **Feil per id:** et detaljkall som svarer 500, får opptil `ITEM_ATTEMPTS` forsøk i alt. 404 og annen 4xx prøves ikke på nytt. Deretter legges id-en i `syncState.failed` som `{ status, attempts, lastAttemptAt }`, og synken går videre. Slår bryteren ut på 5xx midt i en detalj, havner også den id-en i `failed`, så en reservasjon som alltid svarer 503 ikke stopper hver synk på samme sted. Automatiske synker prøver feilede id-er igjen etter `detailRetryDelayMs`. `force` (Synkroniser, Prøv igjen) prøver dem med en gang. Før dette ble id-en stående først i køen og låste synken for godt.
- **Når:** automatisk synk når en side åpnes, høyst én gang per `SYNC_INTERVAL_MS`. Synkroniser og Prøv igjen tvinger. Ingen bakgrunnspolling. Popupen begrenser detaljene med `POPUP_MAX_DETAILS`.
- **Telling:** `calls = { list, detail, retries, failed }` per synk, lagret i `syncHistory` og vist i utviklerpanelet (`?dev=1` på dashbordet).
- **Feil i UI:** synkfeil og delvise resultater vises i statusfeltet med Prøv igjen-knapp og overskrives ikke av tom-tilstanden. Tekstene står i `lib/sync-messages.js`.

`test/sync.test.js` kjører motoren mot fetch- og storage-stubs.

### Turkategorier

`lib/categories.js` har `DEFAULT_KEYWORDS`, en landsdekkende standardliste (kjeder, yrker, høytider, vanlige ord). Brukerens egne ord ligger i `userKeywords` og redigeres i kortet «Egne nøkkelord» i Turkategorier-seksjonen, med treff-tellere og JSON-eksport og -import. `mergeKeywords(DEFAULT_KEYWORDS, userKeywords)` fletter dem, og `suggestCategory()` og `autoSuggestAll()` får den flettede listen som parameter, så modulen forblir ren.

Matchingen er substring mot `notes` (små bokstaver, ingen ordgrenser). Første kategori som matcher vinner, så `handletur` ligger før `hoytid` for at «juleshopping» havner riktig. Flettingen beholder kategorirekkefølgen fra `DEFAULT_KEYWORDS`, legger brukerens ord først innen hver kategori og setter kategorier som bare brukeren har ord i (f.eks. `helgetur`) sist. Et manuelt valg i `tripCategories` overstyrer alltid.

## Flex

### Moduler

- `content.js`: klassisk script på app.dele.no. Leser tokenet og skriver det til `authToken` ved hver sidelasting, så polleren har noe å gå på når ingen fane er åpen.
- `background.js`: `getAuth()` (content-scriptet først, `scripting.executeScript` som reserve), proxy for `SEARCH` og `GET_LOCATIONS`. Nullstiller innloggingen ved `AUTH_EXPIRED`. Eier varslene: eneste som skriver `watches`, poller med `alarms` (`pollWatches`) og sender varsler.
- `lib/search-api.js`: `searchAvailability()` og `fetchLocations()`, med 50 ms pause og backoff ved 429.
- `lib/places.js`: `stationPlaces()` gjør `/locations` om til ett punkt per stasjon (snittet av hjørnene). Finderen tilbyr i tillegg «Min posisjon» og «Husk stedet».
- `lib/flex.js`: motoren, `freeBlocks`, `fitCar`, `solve` (bøttene whole, adjusted og siblings) og `splitPairs`. `matchesFilters` og `withinDistance` gjenbrukes av `watch.js`. Søket filtreres alltid til `ORG_BILDELERINGEN` og et avstandstak (`REGION_CEILING_M` i `finder.js`), se Tromsø i [api/README.md](api/README.md).
- `lib/watch.js`: `detectHits(searchResult, watch, window)` og `reconcile(hits, notified, now)`.
- `lib/relay.js`: vasker relay-adressen (https, eller http mot localhost) og lager match-mønsteret for tillatelsen.
- `lib/format.js`: `parseLocalISO` og `toLocalISO`, naiv lokal ISO uten tidssone.
- `lib/storage.js`: lagrede steder (`DEFAULT_PLACES` er tom fordi koden er offentlig), overvåkninger og varselinnstillinger.
- `finder.html/js/css`: søket, med «Overvåk dette søket». `watches.html/js`: overvåkninger og innstillinger, også `options_ui`. `popup/`: inngang til begge.

### Storage-nøkler

| Nøkkel           | Struktur                                                                                                | Skrives av                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `watches`        | Array av `{ id, point, filters, earliestStart, latestEnd, minHours, active, lastChecked, notified, … }` | bare `background.js`, sidene sender meldinger                 |
| `authToken`      | `{ token, ts }`                                                                                         | `content.js`, background nullstiller ved 401                  |
| `notifySettings` | `{ backendUrl, backendToken, pollMinutes }`                                                             | background via `SAVE_SETTINGS`                                |
| `places`         | Brukerens lagrede steder                                                                                | `finder.js` via `savePlace()`                                 |

### Varsler

En overvåkning er et sted med filtre over et tidsvindu. Den varsler når en bil blir ledig en sammenhengende blokk på minst `minHours`. Pollingen skjer i nettleseren, siden tokenet bare finnes i nettleserøkten, så den går bare mens Firefox er åpen.

Flyten: `alarms` (standard 15 min) → `pollWatches` søker per aktiv overvåkning → `detectHits` → `reconcile` → ett nettleservarsel og én POST til relayen per overvåkning. Relayen er en egen tjeneste i eget repo som sender videre til Signal.

- **De-dup-nøkkelen er `<carId>|<blokksluttISO>`, ikke blokkstart.** `freeBlocks` klipper blokkstart til vindusstart, og vindusstart er `max(earliestStart, nå)`. Når vinduet har begynt, flytter blokkstart seg for hver poll og ga nytt varsel hvert kvarter. Blokkslutt står stille.
- **Relay-feil dropper ikke varselet.** `notified` lagrer `{ notifiedAt, relayed }`. En mislykket POST står med `relayed: false` og prøves igjen neste runde uten nytt nettleservarsel. Relayen er den viktige veien, siden brukeren da er borte fra maskinen.
- **`detectHits` får det effektive vinduet eksplisitt**, det samme som søket brukte, og leser aldri `watch.earliestStart` selv.
- **Relay-adressen** settes på innstillingssiden og lagres i `notifySettings.backendUrl`. Tilgangen gis ved kjøretid med `permissions.request` for akkurat den verten (`optional_host_permissions`). Lagre-knappen må kalle `permissions.request` før første `await`, ellers regner ikke Firefox det som en brukerhandling og avviser kallet. Mangler tilgangen, kaster `relay()` og treffet står med `relayed: false` til tilgangen er gitt. Byttes adressen, trekkes tilgangen til den gamle verten tilbake.
