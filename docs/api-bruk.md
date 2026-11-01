# Slik bruker Bildeleringen Stats API-et til dele.no

Bildeleringen Stats er en nettleserutvidelse som viser et medlem statistikk over egen bildeling: kostnader, kilometer, bilvalg og CO₂. Den leser bare reservasjonene til den som er innlogget, med medlemmets eget token fra app.dele.no. Dokumentet er skrevet for utviklerne hos Dele, så dere kan se hva utvidelsen gjør mot API-et og hvor ofte.

## Endepunkter

Utvidelsen bruker to endepunkter, begge med GET, og ingen andre:

| Endepunkt                                                                      | Brukes til                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `/api/reservations/historic?page=N&size=100&sort=start,desc&membershipId=<id>` | Listen over medlemmets reservasjoner, 100 per side  |
| `/api/reservations/{id}`                                                       | Detaljene for én reservasjon (pris, kilometer, bil) |

Listen mangler pris, kjørte kilometer og bilinformasjon, så detaljkallet trengs én gang per reservasjon.

Alle kall har headeren `authorization` med medlemmets token, slik app.dele.no selv sender den, og `X-Client: bildeleringen-stats/<versjon>`, så dere kan kjenne igjen trafikken i loggene. User-Agent er nettleserens egen, siden en utvidelse ikke kan sette den.

## Når kall skjer

Kall skjer bare når medlemmet selv har utvidelsen åpen:

- når dashbordet eller popupen åpnes og det er over én time siden forrige fullførte synkronisering,
- når dashbordet eller popupen åpnes og en synkronisering ble avbrutt, uansett hvor lenge siden, så den fortsetter der den slapp, eller
- når medlemmet trykker Synkroniser eller Prøv igjen.

Det finnes ingen bakgrunnspolling, ingen alarmer og ingen synkronisering når nettleseren står i ro. Én synkronisering kjører om gangen, også med flere vinduer åpne. Vinduet som synkroniserer, holder en lås i det lokale lageret som gjelder i 45 sekunder og fornyes hvert 15. sekund. Lukkes vinduet, går låsen ut av seg selv. Har et vindu mistet låsen, for eksempel etter et svar som tok over 45 sekunder, stopper det før neste kall.

Popupen henter høyst 25 detaljer om gangen, siden den lukkes så fort medlemmet klikker utenfor. Hver ny åpning eller hvert trykk på Synkroniser i popupen henter 25 til. Resten hentes når dashbordet er åpent.

## Hvor mange kall

Første gang henter utvidelsen alle sider av listen og én detalj per reservasjon. Et medlem med 662 reservasjoner gir 7 listekall og 662 detaljkall. Kallene går ett om gangen med 250 ms pause mellom dem, så det tar rundt fire til fem minutter når fanen er i forgrunnen. Ligger den i bakgrunnen, holder Firefox igjen tidtakerne, og da tar det nærmere et kvarter. Detaljene lagres fortløpende i grupper på 20. Blir synkroniseringen avbrutt, fortsetter neste der den slapp, uten å hente noe på nytt.

Senere hentes listen bare til første side med en reservasjon utvidelsen kjenner fra før, og det er nesten alltid én side. Svarets `x-totalelements` brukes som kontroll: dekker kjente og nye reservasjoner ikke totalen, leses flere sider. Detaljer hentes for nye reservasjoner og for de som fortsatt kan endre seg. Pausen er da 100 ms.

### Hvilke detaljer hentes på nytt

En reservasjon kan få endelig pris og kilometer en stund etter at den er avsluttet. Utvidelsen henter derfor detaljen på nytt høyst én gang i døgnet, fram til den har en versjon hentet minst sju dager etter reservasjonens slutt. Deretter hentes den aldri igjen.

API-et sender `Cache-Control: no-store` og verken `ETag` eller `Last-Modified`, så betingede kall er ikke mulig i dag. Regelen over og pagineringen som stopper ved første kjente reservasjon, er utvidelsens cache. Med en `ETag` på detaljkallet kunne vi sendt `If-None-Match` og fått 304 tilbake.

### En typisk dag

Et medlem åpner popupen om morgenen, tar en tur på ettermiddagen og ser på dashbordet om kvelden:

| Tidspunkt                                      | Kall                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 08:00, popupen åpnes (over en time siden sist) | 1 listekall og 1–3 detaljkall for turer som sluttet den siste uken og ikke er hentet i dag |
| 08:30, popupen åpnes igjen                     | ingen                                                                                      |
| 21:00, dashbordet åpnes                        | 1 listekall og 1 detaljkall for dagens tur                                                 |

Det blir 4–6 kall den dagen. En dag uten nye eller nylig avsluttede turer gir ett listekall per åpning, med minst én time mellom.

## Når API-et svarer med feil

Utvidelsen skiller mellom feil i hele tjenesten og feil i én reservasjon.

- **429, 502, 503, 504 og nettverksfeil**, og 500 på et listekall, gjelder tjenesten. Utvidelsen venter så lenge `Retry-After` sier, i sekunder eller som dato. Uten `Retry-After` venter den 2 s, så 4 s, med tilfeldig variasjon på ±50 % så flere klienter ikke prøver samtidig.
- **Tre slike feil på rad** stopper synkroniseringen. Det som er hentet, er lagret, og medlemmet får beskjed om at tjenesten ikke svarer akkurat nå. Automatiske forsøk venter da i minst ti minutter. Ber `Retry-After` om mer enn to minutter, stopper synkroniseringen med en gang.
- **500 på en detalj** gjelder som regel bare den ene reservasjonen. Den prøves én gang til, og svarer den 500 igjen, hoppes den over og synkroniseringen går videre. Feiler tre ulike reservasjoner på rad med 5xx, regnes det som feil i tjenesten, og synkroniseringen stopper som over.
- **404 eller annen 4xx på en detalj** hopper over den ene reservasjonen.
- **401** stopper synkroniseringen og ber medlemmet logge inn på app.dele.no igjen.

En reservasjon som er hoppet over, prøves igjen ved senere synkroniseringer med økende mellomrom: tidligst etter én time, så etter fire, seksten og 64 timer, deretter én gang i uken. Svarer den 404 fire ganger, regnes den som slettet og prøves ikke igjen. Medlemmet ser hvor mange reservasjoner som mangler detaljer eller ikke kunne oppdateres, og kan prøve igjen med en gang ved å trykke Synkroniser.

## Hva som lagres, og hvor

Svarene lagres i nettleserens lokale utvidelseslager (`browser.storage.local`) på medlemmets maskin, sammen med tidspunktet hver detalj ble hentet. Dataene ligger der til medlemmet sletter dem eller fjerner utvidelsen. Ingenting sendes til tredjepart eller til servere utenfor dele.no. Utvidelsen har ingen analyse, sporing eller egen backend.

Utviklerpanelet i utvidelsen viser antall kall (listekall, detaljkall, nye forsøk og feil) for de tre siste synkroniseringene.

## Kontakt

Ser dere noe dere vil at vi endrer, for eksempel pauser, grenser eller en header, tar vi gjerne imot beskjed via kontaktadressen på utvidelsens side på addons.mozilla.org.
