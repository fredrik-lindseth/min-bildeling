# Slik bruker Min bildeling API-et til dele.no

Min bildeling er en nettleserutvidelse som viser et medlem statistikk over egen bildeling. Den leser bare reservasjonene til den som er innlogget, med medlemmets eget token fra app.dele.no. Dokumentet er skrevet for utviklerne hos Dele. En test binder tallene her til koden.

## Endepunkter

To endepunkter, begge GET:

| Endepunkt                                                                      | Brukes til                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `/api/reservations/historic?page=N&size=100&sort=start,desc&membershipId=<id>` | Listen over reservasjoner, 100 per side             |
| `/api/reservations/{id}`                                                       | Detaljene for én reservasjon (pris, kilometer, bil) |

Listen mangler pris, kilometer og bil, så detaljkallet trengs én gang per reservasjon. Alle kall har `authorization` med medlemmets token og `X-Client: min-bildeling/<versjon>`, så dere kan kjenne igjen trafikken.

## Når kall skjer

Bare når medlemmet har utvidelsen åpen:

- når dashbordet eller popupen åpnes og det er over én time siden forrige fullførte synkronisering
- når en avbrutt synkronisering skal fortsette
- når medlemmet trykker Synkroniser

Det er ingen bakgrunnspolling. En ny installasjon venter til medlemmet har valgt mellom å importere en sikkerhetskopi og å synkronisere, og med en kopi hentes bare det som er nytt.

Én synkronisering kjører om gangen, også med flere vinduer åpne. Låsen gjelder i 45 sekunder og fornyes hvert 15. sekund. Et vindu som har mistet låsen, for eksempel etter et svar som tok over 45 sekunder, stopper før neste kall. Popupen henter høyst 25 detaljer om gangen, og hver ny åpning henter 25 til. Resten hentes fra dashbordet.

## Hvor mange kall

Første gang hentes alle sider av listen og én detalj per reservasjon. 662 reservasjoner gir 7 listekall og 662 detaljkall, ett om gangen med 250 ms pause mellom dem. Det tar fire–fem minutter i en fane i forgrunnen. Detaljene lagres i grupper på 20, så en avbrutt synkronisering fortsetter der den slapp.

Senere leses listen bare til første kjente reservasjon, nesten alltid én side, med `x-totalelements` som kontroll. Detaljer hentes for nye reservasjoner og for de som fortsatt kan endre seg. Pausen er da 100 ms.

En reservasjon kan få endelig pris en stund etter at den er avsluttet. Detaljen hentes derfor på nytt høyst én gang i døgnet, til den er hentet minst sju dager etter reservasjonens slutt. Deretter aldri igjen.

API-et sender `Cache-Control: no-store` uten `ETag` eller `Last-Modified`, så betingede kall er ikke mulig. Med en `ETag` på detaljkallet kunne utvidelsen fått 304 tilbake.

En typisk dag med popupen åpnet to ganger og dashbordet én gang gir 4–6 kall. En dag uten nye turer gir ett listekall per åpning, med minst en time mellom.

## Feil

- **429, 502, 503, 504, nettverksfeil og 500 på listen** gjelder tjenesten. Utvidelsen venter så lenge `Retry-After` sier. Uten den venter den 2 s, så 4 s, med ±50 % tilfeldig variasjon.
- **Tre slike feil på rad** stopper synkroniseringen, og automatiske forsøk venter da i minst ti minutter. Ber `Retry-After` om mer enn to minutter, stopper den med en gang.
- **500 på en detalj** gjelder bare den reservasjonen. Den prøves én gang til, og svarer den 500 igjen, hoppes den over. Feiler tre ulike reservasjoner på rad med 5xx, regnes det som feil i tjenesten.
- **404 eller annen 4xx på en detalj** hopper over den reservasjonen.
- **401** stopper og ber medlemmet logge inn igjen.

En reservasjon som er hoppet over, prøves igjen tidligst etter én time, så etter fire, seksten og 64 timer, deretter én gang i uken. Svarer den 404 fire ganger, regnes den som slettet.

## Lagring

Svarene lagres i `browser.storage.local` på medlemmets maskin til medlemmet sletter dem. Ingenting sendes andre steder enn til dele.no. Utvidelsen har ingen analyse, sporing eller egen backend.

## Kontakt

Vil dere ha noe endret, som pauser, grenser eller en header, send en e-post til hei@fredriklindseth.no.
