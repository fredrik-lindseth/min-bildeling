# Varsler: design

- **Dato:** 2026-07-16
- **Status:** Godkjent, klar for planlegging. Revidert etter kode-verifisert review
  (de-dup-nøkkel, auth, relay-retry, batching, skriver-samordning).
- **Type:** Utvidelse av flex-utvidelsen (deteksjon + browser-varsel) pluss en ny
  dedikert backend på serveren (relay til Signal). Fler-bruker-klar fundament.

## Bakgrunn

flex finner ledige biler på forespørsel: du spør, den svarer. Varsler snur det.
Du sier hva du vil ha, og vi sier ifra når det dukker opp. Fellesferie-caset: i
ferien er alt utleid, og du vil vite i det en bil frigjøres lenge nok til at du
kan gripe den.

Nettleser-varsel alene er svakt, du må sitte foran skjermen. Derfor relayer vi
treffet til Signal, så det når mobilen. **Relayen er den kritiske stien i
målscenarioet** (du er borte fra laptopen), ikke browser-varselet.

**Nøkkelbegrensning som styrer arkitekturen:** dele.no-token bor kun i
nettleser-sesjonen din (`localStorage("persist:data")` på app.dele.no). Serveren
har ingen egen dele.no-token og kan derfor ikke polle ledighet selv. Altså må
pollingen skje i nettleseren, der token finnes. Serveren er kun budbringer.

Konsekvens, ærlig sagt: overvåkningen poller bare mens Firefox er åpen på
laptopen. Vi kan ikke watche 24/7 uten en dele.no-token på serveren, som hadde
vært en verre secret-eksponering og uansett utløper. Gevinsten er likevel reell:
laptopen oppdager, og relayen gjør at du får pinget på mobil selv om du ikke
sitter foran skjermen.

## Mål

1. Overvåk et sted + valgfrie filtre over et ytre tidsvindu, og varsle når en
   matchende bil blir ledig i en sammenhengende blokk ≥ en valgt terskel.
2. To varsel-kanaler per treff: browser-varsel lokalt (umiddelbart) og relay til
   Signal via en dedikert backend (når mobil).
3. Backend bygget fler-bruker-klar (abonnenter med token + kanal), men v1 har kun
   én abonnent: eierens varselkanal.

## Ikke-mål

- **Ikke auto-book.** Egen design-runde. Krever dele.no sitt skrive-API (book +
  avbestill, ikke kartlagt, "feil koster penger") og en server-side avbook-timer
  som overlever at laptopen sovner. Se Oppfølging.
- **Ikke 24/7 server-side polling.** Krever dele.no-token på server.
- **Ikke fler-bruker-onboarding i v1.** Backend-strukturen støtter flere
  abonnenter, men v1 legger inn eierens rad manuelt.
- **Ikke e-post-kanal i v1.** Backend-dispatchen er kanal-agnostisk, men Signal
  bygges først. Resend-e-post er skissert for fler-bruker senere.

## Repo-oppdeling

To repo, koblet av én webhook-POST:

- **`bildeleringen/flex/`**: watch-modell, deteksjon, poller, dispatcher, UI.
  All browser-side kode.
- **`backend/`**: dedikert `bildeleringen-backend` som tar imot treff og
  relayer til Signal. Bygges i backend-repoet; kontrakten under er
  fast.

## Arkitektur / dataflyt

```
flex-utvidelsen (laptop, mens Firefox er åpen)
  alarms vekker background.js hver ~15 min
    → for hver aktiv, ikke-utløpt overvåkning:
        vindu = { start: max(earliestStart, nå), end: latestEnd }
        searchAvailability(point, vindu, token)          [lib/search-api.js]
        hits = detectHits(searchResult, watch, vindu)    [lib/watch.js, ren]
        { browserHits, relayHits, notified } =
              reconcile(hits, watch.notified, nå)         [lib/watch.js, ren]
        hvis browserHits: ÉN oppsummerende browser-notifikasjon
        hvis relayHits og backend: ÉN POST med treffliste; ved 200 → relayed=true
        skriv watch (via background, eneste skriver)

backend  (bildeleringen-backend, 24/7)
  POST /api/notify  (Bearer <abonnent-token>)
    → slå opp abonnent (token-hash) i SQLite
    → formater ÉN norsk melding fra trefflista
    → varsel-api /send  →  Signal   (v1)
    (senere: Resend → e-post)
```

## Watch-modellen

Én overvåkning er et lagret flex-ønske pluss én terskel. Lagres i
`storage.local` under nøkkelen `watches` (array). **Kun `background.js` skriver
til `watches`** (se Samordning under).

```js
{
  id,                    // stabil id (timestamp + teller, ikke Math.random)
  label,                 // "Ferie hjem, 4 døgn"
  point: { lng, lat },   // fra et lagret sted
  placeName,             // for visning ("Eksempelveien")
  filters: {             // valgfrie, nøyaktig samme form som flex-ønsket
    organizationId,      // settes alltid = ORG_BILDELERINGEN (holder andre kollektiv ute)
    categories, fuels, seats, maxDistanceM, carIds
  },
  earliestStart,         // ISO (naiv lokal), ytre grense tidligst
  latestEnd,             // ISO (naiv lokal), ytre grense senest
  minHours,              // terskel: minste sammenhengende ledige blokk
  active,                // bool
  created,               // ISO
  lastChecked,           // ISO eller null, sist poller kjørte denne watchen
  notified: {            // de-dup-hovedbok, nøkkel = "<carId>|<blokksluttISO>"
    "<carId>|<blokksluttISO>": { notifiedAt, relayed }
  }
}
```

`earliestStart`, `latestEnd` og `filters` er nøyaktig samme form som flex sitt
ønske-objekt (inkl. `organizationId`), så "Overvåk dette søket" gjenbruker det
finder-siden allerede har bygget opp (`flex/finder.js` setter
`organizationId: ORG_BILDELERINGEN`).

### Hvorfor blokkslutt som de-dup-nøkkel

`freeBlocks` klipper blokkstart til vindusstart (`flex/lib/flex.js:21`), og
vindusstart er `max(earliestStart, nå)`. Så snart `nå` passerer `earliestStart`
flytter blokkstart for en pågående blokk seg for hver poll → ny nøkkel → nytt
varsel hvert kvarter. Blokkslutt er derimot stabil: den er starten på neste
booking eller `latestEnd`, uendret på tvers av polls. En blokk som forlenges bak
(avbestilling) får ny, senere blokkslutt → nytt varsel, som er ønsket (tilbudet
ble bedre).

### Storage-nøkler (nye)

| Nøkkel          | Struktur                       | Oppdateres av                           |
| --------------- | ------------------------------ | --------------------------------------- |
| `watches`       | Array av watch-objekter (over) | KUN background.js (UI sender meldinger) |
| `authToken`     | `{ token, ts }` eller null     | content.js (push ved sidelasting)       |
| `notifyBackend` | `{ url, token }` eller null    | UI (innstillinger)                      |
| `pollMinutes`   | number (default 15)            | UI (innstillinger)                      |

`places` og `favoriteCarIds` finnes alt fra flex og gjenbrukes. Ingen `authStale`-
nøkkel: polleren dømmer på `authToken` + pull-fallback (se Auth).

## Deteksjon og forsoning (`lib/watch.js`, ren)

Ren modul, samme husregel som `lib/flex.js`: data inn, resultat ut, ingen
browser-API, ingen storage, ingen sideeffekter. Her bor funn 1–3, så alt er rene
funksjoner som unit-testes.

### `detectHits(searchResult, watch, window) → Hit[]`

`window` er `{ start, end }` (Date), det **effektive** vinduet polleren søkte med,
gitt eksplisitt (funksjonen leser aldri `watch.earliestStart` selv).

1. Filtrer biler med `matchesFilters(car, watch.filters)` og
   `withinDistance(car, watch.filters)` fra `flex.js`.
2. Per bil: `freeBlocks(car.availability, window.start, window.end)` fra `flex.js`.
3. Behold blokker der `blockMinutes(b) >= watch.minHours * 60`.
4. Returner treff:
   ```js
   { carId, carNumber, model, category, location: {name, distance},
     blockStart, blockEnd, blockHours }   // blockStart/End er Date
   ```

**Liten refaktor kreves:** `matchesFilters` og `withinDistance` er i dag
modul-private i `flex.js` (`flex/lib/flex.js:116,127`). De eksporteres så
`watch.js` gjenbruker dem. `freeBlocks`, `blockMinutes` og `ORG_BILDELERINGEN` er
alt eksportert.

### `reconcile(hits, notified, now) → { browserHits, relayHits, notified }`

Ren de-dup + rydding + relay-retry. `notified` inn er hovedboka fra watchen,
`now` er en Date.

- Nøkkel per treff: `` `${hit.carId}|${toLocalISO(hit.blockEnd)}` ``.
- `browserHits` = treff hvis nøkkel **ikke** finnes i `notified` fra før (helt nye).
- `relayHits` = treff som er nye **eller** finnes med `relayed === false` (retry).
- Ny `notified` (retur):
  - Behold eksisterende nøkler der blokkslutt (parset fra nøkkelen med
    `parseLocalISO`) er `> now`. Dropp passerte (blokken er over).
  - For hvert treff denne runden: behold eksisterende oppføring hvis den finnes
    (bevar `relayed`-status), ellers `{ notifiedAt: now, relayed: false }`.

Polleren gjør så dispatch og setter `relayed = true` på de nøklene POST-en faktisk
lyktes med, før den skriver watchen. Slik overlever et Signal-ping en
backend-omstart: mislykket relay står som `relayed: false` og retryes neste runde
uten nytt browser-varsel.

## Poller (`background.js` + `alarms`)

Ny permission `alarms`. Ved oppstart:
`alarms.create("watch-poll", { periodInMinutes: pollMinutes || 15 })`. Default 15
min, konfigurerbar (kortere = mer API-last og batteri; `search`-svaret er ~586 KB).

`alarms.onAlarm` for `"watch-poll"`:

1. Last `watches`. Marker utløpte (`latestEnd <= nå`) som `active: false`.
2. Skaff token: bruk cachet `authToken` hvis satt, ellers `getAuth()`-pull (spør
   åpne dele.no-faner, `flex/background.js:18`). Ingen token: sett status
   "logg inn på dele.no", hopp over resten.
3. For hver aktive, ikke-utløpte watch, sekvensielt (rate-limit i
   `search-api.js` holder):
   - `vindu = { start: max(parseLocalISO(earliestStart), nå), end: parseLocalISO(latestEnd) }`
   - `searchAvailability(watch.point, vindu.start, vindu.end, token)`
   - `hits = detectHits(result, watch, vindu)`
   - `{ browserHits, relayHits, notified } = reconcile(hits, watch.notified, nå)`
   - **Batch:** hvis `browserHits.length`, ÉN browser-notifikasjon som
     oppsummerer ("3 biler ledige ≥ 96 t ved Eksempelveien"). Hvis
     `relayHits.length` og backend konfigurert, ÉN POST med hele listen.
   - Ved 200 fra POST: sett `relayed: true` på de relaykede nøklene i `notified`.
   - `watch.notified = notified; watch.lastChecked = nå` og lagre (background er
     eneste skriver).
   - 401 fra søket: tøm `authToken`, prøv `getAuth()`-pull neste runde.

## Auth (pull primært, push-cache som forlengelse)

flex har alt `getAuth()` som spør åpne app.dele.no-faner og faller tilbake til
`scripting.executeScript` (`flex/background.js:18-56`). Det er den pålitelige
stien så lenge en fane lever, og polleren bruker den som primær/fallback.

I tillegg pusher `content.js` token til `storage.local` (`authToken`) ved hver
dele.no-sidelasting, så polleren har noe å gå på når ingen fane er åpen akkurat
nå. Levetiden på den cachede tokenen er lik dens egen TTL.

**Tidlig oppgave (måle TTL):** dekod token (JWT `exp` hvis det er en JWT) og skriv
den målte TTL-en inn her. Er den kort, står anbefalingen "hold en app.dele.no-fane
åpen mens du overvåker" i UI-et, for hele nytteverdien hviler på at token holder.

Token ligger i `storage.local` på din egen maskin, samme tillitsgrense som
reservasjonsdataene stats alt lagrer. Den er aldri i repoet og krysser aldri til
serveren.

## Varsel-dispatcher

Per watch per runde, **batchet** (funn 5):

**1. Browser-varsel** (`notifications`-permission). Én
`browser.notifications.create` som oppsummerer `browserHits`
("3 biler ledige ≥ 96 t ved Eksempelveien" / "Yaris #948 ledig 104 t ved
Eksempelveien" ved ett treff). Klikk åpner finder-siden med watchens ønske
forhåndslastet. I Firefox gis notifications-permission ved installasjon og
`create()` lykkes selv om macOS undertrykker visningen, så det finnes ingen
"nektet"-feilgren å håndtere.

**2. Webhook-relay** til backend, kun hvis `notifyBackend` er satt. Én POST med
`relayHits`-listen. Ved 200: marker nøklene `relayed: true`. Ved feil: la dem stå
`relayed: false` (retry neste runde, uten nytt browser-varsel). Kort retry
innad i runden, men aldri drop-on-fail.

### Kontrakt: `POST /api/notify`

```
POST https://varsel.example.com/api/notify
Authorization: Bearer <abonnent-token>
Content-Type: application/json

{
  "watchLabel": "Ferie hjem",
  "place": "Eksempelveien",
  "hits": [
    { "car":  { "model": "Yaris", "number": "#948",
                "location": "Eksempelveien", "distanceM": 166 },
      "free": { "start": "2026-07-20T09:00:00",
                "end":   "2026-07-24T17:00:00", "hours": 104 },
      "deepLink": "https://app.dele.no/findcar?start=2026-07-20T09:00:00&end=2026-07-24T17:00:00" }
  ]
}
```

- `hits` er alltid en liste (batch per watch per runde). Backenden sender ÉN
  Signal-melding som oppsummerer.
- **Tidssone:** alle tider er naiv lokal ISO = Europe/Oslo veggklokke. Backenden
  skal kun formatere dem, aldri parse som UTC. `deepLink` sendes videre urørt:
  ikke URL-enkod eller reparse tidene, det gir "Invalid date" i dele.no-appen
  (kolon-gotchaen, `flex/AGENTS.md:51`).
- Svar: `200` (relayet), `401` (ukjent/utløpt token), `429` (rate-limit).

Utvidelsen trenger `https://varsel.example.com/*` i `host_permissions`
(eller CORS-alternativet, se Åpne spørsmål).

## Backend (`bildeleringen-backend`)

Bygges i backend-repoet og følger driftsrepoets
sjekkliste for nye tjenester.

- **Stack:** liten Python-stdlib-tjeneste (ingen pip), ett server-script.
  Eget image, kjører i egen container.
- **Host:** samme vert som varsel-API-et, som nås
  på et internt nettverk.
- **Proxy-rute:** `varsel.example.com`, `/api/*` → backend. Sikkerhetsheadere
  og rate-limit. **Ikke SSO** på ingest-stien
  (utvidelsen kan ikke SSO-logge inn); token-auth i stedet, dokumentert egen auth
  slik sjekklista tillater.
- **State:** SQLite `subscribers(token_hash, channel_type, channel_target, label,
  created)`. v1: én rad, `channel_type="signal"`, `channel_target=<gruppe-id>`.
- **Auth:** `Authorization: Bearer <token>`. Slå opp på `sha256(token)`,
  sammenlign med `hmac.compare_digest` (ikke klartekst-token i basen, ikke
  `==`). Ukjent → 401. Sett tak på request-body-størrelse.
- **Dispatch:** formater ÉN norsk melding fra `hits`-listen,
  `curl varsel-api /send`. Kanal-agnostisk, så Resend-e-post
  kan legges til senere uten å røre kontrakten. Tider formateres som Europe/Oslo
  veggklokke, aldri parset som UTC.
- **`/health`** for healthcheck. Porter bundet `127.0.0.1`.

Backenden har egne tester i backend-repoet.

## UI

Alt i flex, norsk, mørk modus, farger via `:root`, flex-designspråket. Alle
watch-mutasjoner går som meldinger til `background.js` (eneste skriver).

- **Finder-siden:** knapp "Overvåk dette søket" som lagrer gjeldende ønske pluss
  et `minHours`-felt. Valider `minHours ≤ (latestEnd − earliestStart)` i timer,
  ellers kan man lage en watch som aldri kan fyre.
- **"Mine overvåkninger":** ny visning med liste: label, vindu, terskel, status
  (aktiv / utløpt / venter på innlogging), `lastChecked`, av/på-bryter, slett.
- **Innstillinger:** backend-URL + abonnent-token (valgfritt; uten = kun
  browser-varsel), poll-intervall, og (hvis token-TTL er kort) hint om å holde en
  dele.no-fane åpen.

## Samordning: én skriver på `watches`

En poll-runde spenner flere nettverkskall og kan ta titalls sekunder med backoff.
Skriver både UI og poller til `watches` samtidig, kan pollerens lagring klobre en
sletting brukeren gjorde underveis. Løsning, som matcher stats sin
single-flight-lock: **all mutasjon av `watches` går som meldinger til
`background.js`**, som er eneste skriver. UI sender `ADD_WATCH`, `TOGGLE_WATCH`,
`DELETE_WATCH`, `UPDATE_SETTINGS`; background muterer og lagrer.

## Nye tillatelser (flex/manifest.json)

- `alarms`: bakgrunns-polling.
- `notifications`: browser-varsel.
- `host_permissions`: `https://varsel.example.com/*`: webhook-relay
  (eller CORS-alternativet, se Åpne spørsmål).

## Faser

- **v1**: deteksjon + browser-varsel + varsel-relay via dedikert backend.
- **Oppfølging (egne runder):**
  - E-post-kanal (Resend) i backend for fremmede brukere.
  - Fler-bruker-onboarding: hvordan en ukjent bruker registrerer kanal + får
    token. Signal er vanskelig for fremmede (må snakke med bot-nummeret), e-post
    er den lette veien.
  - **Auto-book med angrefrist:** grip bilen når den frigjøres, ~1 t før
    bookinggebyret slår inn, server-side timer avbooker automatisk hvis brukeren
    ikke bekrefter. Krever kartlegging av skrive-API-et, server-side token-
    forvaltning, og penge-sikkerhet. Egen design-runde.

## Testing

- `lib/watch.js` unit-testes med `node --test` mot fixtures. Kritiske scenarier
  (funn 1–3 bor her):
  - **Stabil de-dup over vindusstart:** samme pågående blokk over to polls, der
    `nå` har passert `earliestStart` mellom dem, gir treff begge runder men bare
    ÉN `browserHit` (nøkkel på blokkslutt er stabil).
  - **Relay-retry:** en nøkkel med `relayed: false` gir `relayHit` men ikke
    `browserHit` neste runde.
  - **Rydding:** en nøkkel med passert blokkslutt droppes fra `notified`.
  - **Forlenget blokk:** senere blokkslutt gir ny nøkkel og nytt varsel.
  - `detectHits`: terskelgrense (blokk akkurat på/under `minHours`), flere blokker
    per bil, filter-anvendelse, og et "bil frigjøres"-scenario bygget fra
    `search-sample.json`.
- Poller-orkestreringen (alarms, storage, dispatch) holdes tynn rundt de rene
  funksjonene og verifiseres i Firefox via firefox-devtools-MCP-en.
- Backend har egne tester i backend-repoet.

## Åpne spørsmål / risiko

- **Firefox event page (ikke service worker):** manifestet har begge nøklene, men
  Firefox kjører background som event page. Verifiser tidlig at (a) `alarms`
  vekker en sovnet event page, (b) in-flight `fetch` holder event-siden i live
  gjennom en hel poll-runde, og (c) den nye `host_permission` faktisk innvilges i
  devtools-profilen. **Alternativ hvis permission-grant blir styr:** la backenden
  svare CORS (inkl. `OPTIONS`-preflight for `Authorization`-headeren), da trengs
  ingen `host_permission` for relay-POST-en.
- **Token-TTL ukjent:** måles i den tidlige auth-oppgaven (dekod `exp`), og
  svaret skrives inn i Auth-kapittelet. Kort TTL → "hold en fane åpen"-hint i UI.
- **Poll-intervall vs. batteri/rate:** 15 min er en gjetning, justeres etter
  opplevd nytte.
- **varsel-api-reachability:** backenden må nå `varsel-api` på samme vert; løses ved å
  deploye backenden på samme vert. Bekreftes i backend-delegeringen.
- **Fler-bruker Signal:** å sende Signal til fremmede krever interaksjon med
  bot-nummeret, så e-post er den realistiske fler-bruker-kanalen. Ikke
  blokkerende for v1 (kun eieren).
