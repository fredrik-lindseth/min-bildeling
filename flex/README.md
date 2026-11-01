# Bildeleringen Fleksibel

Nettleserutvidelse for medlemmer i Bilparaplyen på [dele.no](https://dele.no), i Bergen, Trondheim og andre steder, som finner *når* en delebil er ledig. Søket på dele.no svarer bare ledig eller opptatt for et eksakt tidsrom, så er planen «en bil et sted man–fre», må du prøve deg fram. Utvidelsen leser hele ledig/opptatt-mønsteret og regner ut hva som passer. Den er laget av en bruker og er ikke tilknyttet Bildeleringen eller Dele AS.

## Funksjoner

- **Ledig hele vinduet**: biler som er ledige hele tidsrommet.
- **Passer med justering**: nesten-treff som «skyv start til tirsdag» eller «bare ledig ~53 t i strekk». Svært korte blokker skjules bak en egen knapp.
- **Del opp på to biler**: dekker ingen bil hele turen, foreslås et bytte underveis.
- **Tidslinje** per bil, grønn for ledig og grå for opptatt. Tidspunktet vises når du holder musen over.
- **Fleksibel varighet**: «hele vinduet» eller «N timer et sted i vinduet».
- **Filtre**: biltype og drivstoff, og gangavstand. Biler fra alle bilkollektivene på dele.no, innenfor 100 km fra stedet du velger.
- **Åpne i dele.no**: åpner dele.no med tiden fylt ut, justert til luken som passer.
- **Varsler**: få beskjed når en bil blir ledig lenge nok på et sted. Nettleservarsel, og valgfritt videre til Signal via egen backend. Sjekker mens Firefox er åpen.

## Installasjon

Krever Firefox 128 eller nyere.

1. Gå til `about:debugging#/runtime/this-firefox`
2. Klikk «Last inn midlertidig tillegg...» og velg `flex/manifest.json`

Du må være innlogget på [app.dele.no](https://app.dele.no) i en fane, for utvidelsen bruker den innloggingen. Er du ikke det, åpner den fanen for deg. Logg inn og søk på nytt.

Varsler via relay: åpne «Mine overvåkninger» fra popupen, fyll inn backend-URL og token, og trykk Lagre. Nettleseren spør om tilgang til adressen.

## Personvern

Ingen sporing. Søket og varslene bruker dele.no sitt API (`/api/search` og `/api/locations`) med innloggingen du alt har. Skrur du på relay, sendes treff-oppsummeringer til backenden du selv har satt opp. Ellers går ingenting til andre servere.

## Begrensninger

- dele.no leser bare tid fra en delt lenke, ikke sted. Utvidelsen viser stedsnavnet, så du velger stasjonen med ett trykk.
- Utvidelsen booker ikke selv. Den finner bilen og sender deg videre til dele.no.

## Varemerke

Ikonet er avledet av logoen til Dele AS, som er greit for privat sideloading. Før publisering trengs et eget symbol. Den lilla fargen `#51289D` er fri.

## Utvikling

Regler for utvikling står i [AGENTS.md](AGENTS.md), arkitektur og API-fakta i [docs/](../docs/). Tester: `node --test` fra `flex/`.

## Lisens

[MIT](../LICENSE)
