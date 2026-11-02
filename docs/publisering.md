# Publisering

Repoet har to Firefox-utvidelser med hver sin gecko-id, så de signeres og distribueres hver for seg.

| Mappe    | Navn                    | Gecko-id                       |
| -------- | ----------------------- | ------------------------------ |
| `stats/` | Bildeleringen Stats     | `delebil@fredriklindseth.no`   |
| `flex/`  | Bildeleringen Fleksibel | `bildeleringen-flex@extension` |

Stats går ut på addons.mozilla.org (AMO) i denne rekkefølgen: unlisted, signert xpi, installert og verifisert i Fredriks egen Firefox, og først når Dele har sagt ok, listed. Chrome Web Store følger samme løp, se [Chrome](#chrome) nederst. Flex har ikke eget `package.sh` ennå og kommer når den skal ut.

## 1. Bygg zip-ene

Øk `"version"` i `stats/manifest.json` først, så kjør fra repo-roten:

```bash
./stats/scripts/package.sh     # gir stats/dist/bildeleringen-stats-v<versjon>.zip og -chrome-v<versjon>.zip
```

Chrome-zip-en er de samme filene med et manifest uten Firefox-nøklene (`browser_specific_settings`, `theme_icons`, `background.scripts`) og med `minimum_chrome_version` (grensen står i scriptet), laget av `stats/scripts/chrome-manifest.mjs`. `stats/manifest.json` er fortsatt eneste kilde. Utpakket ligger den i `stats/dist/chrome/`.

`package.sh` kjører kontrast- og stilsjekken først og byggevakten `stats/scripts/sjekk-pakke.sh` på begge de ferdige zip-ene, og sletter pakkene ved funn. Vakten ser etter e-post, telefonnummer, koordinater, eyJ-tokens, ukjente UUID-er, dataeksporter (`bildeleringen-*.json`), testfiler, svg-kilder, `listing/`, `.DS_Store`, vendor-filer som ikke stemmer med `stats/scripts/vendor.sha256` og farger utenfor `:root` i CSS. Funn meldes som fil og linje, uten innholdet. Navn, arbeidsgiver, adresse og stedsnavn står bare i `~/.config/bildeleringen/persondata.txt`, én regex per linje, aldri i repoet. Mangler filen, gir vakten en advarsel. Manifestkravene til AMO (`data_collection_permissions` og en høy nok `strict_min_version`, grensen står i scriptet) er feil, ikke advarsler. Chrome-zip-en sjekkes med `--chrome`, som krever at Firefox-nøklene er borte og at `minimum_chrome_version` er høy nok. Ny vendor-versjon krever ny sjekksumliste, og `stats/scripts/sjekk-pakke.test.sh` viser at vakten slår til.

Pakken har med `LICENSE`, men ikke README, siden README viser skjermbilder som ligger utenfor pakken.

## 2. Send inn som unlisted

Lag API-nøkler på [addons.mozilla.org/developers/addon/api/key/](https://addons.mozilla.org/developers/addon/api/key/) og legg dem i `~/.config/bildeleringen/amo.env` (chmod 600, aldri i repoet) som `AMO_JWT_ISSUER=...` og `AMO_JWT_SECRET=...`, én per linje. Scriptet leser filen selv når variablene ikke alt står i miljøet, `AMO_ENV` peker på en annen fil, og en fil som er lesbar for andre gir advarsel.

```bash
./stats/scripts/amo-upload.sh          # tørrkjøring: pakker og sjekker nøklene
./stats/scripts/amo-upload.sh --yes    # laster opp, venter på signering, laster ned xpi-en
```

Scriptet bruker curl, openssl, jq og node (bare innebygd crypto, ingen npm) mot AMO-API-et v5. Det laster opp zip-en med `channel=unlisted`, venter til valideringen er ferdig, oppretter tillegget (eller en ny versjon) med lisens MIT og legger den signerte xpi-en i `stats/dist/bildeleringen-stats-v<versjon>-signert.xpi`. Tar signeringen mer enn ti minutter, lastes xpi-en ned fra [utviklersiden](https://addons.mozilla.org/developers/addons) i stedet. Det samme kan gjøres for hånd der: «Send inn et nytt tillegg», velg «På egenhånd» og last opp zip-en.

Notatet til reviewer står på engelsk i [amo-listing.md](amo-listing.md). Lim det inn under «Notes to Reviewer» på versjonen.

## 3. Installer og verifiser i egen Firefox

### Bytte til ny utgave

Den nye gecko-id-en gir Firefox et nytt lager. Det som er lagret under den gamle id-en (`bildeleringen-stats@extension`), blir ikke med. Gjør derfor dette i den gamle utgaven før den fjernes:

1. Sett `gecko.id` i `stats/manifest.json` midlertidig tilbake til `bildeleringen-stats@extension`, og last den gamle utgaven inn på nytt fra denne koden («Reload» i `about:debugging`), så den har «Sikkerhetskopi» nederst i dashbordet. Lageret følger id-en, så med den nye id-en i manifestet åpner dashbordet et tomt lager. Sett id-en tilbake før pakking.
2. Trykk «Eksporter alt» med «Ta med turene» på. Filen `bildeleringen-sikkerhetskopi-<dato>.json` har kategoriene, nøkkelordene, transporttallene, turene og `lastSync`, men ikke `syncState` eller `syncLock`.

Fjern så den gamle utgaven, og installer den signerte xpi-en permanent: `about:addons`, tannhjulet, «Installer tillegg fra fil». Åpne dashbordet. Med tomt lager starter det ikke synken, men spør «Har du en sikkerhetskopi?». Velg «Importer» der (eller under Sikkerhetskopi nederst). Dialogen viser hva filen har, og det som alt er lagret i den nye utgaven, står med mindre «Overskriv det som alt er lagret her» er krysset av. Turene flettes på id. Med turene og `lastSync` på plass henter synken etterpå bare nye turer, ikke hele historikken, og det sparer Dele for ett detaljkall per tur. Meldingen etter importen sier hvor mange turer, kategorivalg og nøkkelord og hvor mange års transporttall som ble lagt til. Har popupen alt begynt å synke, eller importeres filen mens dashbordet synker, stopper synken til importen er ferdig og fortsetter med det som mangler. Synker en annen dashbord-fane, venter importen på den.

Har den gamle utgaven ikke Sikkerhetskopi, tar den samme importen også de eldre enkeltfilene: «Eksporter kategorier» under Turkategorier, «Eksporter JSON» for nøkkelordene og turkopien fra `?dev=1`. Transporttallene må da skrives inn igjen for hånd.

Sjekk at:

- popupen og dashbordet åpner, og synken går ferdig mens du er innlogget på app.dele.no
- innloggingen finnes med en app.dele.no-fane som var åpen før installasjonen. Er fanen lastet ut (ikke vist siden omstart), sier popupen «Fanen må lastes på nytt», og knappen laster fanen og starter synken
- etter at tilgangen til app.dele.no er trukket tilbake i `about:addons`, sier popupen «Tilgang mangler», og «Gi tilgang» gir den tilbake
- med 25 av alle turene hentet viser popupen «–» for «Spart i år» og «Mest brukte bil», med teksten om at de vises når alle turene er hentet
- tallene stemmer med det du så i den gamle utgaven
- utvidelsen er der og virker etter omstart av Firefox

## 4. Listed

Når Dele har sagt ok, bytt tillegget til listed på AMO. Listingteksten, sammendraget og kategorien står i [amo-listing.md](amo-listing.md), personvernerklæringen i [personvern.md](personvern.md), skjermbildene i `skjermbilder/` og ikonet i `stats/icons/listing/icon-256.png`. Listed betyr strengere review, ofte for hånd.

## Release på GitHub

GitHub er kanonisk for releases og issues, så README lenker dit med absolutt URL. Fillenker er relative og virker også i det private speilet.

```bash
./stats/scripts/release.sh notater.md          # tørrkjøring
./stats/scripts/release.sh --yes notater.md    # tagg, push og publiser
```

Scriptet krever ren arbeidskopi på `main` og stopper hvis taggen `v<versjon>` finnes alt. Det kjører `package.sh`, lager en annotert tagg, pusher `main` og taggen til alle remotene og lager GitHub-releasen med begge zip-ene som vedlegg og notatfilen som tekst. `--title` setter tittelen (standard `v<versjon>`). Uten `--yes` kjøres bare sjekkene og pakkingen, og scriptet viser kommandoene det ville kjørt.

Versjonsrekken startet på nytt på 1.0.0 før AMO, og ingen eldre tagger finnes.

## Sjekk mot AMO-reglene

AMO sin linter (`addons-linter`) krever npm og er ikke kjørt. Valideringen ved opplasting er den samme linteren og stopper innsendingen ved feil. Pakken for 1.0.0 ble 1. november 2026 sjekket for hånd mot reglene på [extensionworkshop.com](https://extensionworkshop.com/documentation/publish/add-on-policies/):

- `manifest.json` er gyldig JSON med gecko-id, `strict_min_version` 140.0 og `data_collection_permissions: { required: ["none"] }`.
- Tillatelsene er `storage`, `unlimitedStorage`, `scripting` og `https://app.dele.no/*`. Ingen bred host-tilgang.
- Ingen `eval`, `new Function`, `document.write`, inline-script eller fjernlastet kode. All kode ligger i pakken.
- `innerHTML` får bare statisk markup eller verdier gjennom `escapeHtml()`. Linteren gir likevel advarsler på slike tilordninger, men de stopper ikke signering.
- Vendor-filene er uendrede, og sjekksummene stemmer med Chart.js 4.5.1 og html2canvas 1.4.1 på jsdelivr.
- Koden er ikke minifisert utenom vendor-filene, så kildekode trengs ikke i tillegg.
- Tokenet logges ikke og sendes bare til app.dele.no.
- `background` har både `scripts` og `service_worker`. Firefox bruker `scripts`.

## Automatisk oppdatering

Listed tillegg oppdateres av AMO. Et unlisted tillegg oppdateres ved å installere den nye xpi-en, eller med en `update_url` i manifestet som peker på en `updates.json` du hoster selv, se [Firefox Extension Workshop](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

Repoet bruker `package.sh` og `amo-upload.sh` framfor `web-ext`, siden `web-ext` krever npm.

## Chrome

Chrome Web Store tar Chrome-zip-en fra `package.sh`. Utviklerkontoen registreres av Fredrik. Teksten, begrunnelsene for tillatelsene, svarene om databruk og stegene står i [chrome-listing.md](chrome-listing.md). Rekkefølgen er den samme som på AMO: unlisted, installert og verifisert i egen Chrome, og offentlig når Dele har sagt ok.

Butikkene vil ha skjermbilder på nøyaktig 1280x800. `./stats/scripts/skjermbilder.sh --butikk` lager dem i `skjermbilder/butikk/` fra bildene som alt ligger i `skjermbilder/`, uten å ta nye. AMO tar de samme. Promobildet på 440x280 er `stats/icons/listing/promo-440x280.png`, rendret fra `promo.svg` med `stats/scripts/render-promo.sh`.

Chrome-utgaven ble 2. november 2026 lastet inn i Chrome 156 med en kastbar profil, uten advarsler. Popupen, dashbordet og årsoppsummeringen viste demodata og tomt lager uten konsollfeil, og service workeren svarte på `GET_DATA` og `GET_AUTH_STATUS`, også etter at den var stoppet. Med en falsk app.dele.no-side ble innloggingen lest både via innholdsskriptet og via `scripting.executeScript` i en fane som var åpen før installasjonen, en utlastet fane ga «Fanen må lastes på nytt» og ble lest etter ny lasting, og med tilgangen satt til «Ved klikk» sa popupen «Tilgang mangler». Ekte innlogging og synk mot dele.no, og dialogen bak «Gi tilgang», er ikke prøvd.
