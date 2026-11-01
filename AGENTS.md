# Bildeleringen: regler for agenter

Repoet har to selvstendige utvidelser: `stats/` (statistikk) og `flex/` (fleksibelt booking-søk, regler i `flex/AGENTS.md`). Reglene under gjelder begge der ikke annet står.

## Les først

- `docs/DEVELOPMENT.md`: oppsett, tester, innlasting i Firefox via MCP og fallgruvene der.
- `docs/arkitektur.md`: storage-nøkler, synk, filtrering, turkategorier og flex-varsler.
- `docs/api/README.md`: feltnavn og endepunkter i dele.no-API-et. Feltene heter ikke det du gjetter (`price.total`, ikke `totalPrice`).
- `docs/design.md`: visuell retning. `docs/publisering.md`: pakking og utgivelse.

## Kode

- Ingen byggesteg. Vanilla JS, HTML og CSS, ingen bundler eller npm. Vendor-biblioteker i `stats/vendor/`.
- ES modules overalt, unntatt `content.js`.
- Cross-browser: `typeof browser !== "undefined" ? browser : chrome`. `lib/browser-polyfill.js` eksporterer `browserAPI` og `storage`.
- Rene funksjoner: `stats/lib/stats.js`, `co2.js`, `ownership-cost.js`, `categories.js` og `flex/lib/flex.js`, `watch.js` kaller aldri browser-API eller storage.
- Velg riktig filter (`filterValid` eller `filterDriven`). Feil filter gir feil tall uten synlig feil.
- `reservations` skal bare inneholde detaljsvar, aldri listeelementer.
- Synken skriver API-dataene. Brukerdata (`tripCategories`, `transportData`, `userKeywords`) slettes aldri ved synk.
- Synken kjører i siden, ikke i background. Test den uten DevTools koblet til tillegget.
- `docs/api-bruk.md` er skrevet for Dele og må stemme med koden. Endrer du en konstant i `sync.js` eller `api.js`, rett dokumentet. `stats/test/docs.test.js` feiler til det stemmer.
- Personlige ord (stedsnavn, navn, familie) skal aldri inn i `DEFAULT_KEYWORDS`. Koden er offentlig.

## UI

- Alle farger via CSS custom properties i `:root`, ingen hex eller rgb utenfor. Maks fem chart-farger (`--color-chart-1` til `-5`).
- Lys og mørk modus må virke (`prefers-color-scheme`). Nye variabler trenger mørk variant.
- Norsk UI-tekst. Console-logging kan være engelsk.
- Estimater (eierkostnad, CO₂) får «Slik beregner vi» med kilder og «ca.» eller «~» foran tallet.
- Bekreftelser bruker `<dialog>`, ikke `confirm`, `alert` eller `prompt`.

## Firefox

- Endringer i sidefiler: last fanen på nytt. Bare `background.js` og `manifest.json` krever ny installasjon.
- Ikon-PNG-ene rendres med `stats/scripts/render-icons.sh`, aldri for hånd.

## Ferdig

`cd stats && node --test` og `cd flex && node --test` skal være grønne.
