# Publisering av utvidelsene

Dette repoet er et monorepo med to selvstendige Firefox-utvidelser:

| Mappe | Navn | Gecko-id |
|---|---|---|
| `stats/` | Bildeleringen Stats | `bildeleringen-stats@extension` |
| `flex/` | Bildeleringen Fleksibel | `bildeleringen-flex@extension` |

De signeres og distribueres hver for seg. Egne gecko-id-er = egen `.xpi` per utvidelse. Det finnes ingen delt signering.

## 1. Bygg zip-en

Hver utvidelse pakkes med sitt eget script (kjøres fra repo-roten):

```bash
./stats/scripts/package.sh     # → stats/dist/bildeleringen-stats-v<versjon>.zip
```

`flex/` får sitt eget `package.sh` (speil av stats sitt) når den er klar å shippe. Versjonen leses fra `manifest.json`, så bump `"version"` der før du bygger.

### Release på GitHub

GitHub er kanonisk for alt offentlig: releases, issues og kildekoden. Speilet er privat og får bare `main` og taggene. Derfor lenker README med absolutt GitHub-URL til releases og issues, mens lenker til filer i repoet er relative (`docs/...`, `LICENSE`, `flex/README.md`). Relative fillenker virker på begge plattformene. En relativ lenke til releases-siden virker derimot bare på GitHub, fordi andre git-tjenester bygger sti-URL-ene annerledes.

```bash
./stats/scripts/release.sh notater.md          # tørrkjøring
./stats/scripts/release.sh --yes notater.md    # tagg, push og publiser
```

Scriptet krever ren arbeidskopi på `main`, leser versjonen fra `stats/manifest.json` og stopper hvis taggen `v<versjon>` finnes alt. Det kjører `package.sh`, lager en annotert tagg, pusher `main` og taggen til alle remotene som er satt opp, og lager GitHub-releasen med zip-en som vedlegg og notatfilen som tekst. `--title` setter tittelen på releasen (standard `v<versjon>`). Uten `--yes` kjører bare sjekkene og pakkingen, og scriptet viser kommandoene det ville kjørt.

## 2. Velg distribusjonsmåte

Mozilla gir to valg når du sender inn en versjon på [addons.mozilla.org/developers](https://addons.mozilla.org/developers/):

- **På dette nettstedet (listed)**: offentlig oppført på addons.mozilla.org, søkbar for alle. Strengere, ofte manuell review.
- **På egenhånd (self / unlisted)**: Mozilla signerer, du laster ned `.xpi` fra utviklerhuben og distribuerer selv. Som regel automatisk review.

**Anbefaling nå: På egenhånd.** Det gir en signert `.xpi` du kan installere permanent (slutt på temp-add-on som forsvinner ved omstart), uten den offentlige bagasjen.

### Før offentlig oppføring (listed) er greit

Ikke publiser listed før dette er ryddet:

- **Ikon.** Stats har eget ikon uten noe fra Dele-logoen, med SVG-kilder i `stats/icons/` og rendring via `stats/scripts/render-icons.sh`. Til listingen brukes `stats/icons/listing/icon-256.png`. Flex bruker fortsatt Dele-symbolet og trenger eget ikon før en listed utgivelse.

## 3. Signer og last ned (self-distribution)

1. Logg inn på [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
2. Send inn ny versjon → velg **På egenhånd**.
3. Last opp zip-en fra steg 1.
4. Vent på signering (unlisted er som regel automatisk).
5. Last ned den signerte `.xpi`-en fra utviklerhuben.

## 4. Installer

- **Permanent:** `about:addons` → tannhjul → «Installer tillegg fra fil» → velg den signerte `.xpi`-en. Overlever omstart.
- **Midlertidig (dev):** `about:debugging` → «Load Temporary Add-on» → velg `manifest.json`. Forsvinner ved omstart, men trenger ikke signering.

## 5. Auto-oppdatering (valgfritt)

For personlig bruk holder det å reinstallere den nye `.xpi`-en når du bygger på nytt. Vil du ha automatiske oppdateringer for self-distribution, må manifestet ha en `update_url` som peker på en `updates.json` du hoster selv. Se [Firefox Extension Workshop – distribusjon og signering](https://extensionworkshop.com/documentation/publish/) for oppsettet.

## Merk

- Ingen build-step og ingen npm i dette repoet, så vi bruker `package.sh` + manuell opplasting, ikke `web-ext` (som krever npm).
- Begge utvidelsene snakker med et uoffisielt, reverse-engineert dele.no-API. Hold lav profil: self-distribution er klokere enn en offentlig oppføring.
