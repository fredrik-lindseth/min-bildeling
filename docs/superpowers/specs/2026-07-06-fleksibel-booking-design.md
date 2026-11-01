# Fleksibel booking: design

- **Dato:** 2026-07-06
- **Status:** Godkjent, klar for planlegging
- **Type:** Ny Firefox-utvidelse i monorepo, ved siden av stats-utvidelsen

## Bakgrunn

dele.no sitt søk svarer binært: du oppgir eksakt fra/til, og bilen er enten ledig
eller "opptatt". Den forteller aldri *når* en opptatt bil faktisk er ledig, og den
hjelper deg ikke hvis du har slakk i tidsplanen ("jeg trenger en bil ~4 døgn en
gang man–fre"). Appen viser en vag gul stolpe per bil, men ikke de konkrete lukene.

Vi bygger et fleksibilitets-lag oppå dele.no sitt eksisterende ledighets-API. Du
sier omtrent når og omtrent hvor, vi finner hva som faktisk passer, og sender deg
inn i dele.no for å fullføre bookingen.

## Mål

En egen Firefox-utvidelse ("Bildeleringen Fleksibel", arbeidstittel) som:

1. Viser tydelig ledig/opptatt-tidslinje for aktuelle biler.
2. Regner ut konkrete vinduer som passer en ønsket varighet med slakk.
3. Foreslår lik bil i nærheten når din er opptatt.
4. (Fase 1.5) Foreslår å dele en lang tur på to biler.

## Ikke-mål

- **Ikke** booke bilen selv i v1. Vi finner og viser, så deep-linker inn i dele.no.
  Faktisk skrive-booking krever kartlegging av et skrive-API og har pengerisiko, så det blir en
  egen, senere fase.
- **Ikke** gjenskape dele.no sitt kartsøk eller fulle filtersett. Bare det som
  tjener fleksibiliteten.
- **Ikke** overvåkning/varsling. Det er en separat design-runde (fellesferie-varsel
  når en bil blir ledig > 24 t). Fundamentet for "mine steder / mine biler" bygges
  her og gjenbrukes der.

## Repo-layout

Monorepo. Den eksisterende stats-utvidelsen flyttes til `stats/`, den nye til `flex/`.

```
bildeleringen/
  stats/        ← eksisterende utvidelse, flyttet uendret
  flex/         ← ny utvidelse
  docs/         ← delte dokumenter (denne spec-en, API-notater)
```

Flyttingen av `stats/` er et isolert første steg: den fungerende utvidelsen skal
fortsatt laste og bygge etter flyttingen (verifiseres før noe annet).

## Reverse-engineert API

Utvidelsen bygger på ett hovedendepunkt, observert live fra app.dele.no.

### `GET /api/search`

```
GET https://app.dele.no/api/search
  ?start=<lokal ISO uten tidssone, f.eks. 2026-07-08T09:00:00>
  &end=<lokal ISO uten tidssone>
  &location=<URL-enkodet GeoJSON Point: {"type":"Point","coordinates":[lng,lat]}>
```

- Auth: `authorization: Bearer <token>`. Ingen `membershipId` nødvendig (i motsetning
  til `/reservations/historic`).
- `location` kan være vilkårlig koordinat, trenger ikke være en registrert stasjon.
- Svaret (~586 KB for Bergen) har topp-nivå: `start`, `end`, `location`, `cars`,
  `messages`, `before`, `after`. `before`/`after` er ukjent betydning (verdi 1/1),
  ikke nødvendig for oss.
- Returnerer alle biler i organisasjonen sortert med et `location.distance`-felt
  (meter), men *ikke* rent distansesortert, vi re-sorterer selv. Inneholder biler
  fra andre byer på hundrevis av km; vi filtrerer på distanse klientside.

### Bilobjekt i `cars[]`

Relevante felt: `carId`, `carNumber`, `licensePlate`, `model`, `modelId`,
`carCategory`, `seats`, `hourlyRate`, `iconUrl`, `carProperties[]` (drivstoff,
girkasse, hjuldrift, dyr), `location` (`id`, `name`, `distance`, `geojson`),
`maxAvailability`, og `availability[]`.

### `availability[]`: datamodellen

Liste av sammenhengende segmenter:

```json
{
  "start": "2026-07-07T15:30:00",
  "end":   "2026-07-07T18:00:00",
  "state": "AVAILABLE" | "RESERVED" | "UNAVAILABLE",
  "stateLabel": "Ledig" | "Reservert",
  "availabilityPercent": 0
}
```

- Kun `AVAILABLE` er bookbart. `RESERVED` og `UNAVAILABLE` (service/ute av drift)
  ekskluderes begge.
- Segmentene er **ikke** klippet til søkevinduet, de viser reell utstrekning for
  blokken (en bil reservert til 26. juli vises som ett segment til 26. juli selv om
  du søkte én uke). Grensene er snappet til hel time.
- Én bil kan ha ett segment (helt ledig eller helt opptatt i perioden) eller mange.

### Støtteendepunkter

- `GET /api/locations`: 331 stasjoner med `id`, `name`, `geojson` (Point, LineString
  eller Polygon). Brukes til stedsvalg. Hjem = "Eksempelveien", en av stasjonene
  i listen.
- `GET /api/search/filters`: filteralternativer (ikke kartlagt i detalj ennå).

## Arkitektur

Samme husregler som stats-utvidelsen (AGENTS.md): ingen build-step, vanilla
JS/HTML/CSS, ES modules, mørk modus påkrevd, norsk UI, alle farger via
`:root`-variabler, cross-browser via `typeof browser !== "undefined" ? browser : chrome`.

### Moduler

- **`content.js`**: content script på `app.dele.no`, leser `token` (+ `membershipId`
  om vi trenger det senere) fra `localStorage("persist:data")`. Samme teknikk som
  stats-utvidelsen. Klassisk script (ikke module).
- **`background.js`**: henter auth (content script først, `scripting.executeScript`
  som fallback), proxyer søkekall. Rate-limit 50ms + eksponentiell 429-backoff,
  gjenbrukt fra stats-mønsteret.
- **`lib/search-api.js`**: `searchAvailability(point, start, end, token)` →
  `GET /api/search`. `fetchLocations(token)`.
- **`lib/flex.js`**: fleksibilitets-motoren. Rene funksjoner, ingen sideeffekter,
  ingen browser-API. Tar søkeresultat + ønske-objekt, returnerer rangerte treff.
- **UI**: egen fullside (browser-fane). Liten popup som inngang ("åpne finner").
- **`storage.local`**: dine steder (hjem) og bil-favoritter/filtre. Fundamentet
  overvåkningen senere gjenbruker.

## Fleksibilitets-motoren (`lib/flex.js`)

### Ønske-objektet (input)

```js
{
  point: { lng, lat },        // fra lagret sted, geolokasjon, eller valgt stasjon
  earliestStart: Date,        // ytre grense: tidligst du kan starte
  latestEnd: Date,            // ytre grense: senest du må levere
  duration: Number | null,    // timer. null = "hele vinduet" (eksakt dekning kreves)
  filters: {
    category, fuel, seats,    // valgfrie
    maxDistanceM,             // for "nær meg"
    carIds                    // valgfritt: spesifikke biler ("mine biler")
  }
}
```

**Søket vi sender:** `start = earliestStart`, `end = latestEnd`, `location = point`.

### De fire beregningene

1. **Tidslinje**: normaliser `availability[]` for rendering. Triviell.

2. **Passende vinduer (per bil):** slå sammen tilstøtende `AVAILABLE`-segmenter til
   maksimale frie blokker, klipp til `[earliestStart, latestEnd]`. En blokk ≥
   `duration` gir gyldige plasseringer. Klassifiser:
   - **Eksakt**: blokk dekker hele `[earliestStart, latestEnd]`.
   - **Skyv**: blokk ≥ `duration` men ikke hele vinduet → foreslå tidligste
     passende delvindu (start = blokkstart, evt. snappet til hel time).
   - **Kort ned**: ingen blokk ≥ `duration` → største blokk, "nærmeste du kommer
     er X t, du ba om Y t".

3. **Søsken-bil:** beregning (2) over kandidatsettet filtrert på lik modell/kategori
   + innen `maxDistanceM`, sortert på distanse. "Din bil er opptatt, denne like er
   ledig hele vinduet 200 m unna."

4. **Del opp på to biler** (fase 1.5): for hardcasen "hele vinduet, ingen enkeltbil
   dekker", finn par (bilA, bilB) + overlevering T slik at A er ledig `[ES,T]` og B
   er ledig `[T,LE]`. Kandidat-T = unionen av segmentgrenser. Foretrekk samme stasjon
   for byttet, færrest overleveringer.

### Rangering

Eksakt før justert, så nærhet til ønsket starttid, så blokk-lengde (mer slakk =
bedre), så distanse.

### Kanttilfeller

- API-et bruker naiv lokal ISO uten tidssone (`2026-07-08T09:00:00`). Vi formaterer
  lokal veggklokke likt, ingen `Z`. Europe/Oslo antatt.
- Minste nyttige varighet som filter (unngå å foreslå 20-minutters luker).
- Distansefilter for "nær meg" gjøres klientside på `location.distance`.
- Segmenter snappet til hel time, regn med at grenser er hele timer.

## UI-flyt

Fullside, tre-kolonne på bred skjerm, stablet på smal.

```
┌─ ØNSKE ──────────┐ ┌─ RESULTATER ─────────────────────────────┐
│ Posisjon         │ │ ✓ Ledig hele ditt vindu (3)              │
│  [Hjem ▾]        │ │  #948 Yaris · Eksempelveien · 166m · 41kr │
│ Tidligst start   │ │  [▓▓▓▓░░░▓▓▓]  ← din luke grønn           │
│  [ons 08.07 09:00]│ │  [Åpne i dele.no]                        │
│ Senest slutt     │ │                                          │
│  [fre 10.07 17:00]│ │ ~ Passer med justering (5)               │
│ Varighet         │ │  #935 Yaris · skyv start til tir 20:00   │
│  ( ) Hele vinduet│ │  [░░▓▓▓▓▓▓░░]                             │
│  (•) [4] døgn    │ │                                          │
│ Filtre           │ │ ⇄ Lignende bil i nærheten (4)            │
│  Biltype, drivst.│ │  #1108 Yaris Cross · Testgata · 844m   │
│  Maks gange [1km]│ │                                          │
│ [Søk]            │ │ ⧉ Del opp på to biler (fase 1.5)         │
└──────────────────┘ └──────────────────────────────────────────┘
```

Hver bilrad: modell, nummer/skilt, stasjon + distanse, timepris, og en horisontal
tidslinje (grønn ledig / grå opptatt) med ønsket vindu markert. Grønn/grå/markør via
`:root`-variabler med mørk modus-override.

## Handoff / redirect

Hvert treff har "Åpne i dele.no" → ny fane til
`https://app.dele.no/findcar?start=<ISO>&end=<ISO>`. Tid deep-linker (bevist live).
Posisjon følger **ikke** med (koordinat-parameteren ignoreres av app-en, den faller
tilbake til default), så vi viser stedsnavnet så brukeren velger det med ett trykk i
dropdown-en. Godkjent som "godt nok for v1". Under implementering: undersøk om det
finnes en bedre per-bil booking-URL.

## Faser

- **v1**: finner (nivå 1–3: tidslinje, passende vinduer, søsken-bil) + redirect.
- **Fase 1.5**: del-opp-på-to (nivå 4).
- **Senere**: faktisk booking i utvidelsen (krever kartlegging av skrive-API);
  overvåkning/varsling (egen design-runde).

## Testing

`lib/flex.js` er rene funksjoner, unit-testes mot ekte `/api/search`-fixtures. Et
reelt uke-svar er allerede fanget under kartleggingen; en anonymisert variant legges
i repoet som fixture. Repoet har ingen testrunner i dag → vi legger til en minimal
node-basert (`node --test`, ES modules kjører rett) uten build-step.

## Åpne spørsmål / risiko

- Betydningen av `before`/`after` i søkesvaret er ukjent (ikke blokkerende).
- `/api/search/filters` ikke kartlagt i detalj, kartlegges ved behov for filter-UI.
- Flytting av eksisterende utvidelse til `stats/` må ikke bryte den, verifiseres først.
- Per-bil deep-link ikke funnet ennå, v1 aksepterer stedsnavn + ett trykk.
