# Arkitektur

Lagring, synk, filtrering og varsler. Feltnavn og endepunkter står i [api/README.md](api/README.md), hva stats gjør mot API-et i [api-bruk.md](api-bruk.md), bygging og testing i [DEVELOPMENT.md](DEVELOPMENT.md).

## Stats

### Dataflyt

1. `content.js` leser token og `membershipId` fra `localStorage("persist:data")` på app.dele.no.
2. Popupen eller dashbordet kjører synken i siden via `lib/sync-page.js` og `lib/sync.js`.
3. Reservasjonene lagres i `browser.storage.local`, og sidene regner statistikken med de rene funksjonene i `lib/stats.js`, `co2.js` og `ownership-cost.js`.

Synken kjører ikke i background. Firefox avslutter MV3-event-pagen etter rundt 30 s uten API-aktivitet, også midt i åpne `fetch`-kall, og alt i minnet gikk tapt. Med DevTools koblet til skjer det ikke, så test uten. Background eier bare innloggingen (`GET_SYNC_AUTH`, `CLEAR_AUTH`, `GET_AUTH_STATUS`, `RELOAD_DELE_TAB`) og lesing (`GET_DATA`, `DEBUG_DUMP`).

### Innlogging

`probeAuth()` i `background.js` sjekker først host-tilgangen, siden `tabs.query` uten den gir en tom liste som ikke sier noe. Så spør den content-scriptet i hver app.dele.no-fane, og leser `localStorage` med `scripting.executeScript` når fanen var åpen før utvidelsen ble lastet. En utlastet fane (`tab.discarded`) har verken content-script eller side, så den prøves ikke.

`chooseAuthState()` i `lib/auth-state.js` gir én av fire tilstander:

- `ok`: tokenet ble lest.
- `no-permission`: host-tilgangen mangler. «Gi tilgang» kaller `permissions.request` direkte i klikket.
- `logged-out`: ingen fane, eller en lest fane uten innlogging. `localStorage` er felles for hele app.dele.no, så én lest fane avgjør.
- `reload-needed`: faner finnes, men ingen kunne leses. «Last inn fanen på nytt» laster en utlastet fane med `tabs.update` og egen adresse, siden `tabs.reload` gir en tom side.

Banneret bygges av `lib/auth-banner.js`. 401 gir `AUTH_EXPIRED`, som alltid er `logged-out`, og siden sender `CLEAR_AUTH`.

### Storage-nøkler

| Nøkkel             | Struktur                                                                                                  | Skrives av       |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `reservations`     | Detaljsvar, hver med `detailFetchedAt` (ms)                                                               | synken, importen |
| `lastSync`         | Siste fullførte synk (ms)                                                                                 | synken, importen |
| `syncState`        | `{ phase, initial, startedAt, pendingIds, failed, total, done, fetchedSoFar, calls, reason?, pausedAt? }` | synken, importen |
| `syncLock`         | `{ owner, role, expiresAt }` eller null, `role` er `page`, `popup` eller `import`                         | synken, importen |
| `syncHistory`      | De tre siste synkene med `calls`, status og varighet                                                      | synken           |
| `tripCategories`   | `{ reservationId: categoryKey }`                                                                          | dashbordet       |
| `transportData`    | `{ "2025": { taxi: {...}, buss: {...} } }`                                                                | dashbordet       |
| `userKeywords`     | `{ categoryKey: ["ord", ...] }`                                                                           | dashbordet       |
| `categorySettings` | `{ custom: { "egen-katt": { label } }, removed: { categoryKey: ["ord"] }, order }`                        | dashbordet       |

De fire siste er brukerdata og slettes aldri av synken. `reservations` har bare detaljsvar. Listesvaret mangler pris, km, `canceled`, `noTrips`, `car` og `created`, og et listeelement der ville gitt feil tall uten synlig feil.

### Sikkerhetskopi

`lib/backup.js` har rene funksjoner. `createBackup()` lager én fil med brukerdata og valgfritt turene. Filen har versjon 2 med `categorySettings`. Versjon 1 leses fortsatt, og gamle kategorinøkler i den flyttes til målet. `mergeBackup()` legger brukerdata til der de mangler, eller overskriver når brukeren krysser av. Turer flettes på id, og `lastSync` blir den nyeste. Sync-nøklene er aldri med.

Turene skrives under synklåsen (`importBackup()` i `lib/backup-import.js` med `withSyncLock()`), ellers ville en pågående synk skrevet over dem. Importen tar de importerte id-ene ut av `pendingIds` og `failed`, skriver alt i ett `storage.set` og slipper låsen. Synken som mistet låsen, stopper med `LOCK_LOST`, venter og henter bare det som mangler.

Ved første oppstart starter ikke dashbordet synken selv, men tilbyr import av en sikkerhetskopi først. Popupen synker som før.

### Filtrering

Feil filter gir feil tall uten synlig feil.

- `filterValid()`: ikke avbestilt og har pris. Tar med noTrips, siden brukeren betalte. Brukes til kostnader, årstall og bookingmønster.
- `filterDriven()`: `filterValid()` uten noTrips, altså faktisk kjøring. Brukes til km, CO₂, bruksmønster og eierkostnad.

`bookingPatterns()` dropper reservasjoner uten `created`, og negative ledetider settes til 0.

### Synk

Tallene står i [api-bruk.md](api-bruk.md), bundet til konstantene av `stats/test/docs.test.js`. Her står mekanismen.

- **Lås:** `syncLock` er en lease som fornyes etter tid, ikke per batch, siden trege svar ellers lot to sider synke samtidig. Eierskapet sjekkes før hvert kall og hver skriving. En tom lås regnes som tapt, fordi en import kan ha tatt og sluppet den. En popup-lås kan alltid tas over av dashbordet. En side som lukkes, slipper låsen på `pagehide`. En side som får `BUSY`, venter i `runSyncWhenFree` og fortsetter når låsen er ledig.
- **Lagre fortløpende:** `pendingIds` skrives etter listefasen, og detaljene lagres i batcher. En avbrutt synk fortsetter derfra.
- **Paginering:** listen er sortert `start,desc`, og synken stopper ved første kjente id så lenge kjente og nye dekker `x-totalelements`.
- **Hvilke detaljer:** nye, og lagrede som ikke er fryst.
- **Feil:** feil i tjenesten gir Retry-After eller backoff, og bryteren stopper synken. Feil per id legges i `syncState.failed` og prøves igjen etter `detailRetryDelayMs`, så én fast feil ikke låser synken.
- **Telling:** `calls = { list, detail, retries, failed }` per synk, vist i utviklerpanelet (`?dev=1`).

`test/sync.test.js` kjører motoren mot fetch- og storage-stubs.

### Turkategorier

`DEFAULT_CATEGORIES` og `DEFAULT_KEYWORDS` i `lib/categories.js` er landsdekkende, og ordlisten skal aldri ha personlige ord. Brukerens endringer lagres som avvik fra standarden, ikke som kopi: egne ord i `userKeywords`, og egne kategorier, fjernede standardord og rekkefølgen i `categorySettings`. `mergeKeywords()` fletter dem, så nye standardord fra en oppdatering kommer med. `order: null` betyr standardrekkefølgen, og den lagres i sin helhet første gang brukeren lager eller flytter en kategori. En standardkategori som mangler i en lagret rekkefølge, settes inn etter forgjengeren sin.

Egne kategorier har nøkler med prefikset `egen-` og et slug av navnet, og nøkkelen står når navnet endres. En ny kategori legges øverst, så den vinner over de andre til brukeren flytter den. Flyplass og Skyss er slått inn i Frakt/transport og Hyttetur i Aktivitet (`LEGACY_CATEGORIES`). `migrateLegacyCategories()` flytter lagrede valg og ord ved oppstart av dashbordet, og lesefunksjonene gjør det samme for det som ikke er flyttet ennå.

Et ord treffer i starten av et ord i notatet, så «lege» treffer «legevakt», men ikke «privilegert». Mellomrom til slutt krever helt ord. `*` først lar ordet også treffe sist i et ord, så «*besøk» treffer «bursdagsbesøket». `STOP_WORDS` fjerner kjente feiltreff, som «juli» for «jul». Første kategori i listen med treff vinner, så kategoriene med tydelig formål står først. `test/categories.test.js` har et korpus med oppdiktede notater.

Et valg i `tripCategories` overstyrer alltid forslaget. Slettes en egen kategori, fjernes valgene for den i samme skriving, og `knownTripCategories()` hopper over valg for kategorier som ikke finnes, så turen faller tilbake til forslaget eller ukategorisert. Listen «Sjekk forslag» er merket `data-html2canvas-ignore`, så notatene ikke blir med i «Last ned bilde».

### Estimater

| Estimat               | Kilde                                                |
| --------------------- | ---------------------------------------------------- |
| Eierkostnader         | OFV kalkyle 2026 (elbil, 10 000 km), NAF             |
| Parkering             | Bergen eller Trondheim kommune, etter organisasjonen |
| Volvo EX40            | Antatt pris 600 000 kr, vanlig utstyrt, avrundet     |
| CO₂ bildeling         | Miljødirektoratet (per biltype)                      |
| Snittbil, km og CO₂   | SSB 12575 og 13931, 2024                             |
| CO₂ buss              | SSB, buss 2019 (~59 g/passasjer-km)                  |
| CO₂ taxi              | 0 g/km etter nullutslippskravet, før det 229 g/km    |
| CO₂ fly               | Avinor (~150 g/passasjer-km)                         |
| Substitusjonseffekter | TØI 1895/2022                                        |

Forutsetningene står med kilde og dato i `lib/referansebil.js` og `lib/snittbil.js`. Lokale verdier velges ut fra `organizationId`. For et år som pågår regnes faste kostnader for delen av året som er gått (`yearFraction`).

## Flex

### Moduler

- `content.js` skriver tokenet til `authToken` ved hver sidelasting, så polleren har noe å gå på uten åpen fane.
- `background.js` henter innloggingen, er proxy for `SEARCH` og `GET_LOCATIONS`, og eier varslene. Den er eneste som skriver `watches`.
- `lib/flex.js` er motoren (`freeBlocks`, `fitCar`, `solve`, `splitPairs`). Søket filtreres ikke på organisasjon, bare med et avstandstak fra valgt sted (`REGION_CEILING_M` i `finder.js`).
- `lib/watch.js` har `detectHits()` og `reconcile()`. `lib/relay.js` vasker relay-adressen.
- `lib/storage.js`: `DEFAULT_PLACES` er tom fordi koden er offentlig.
- Mangler innloggingen, åpner finderen app.dele.no i en fane uten fokus, ellers mister brukeren søkesiden.

### Storage-nøkler

| Nøkkel           | Struktur                                                                                     | Skrives av                         |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| `watches`        | `{ id, point, filters, earliestStart, latestEnd, minHours, active, lastChecked, notified }`  | bare `background.js`               |
| `authToken`      | `{ token, ts }`                                                                              | `content.js`, nullstilles ved 401  |
| `notifySettings` | `{ backendUrl, backendToken, pollMinutes }`                                                  | background via `SAVE_SETTINGS`     |
| `places`         | Brukerens lagrede steder                                                                     | `finder.js`                        |

### Varsler

En overvåkning varsler når en bil blir ledig en sammenhengende blokk på minst `minHours`. Pollingen går i nettleseren, siden tokenet bare finnes der: `alarms` → `pollWatches` → `detectHits` → `reconcile` → nettleservarsel og POST til relayen, som sender videre til Signal.

- **De-dup-nøkkelen er `<carId>|<blokkslutt>`, ikke blokkstart.** Blokkstart klippes til vindusstart, som flytter seg med tiden, og ga nytt varsel hvert kvarter.
- **Relay-feil dropper ikke varselet.** Treffet står med `relayed: false` og prøves igjen uten nytt nettleservarsel.
- **`detectHits` får det effektive vinduet** som søket brukte, og leser aldri `watch.earliestStart` selv.
- **Relay-tilgangen** gis med `permissions.request` for akkurat den verten. Lagre-knappen må kalle den før første `await`, ellers avviser Firefox kallet.
