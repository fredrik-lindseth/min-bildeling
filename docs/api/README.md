# dele.no-API-et, uoffisiell dokumentasjon

Observert fra `app.dele.no` og brukt av Bildeleringen Stats.

## Filer

- `openapi.json`: OpenAPI 3.0-spec med alle observerte endepunkter og skjemaer
- `sample-reservation-driven.json`: eksempel på fullført tur med km og prislinjer
- `sample-reservation-notrip.json`: eksempel på booket, men ikke kjørt (noTrips=true, med gebyr)
- `sample-reservation-cancelled.json`: eksempel på avbestilt reservasjon
- `sample-historic-list.json`: eldre eksempel med detaljskjemaet, ikke det `/reservations/historic` returnerer (se under)

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

| Felt                        | Type           | Beskrivelse                                                   |
| --------------------------- | -------------- | ------------------------------------------------------------- |
| `price.total`               | number         | Total kostnad i NOK                                           |
| `price.lines[]`             | array          | Detaljert prisberegning (startavgift, timepris, km-pris osv.) |
| `drivenKm`                  | integer        | Kjørte kilometer (0/null for noTrips)                         |
| `car.model`                 | string         | Bilmodell («Toyota RAV4»)                                     |
| `car.category`              | string         | Småbil / Minibil / Kombi / Stasjonsvogn / SUV / Varebil       |
| `car.properties[].groupKey` | string         | `FUEL_TYPE` → name = Bensin / Diesel / Elektrisitet           |
| `canceled`                  | datetime\|null | null = ikke avbestilt                                         |
| `noTrips`                   | boolean        | Booket, men ikke kjørt (kan ha kostnad > 0)                   |
| `notes`                     | string\|null   | Brukerens turnotater                                          |
| `state`                     | string         | PAST / ACTIVE / UPCOMING                                      |
| `location.name`             | string         | Hentestedets navn                                             |
| `created`                   | datetime       | Opprettelsestidspunkt (gir hvor tidlig turen ble booket)      |

## Organisasjoner (dele.no er en flerorg-plattform)

dele.no hoster flere bilkollektiv. `GET /api/search` returnerer biler fra alle organisasjoner. Hver bil har `organizationId`, mens `organizationName` er `null` på bilen og navnet bare står i søkesvarets `messages[]`. Filtrer på `organizationId` for å få bare én organisasjon.

| Organisasjon           | organizationId                         |
| ---------------------- | -------------------------------------- |
| Bildeleringen (Bergen) | `3212bcbe-8e34-4c28-9439-a44e6d5cf9c0` |
| Trondheim Bilkollektiv | `8dba8f19-c438-f278-ed7c-912ec6537cb9` |

### Tromsø

Organisasjonsfilteret er ikke nok alene. Bildeleringen administrerer noen biler i Tromsø, ca. 1 200 km fra Bergen, som bare beboerne kan bruke, for eksempel «Inga Sparboes veg» og «Malmvegen 99», med meldingen «Bilen kan kun brukes av beboere i Eierseksjonssameiet …». De har Bildeleringens `organizationId`, men hører ikke hjemme i et søk i Bergen. Flex luker dem ut med et avstandstak på 100 km framfor å tolke meldingene.
