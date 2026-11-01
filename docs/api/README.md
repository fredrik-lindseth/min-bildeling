# dele.no API: Uoffisiell dokumentasjon

Observert fra `app.dele.no`. Brukes av Bildeleringen Stats-utvidelsen.

## Filer

- `openapi.json`: OpenAPI 3.0 spec med alle observerte endepunkter og skjemaer
- `sample-reservation-driven.json`: eksempel på fullført tur med km og prislinjer
- `sample-reservation-notrip.json`: eksempel på booket men ikke kjørt (noTrips=true, har gebyr)
- `sample-reservation-cancelled.json`: eksempel på avbestilt reservasjon
- `sample-historic-list.json`: eldre eksempel som har detaljskjemaet. Det stemmer ikke med hva `/reservations/historic` faktisk returnerer, se under.

## Autentisering

Token hentes fra `localStorage.getItem("persist:data")` på `app.dele.no`:

```js
const raw = JSON.parse(localStorage.getItem("persist:data"));
const token = JSON.parse(raw.authentication);       // Bearer token
const membershipId = JSON.parse(raw.selectedMembership).id;
```

## Endepunkter

### GET /reservations/historic

Paginert liste over historiske reservasjoner.

```
?page=0&size=100&sort=start,desc&membershipId={uuid}
```

Returnerer en array. Tom array, eller færre enn `size` elementer, betyr siste side. Svaret har headerne `x-totalelements` og `x-totalpages`.

Listeelementene er en slank variant med 14 felt: `id`, `reservationNumber`, `membershipId`, `start`, `end`, `effectiveStart`, `effectiveEnd`, `ended`, `state`, `notes`, `model`, `licensePlate`, `iconUrl` og `location`, der `location` er en streng (stedsnavnet). Pris, kjørte km, `canceled`, `noTrips`, `car` og `created` finnes bare i detaljsvaret. Sjekket mot ekte API 2026-11-01. `state` kan være `CANCELED` i listen.

### GET /reservations/{id}

Hele reservasjonen, 32 felt. Det er dette skjemaet utvidelsen lagrer og stats-funksjonene leser.

### Caching og grenser

Svarene har `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` og verken `ETag` eller `Last-Modified`, også autentisert. Betingede kall er derfor ikke mulig. Serveren kjører på Heroku. Hvordan utvidelsen holder kallene nede, pauser og håndterer 429/5xx, står i [`docs/api-bruk.md`](../api-bruk.md).

## Viktige feltnavn

| Felt | Type | Beskrivelse |
|---|---|---|
| `price.total` | number | Total kostnad i NOK |
| `price.lines[]` | array | Detaljert prisberegning (startavgift, timepris, km-pris, etc.) |
| `drivenKm` | integer | Kjørte kilometer (0/null for noTrips) |
| `car.model` | string | Bilmodell ("Toyota RAV4") |
| `car.category` | string | Småbil / Minibil / Kombi / Stasjonsvogn / SUV / Varebil |
| `car.properties[].groupKey` | string | `FUEL_TYPE` → name = Bensin / Diesel / Elektrisitet |
| `canceled` | datetime\|null | null = ikke avbestilt |
| `noTrips` | boolean | Booket men ikke kjørt (kan ha kostnad > 0) |
| `notes` | string\|null | Brukerens turnotater |
| `state` | string | PAST / ACTIVE / UPCOMING |
| `location.name` | string | Hentestedets navn |
| `created` | datetime | Opprettelsestidspunkt (for booking lead time) |

## Organisasjoner (dele.no er en flerorg-plattform)

dele.no hoster flere bilkollektiv. `GET /api/search` returnerer biler fra **alle** organisasjoner, ikke bare din egen. Hver bil har `organizationId` (men `organizationName` er `null` på bil-objektet, navnet står kun i søkesvarets `messages[]`). Filtrer på `organizationId` for å få kun Bildeleringen.

| Organisasjon | organizationId |
|---|---|
| Bildeleringen (Bergen) | `3212bcbe-8e34-4c28-9439-a44e6d5cf9c0` |
| Trondheim Bilkollektiv | `8dba8f19-c438-f278-ed7c-912ec6537cb9` |

**Tromsø-jokeren:** org-filter alene er ikke nok. Bildeleringen administrerer noen beboer-restringerte biler i Tromsø (~1200 km fra Bergen), f.eks. "Inga Sparboes veg" og "Malmvegen 99", med melding *"Bilen kan kun brukes av beboere i Eierseksjonssameiet …"*. De har Bildeleringen sin `organizationId`, men er irrelevante for et Bergen-søk. Fang dem med et distanse-/region-tak (flex bruker 100 km), ikke ved å parse restriksjons-meldingene.
