# Publisering

Dette gjelder stats (`delebil@fredriklindseth.no`). Flex har egen gecko-id og ikke noe `package.sh` ennå. Før den kan publiseres, må Dele sitt symbol i `flex/icons/` byttes.

Begge butikkene får samme løp: installert og sjekket i egen nettleser før den gjøres offentlig.

## Pakk

Øk `"version"` i `stats/manifest.json` og kjør fra repo-roten:

```bash
./stats/scripts/package.sh
```

Det gir `stats/dist/min-bildeling-firefox-v<versjon>.zip` til Firefox og `-chrome-v<versjon>.zip` til Chrome, pluss den utpakkede Chrome-utgaven i `stats/dist/chrome/`. Chrome-manifestet lages av `chrome-manifest.mjs` fra `stats/manifest.json`, som er eneste kilde. `manifest.json` er skrevet for Firefox: bakgrunnen står bare som `background.scripts`, fordi Firefox ignorerer `service_worker` og AMO-validatoren varsler om den, og `gecko_android.strict_min_version` er 142 fordi `data_collection_permissions` kom i Firefox for Android 142. Desktop står på 140. `chrome-manifest.mjs` gjør første script om til `service_worker` og fjerner `browser_specific_settings` og `theme_icons`.

Byggevakten `sjekk-pakke.sh` går over begge zip-ene og sletter dem ved funn. Den ser etter persondata, rot fra utviklingen, endrede vendor-filer og manglende manifestkrav, og melder fil og linje uten innholdet. Navn, adresser og stedsnavn står bare i `~/.config/bildeleringen/persondata.txt`, én regex per linje, aldri i repoet. Ny vendor-versjon krever ny `stats/scripts/vendor.sha256`.

Etter vakten validerer `valider.sh` pakkene: `addons-linter` 10.15.0 på Firefox-zip-en og en lasting i hodeløs Chrome for Chrome-utgaven. Eneste godtatte advarsel er `innerHTML` i `vendor/html2canvas.min.js`. Ny advarsel rettes i koden, eller føres i `TILLATT` i `valider.sh` med en grunn som tåler at revieweren leser den. Feiler valideringen, blir pakkene liggende til undersøkelse, men `package.sh` feiler, og da stopper også `release.sh`. `--uten-validering` er for bygg uten nett, ikke for innsending.

## AMO

Lag API-nøkler på [addons.mozilla.org/developers/addon/api/key/](https://addons.mozilla.org/developers/addon/api/key/) og legg dem i `~/.config/bildeleringen/amo.env` (chmod 600) som `AMO_JWT_ISSUER=...` og `AMO_JWT_SECRET=...`.

```bash
./stats/scripts/amo-upload.sh          # tørrkjøring
./stats/scripts/amo-upload.sh --yes    # sender inn som unlisted og henter den signerte xpi-en
```

Xpi-en havner i `stats/dist/min-bildeling-v<versjon>-signert.xpi` og blir liggende når `package.sh` kjører på nytt. Blir den ikke signert innen ti minutter, hent den fra [utviklersiden](https://addons.mozilla.org/developers/addons). Lim notatet til reviewer fra [amo-listing.md](amo-listing.md) inn under «Notes to Reviewer».

For å bli listed sendes en ny versjon inn i kanalen listed. Teksten står i [amo-listing.md](amo-listing.md), personvernerklæringen i [personvern.md](personvern.md), ikonet i `stats/icons/listing/icon-256.png`. Listed får strengere review, ofte for hånd. Unlisted oppdateres ved å installere ny xpi.

## Chrome Web Store

Utviklerkontoen registreres for hånd. Stegene, butikkteksten og svarene om tillatelser og databruk står i [chrome-listing.md](chrome-listing.md).

## Skjermbilder og promobilde

Butikkene vil ha 1280x800. `./stats/scripts/skjermbilder.sh --butikk` lager dem i `skjermbilder/butikk/` fra bildene som alt ligger i `skjermbilder/`. Uten flagget tas alle bildene på nytt, se [DEVELOPMENT.md](DEVELOPMENT.md). Promobildet til Chrome, `stats/icons/listing/promo-440x280.png`, rendres fra `promo.svg` med `./stats/scripts/render-promo.sh`.

## Sjekk i egen nettleser

Ny gecko-id gir nytt lager, så data under den gamle id-en (`bildeleringen-stats@extension`) blir ikke med av seg selv:

1. Sett `gecko.id` midlertidig tilbake til den gamle, last den gamle utgaven på nytt i `about:debugging`, og trykk «Eksporter alt» med «Ta med turene» under Sikkerhetskopi.
2. Sett id-en tilbake, fjern den gamle utgaven og installer den signerte xpi-en fra `about:addons` («Installer tillegg fra fil»).
3. Åpne dashbordet og velg «Importer» når det spør etter sikkerhetskopi. Med turene og `lastSync` på plass henter synken bare nye turer.

Sjekk så at:

- popupen og dashbordet åpner, og synken går ferdig mens du er innlogget på app.dele.no
- en app.dele.no-fane som var åpen før installasjonen, blir lest, og en utlastet fane gir «Fanen må lastes på nytt»
- med tilgangen trukket tilbake sier popupen «Tilgang mangler», og «Gi tilgang» gir den tilbake
- tallene stemmer med den gamle utgaven
- utvidelsen virker etter omstart av nettleseren

## Release på GitHub

```bash
./stats/scripts/release.sh notater.md          # tørrkjøring
./stats/scripts/release.sh --yes notater.md    # tagg, push og publiser
```

Krever ren arbeidskopi på `main` og en versjon uten tagg. Scriptet pakker, tagger `v<versjon>`, pusher til alle remotene og legger den signerte xpi-en og begge zip-ene ved releasen. Release krever at xpi-en finnes. `--title` setter tittelen.
