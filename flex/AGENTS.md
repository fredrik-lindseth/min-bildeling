# Flex: regler for agenter

Firefox-utvidelse ved siden av stats som finner *når* en bil er ledig, oppå dele.no sitt `/api/search`. Reglene i `../AGENTS.md` gjelder også her. Moduler, storage-nøkler og varselflyten står i `../docs/arkitektur.md`, søke-API-et i `../docs/api/README.md`, utseendet i `../docs/design.md`.

## Søk

- Ikke filtrer på organisasjon. Søket gir biler fra alle bilkollektivene på dele.no, og app.dele.no viser og booker dem alle. Om backend godtar booking på tvers av organisasjoner, er ukjent, se Organisasjoner i `../docs/api/README.md`.
- Avstandstaket `REGION_CEILING_M` regnes fra stedet brukeren velger og holder andre byer ute, også Tromsø-bilene.
- Biltypefilteret utelukker de brikkene som er slått av. Andre bilkollektiv kan ha biltyper finderen ikke har brikke for.
- Større radius kjører `solve` på nytt over samme svar, ikke et nytt kall.
- Ikke URL-enkod tidsdelen i lenker til app.dele.no.
- Ikke bruk `datetime-local`.

## Varsler

- Bare `background.js` skriver `watches`. Sidene sender meldinger.
- De-dup-nøkkelen er `<carId>|<blokkslutt>`, aldri blokkstart.
- `detectHits` får vinduet som parameter og leser aldri `watch.earliestStart`.
- En relay-feil skal ikke droppe varselet.
- Relay-adressen står aldri i koden. Den settes på innstillingssiden og får tilgang via `permissions.request`, som må kalles før første `await` i klikkhåndtereren.

## Publisering

`flex/icons/` er Dele sitt symbol og må byttes før flex publiseres, se `../docs/publisering.md`.
