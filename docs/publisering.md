# Publisering

Repoet har to Firefox-utvidelser med hver sin gecko-id, så de signeres og distribueres hver for seg.

| Mappe    | Navn                    | Gecko-id                                |
| -------- | ----------------------- | --------------------------------------- |
| `stats/` | Bildeleringen Stats     | `delebil-statistikk@fredriklindseth.no` |
| `flex/`  | Bildeleringen Fleksibel | `bildeleringen-flex@extension`          |

Stats går ut på addons.mozilla.org (AMO) i denne rekkefølgen: unlisted, signert xpi, installert og verifisert i Fredriks egen Firefox, og først når Dele har sagt ok, listed. Flex har ikke eget `package.sh` ennå og kommer når den skal ut.

## 1. Bygg zip-en

Øk `"version"` i `stats/manifest.json` først, så kjør fra repo-roten:

```bash
./stats/scripts/package.sh     # gir stats/dist/bildeleringen-stats-v<versjon>.zip
```

`package.sh` kjører kontrast- og stilsjekken først og byggevakten `stats/scripts/sjekk-pakke.sh` på den ferdige zip-en, og sletter zip-en ved funn. Vakten ser etter e-post, telefonnummer, koordinater, eyJ-tokens, ukjente UUID-er, dataeksporter (`bildeleringen-*.json`), testfiler, svg-kilder, `listing/`, `.DS_Store`, vendor-filer som ikke stemmer med `stats/scripts/vendor.sha256` og farger utenfor `:root` i CSS. Funn meldes som fil og linje, uten innholdet. Navn, arbeidsgiver, adresse og stedsnavn står bare i `~/.config/bildeleringen/persondata.txt`, én regex per linje, aldri i repoet. Mangler filen, gir vakten en advarsel. Manifestkravene til AMO (`data_collection_permissions` og en høy nok `strict_min_version`, grensen står i scriptet) er feil, ikke advarsler. Ny vendor-versjon krever ny sjekksumliste, og `stats/scripts/sjekk-pakke.test.sh` viser at vakten slår til.

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

Den nye gecko-id-en gir Firefox et nytt lager. Det som er lagret under den gamle id-en (`bildeleringen-stats@extension`), blir ikke med. Gjør derfor dette i den gamle utgaven før den fjernes:

1. Dashbordet, Turkategorier: «Eksporter kategorier».
2. Dashbordet, nøkkelordene under Turkategorier: «Eksporter JSON».
3. Transportkalkulatoren har ingen eksport. Skriv ned tallene.

Reservasjonene trenger ingen eksport, de hentes på nytt fra dele.no.

Fjern så den gamle utgaven, og installer den signerte xpi-en permanent: `about:addons`, tannhjulet, «Installer tillegg fra fil». Importer kategoriene og nøkkelordene, og legg inn transporttallene igjen. Sjekk at:

- popupen og dashbordet åpner, og synken går ferdig mens du er innlogget på app.dele.no
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

Scriptet krever ren arbeidskopi på `main` og stopper hvis taggen `v<versjon>` finnes alt. Det kjører `package.sh`, lager en annotert tagg, pusher `main` og taggen til alle remotene og lager GitHub-releasen med zip-en som vedlegg og notatfilen som tekst. `--title` setter tittelen (standard `v<versjon>`). Uten `--yes` kjøres bare sjekkene og pakkingen, og scriptet viser kommandoene det ville kjørt.

### Slette de gamle taggene

Versjonen starter på 1.0.0 igjen, og taggene v0.1.0, v1.0.0 og v1.1.0 fra før AMO må bort, ellers stopper `release.sh` på v1.0.0. Historikken beholdes. Kjør fra repo-roten:

```bash
for t in v0.1.0 v1.0.0 v1.1.0; do
  gh release delete "$t" --repo fredrik-lindseth/bildeleringen-stats --yes
  for r in $(git remote); do git push --delete "$r" "$t"; done
  git tag -d "$t"
done
```

`gh release delete` gir feil for en tagg uten release, og `git push --delete` for en tagg remoten ikke har. Begge kan overses.

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
