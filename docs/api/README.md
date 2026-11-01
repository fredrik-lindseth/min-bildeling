# dele.no-API-et, uoffisiell dokumentasjon

Observert fra `app.dele.no` og brukt av begge utvidelsene: stats leser reservasjonene, flex bruker søket. Grunnadressen er `https://app.dele.no/api`.

## Filer

- `openapi.json`: OpenAPI 3.0-spec med alle observerte endepunkter og skjemaer
- `sample-reservation-driven.json`: eksempel på fullført tur med km og prislinjer
- `sample-reservation-notrip.json`: eksempel på booket, men ikke kjørt (noTrips=true, med gebyr)
- `sample-reservation-cancelled.json`: eksempel på avbestilt reservasjon
- `sample-historic-list.json`: eksempel på listesvaret fra `/reservations/historic`, de 14 feltene beskrevet under

## Autentisering

Token hentes fra `localStorage.getItem("persist:data")` på `app.dele.no`:

```js
const raw = JSON.parse(localStorage.getItem("persist:data"));
const token = JSON.parse(raw.authentication);       // Bearer token
const membershipId = JSON.parse(raw.selectedMembership).id;
```

Tokenet sendes som den rå verdien i headeren `authorization`, slik app.dele.no selv gjør. 401 betyr at det er utløpt. Tokenet bor bare i den originens localStorage, så begge utvidelsene trenger en åpen app.dele.no-fane for å få tak i det.

## Endepunkter

### GET /reservations/historic

Paginert liste over historiske reservasjoner.

```text
?page=0&size=100&sort=start,desc&membershipId={uuid}
```

Returnerer en array. Tom array, eller færre enn `size` elementer, betyr siste side. Svaret har headerne `x-totalelements` og `x-totalpages`.

Listeelementene er en slank variant med 14 felt: `id`, `reservationNumber`, `membershipId`, `start`, `end`, `effectiveStart`, `effectiveEnd`, `ended`, `state`, `notes`, `model`, `licensePlate`, `iconUrl` og `location`, der `location` er en streng (stedsnavnet). Pris, kjørte km, `canceled`, `noTrips`, `car` og `created` finnes bare i detaljsvaret. Sjekket mot ekte API 2026-11-01. `state` kan være `CANCELED` i listen.

### GET /reservations/{id}

Hele reservasjonen, 32 felt. Det er dette skjemaet utvidelsen lagrer og stats-funksjonene leser.

### Caching og grenser

Svarene har `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` og verken `ETag` eller `Last-Modified`, også autentisert. Betingede kall er derfor ikke mulig. Hvordan utvidelsen holder kallene nede, pauser og håndterer 429/5xx, står i [`docs/api-bruk.md`](../api-bruk.md).

## Viktige feltnavn

Feltene i detaljsvaret heter ikke det man ville gjettet. Navnene i parentes finnes ikke.

| Felt                        | Type           | Beskrivelse                                                         |
| --------------------------- | -------------- | ------------------------------------------------------------------- |
| `price.total`               | number         | Total kostnad i NOK (ikke `totalPrice`)                             |
| `price.lines[]`             | array          | Prislinjer: startavgift, timepris, km-pris, gebyr                   |
| `drivenKm`                  | integer\|null  | Kjørte kilometer, 0 eller null for noTrips (ikke `distance`)        |
| `car.model`                 | string         | Bilmodell, f.eks. «Toyota RAV4» (ikke `vehicleName`)                |
| `car.category`              | string         | Småbil / Minibil / Kombi / Stasjonsvogn / SUV / Varebil             |
| `car.properties[].groupKey` | string         | `FUEL_TYPE` → `name` = Bensin / Diesel / Elektrisitet               |
| `canceled`                  | datetime\|null | null = ikke avbestilt (ikke `status`)                               |
| `noTrips`                   | boolean        | Booket, men ikke kjørt. Kan ha kostnad > 0 (gebyr)                  |
| `notes`                     | string\|null   | Brukerens turnotater, grunnlaget for auto-kategorisering            |
| `start`, `end`              | datetime       | ISO-strenger                                                        |
| `state`                     | string         | PAST / ACTIVE / UPCOMING                                            |
| `location.name`             | string         | Hentestedets navn                                                   |
| `created`                   | datetime       | Opprettelsestidspunkt, gir hvor tidlig turen ble booket. Kan mangle |

## GET /search

Brukes av flex. Ikke med i `openapi.json`.

```text
?start=<lokal ISO>&end=<lokal ISO>&location=<URL-enkodet GeoJSON Point [lng,lat]>
```

- Svaret har **alle** biler i alle organisasjoner (rundt 356 i juli 2026), med `location.distance` i meter, men er ikke rent sortert på avstand. Avstandsfilteret gjøres klientside, så et nytt søk med større radius koster ikke et nytt kall.
- Hver bil har `availability[]`: sammenhengende segmenter med `state` = `AVAILABLE`, `RESERVED` eller `UNAVAILABLE`. Bare `AVAILABLE` kan bookes. Segmentene er ikke klippet til søkevinduet og er snappet til hel time.
- `carProperties[]` bruker `carPropertyGroup` og `carPropertyName` (f.eks. gruppen «Drivstoff»), ikke `groupKey` som reservasjonene.

## GET /locations

Stasjonene som GeoJSON (Point, LineString eller Polygon). Flex gjør dem om til ett punkt per stasjon.

## Lenker til app.dele.no

- `findcar?start=2026-07-10T23:00:00&end=…` virker med rå kolon. Med `encodeURIComponent` (`%3A`) viser appen «Invalid date», så tidsdelen skal ikke enkodes.
- En `location`-parameter i lenken ignoreres, appen faller tilbake til sitt standardpunkt. Bare tiden følger med.
- «Skjul opptatte biler» er ren klientfiltrering og kan ikke settes via lenken (sjekket i nettverksloggen).

## Organisasjoner og Bilparaplyen

dele.no hoster flere bilkollektiv i Bilparaplyen. Sjekket mot ekte API 2026-11-01 med et medlemskap i Bildeleringen:

| Organisasjon           | organizationId                         | `key`            |
| ---------------------- | -------------------------------------- | ---------------- |
| Bildeleringen          | `3212bcbe-8e34-4c28-9439-a44e6d5cf9c0` | `bildeleringen`  |
| Trondheim Bilkollektiv | `8dba8f19-c438-f278-ed7c-912ec6537cb9` | `bilkollektivet` |

- `GET /organizations` gir de to organisasjonene med `id` (lik `organizationId`), `name`, `key`, `supportUrl`, `priceListUrl`, `logoSvg` og supportkontakt. app.dele.no kaller den uten `authorization`, så listen er hele plattformen, ikke det medlemmet har tilgang til.
- `GET /users/whoami` gir `memberships[]`, og hvert medlemskap hører til nøyaktig én organisasjon (`organizationId`, `organizationName`, `membershipType.organizationId`). `membershipType.grantedByMembership` var `null`. Ingen felt sier hvilke andre organisasjoner medlemskapet gir tilgang til.
- `GET /search` gir biler fra begge organisasjonene for alle medlemmer, 231 fra Bildeleringen og 88 fra Trondheim Bilkollektiv. Bilene har `organizationId`, men ikke noe felt for om medlemmet kan booke dem, og `organizationName` mangler på bilen. `location.distance` regnes fra punktet i søket: fra Bergen ligger Trondheim-bilene 424–435 km unna, fra Trondheim ligger alle Trondheim-bilene innenfor 8 km.
- app.dele.no filtrerer ikke søkesvaret på organisasjon, og bookingen (`POST /reservations`) sender bare `membershipId`, `carId`, `start` og `end`.

Flex følger appen: alle biler i søkesvaret er med, og regionen avgjøres av avstanden fra stedet brukeren velger. Om backend avviser en booking på tvers av organisasjoner for noen medlemskapstyper, er ukjent.

### persist:data

`localStorage("persist:data")` på app.dele.no er et redux-persist-objekt der hver verdi er en JSON-streng: `authentication` (tokenet), `admin`, `userName`, `whoamiResponse` (samme som `/users/whoami`: `person`, `memberships[]`, `organizationPermissions[]`), `selectedMembership` (ett element fra `memberships[]`, med blant annet `id`, `organizationId`, `organizationName`, `membershipType`, `isOwner`, `defaultMembership`, `canCreateReservation`), `organizations` (samme som `/organizations`) og `_persist`. Origin har også `persist:reservations`, `persist:search` og `persist:searchData`.

Medlemskapsvelgeren i app.dele.no setter `selectedMembership`. Hvordan den ser ut med flere medlemskap i ulike organisasjoner, er ikke sjekket.

### Biltyper

`GET /search/filters` har biltypene Stasjonsvogn, Småbil, SUV, Varebil, 8/9-seter, Kombi og Kompakt SUV, mens Minibil ikke er med. Hvilke organisasjoner som bruker hvilke, er ikke sjekket.

### Tromsø

Organisasjonen alene sier ikke hvor bilen står. Bildeleringen administrerer noen biler i Tromsø, ca. 1 200 km fra Bergen, som bare beboerne kan bruke, for eksempel «Inga Sparboes veg» og «Malmvegen 99», med meldingen «Bilen kan kun brukes av beboere i …» i `messages[]`. De har Bildeleringens `organizationId`. Flex luker dem ut med et avstandstak på 100 km fra stedet brukeren har valgt framfor å tolke meldingene.
