# Publisering

Repoet har to Firefox-utvidelser med hver sin gecko-id, så de signeres og distribueres hver for seg som egne `.xpi`-filer.

| Mappe    | Navn                    | Gecko-id                        |
| -------- | ----------------------- | ------------------------------- |
| `stats/` | Bildeleringen Stats     | `bildeleringen-stats@extension` |
| `flex/`  | Bildeleringen Fleksibel | `bildeleringen-flex@extension`  |

## 1. Bygg zip-en

Øk `"version"` i `manifest.json` først, så kjør fra repo-roten:

```bash
./stats/scripts/package.sh     # gir stats/dist/bildeleringen-stats-v<versjon>.zip
```

Flex har ikke eget `package.sh` ennå. Det kommer når den skal ut.

### Release på GitHub

GitHub er kanonisk for releases og issues, så README lenker dit med absolutt URL. Fillenker er relative og virker også i det private speilet.

```bash
./stats/scripts/release.sh notater.md          # tørrkjøring
./stats/scripts/release.sh --yes notater.md    # tagg, push og publiser
```

Scriptet krever ren arbeidskopi på `main` og stopper hvis taggen `v<versjon>` finnes alt. Det kjører `package.sh`, lager en annotert tagg, pusher `main` og taggen til alle remotene og lager GitHub-releasen med zip-en som vedlegg og notatfilen som tekst. `--title` setter tittelen (standard `v<versjon>`). Uten `--yes` kjøres bare sjekkene og pakkingen, og scriptet viser kommandoene det ville kjørt.

## 2. Velg distribusjon

På [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) velger du mellom to måter:

- **På dette nettstedet (listed)**: oppført og søkbar på addons.mozilla.org, med strengere og ofte manuell review.
- **På egenhånd (unlisted)**: Mozilla signerer, og du laster ned `.xpi` og distribuerer selv. Reviewen er som regel automatisk.

Velg «På egenhånd» inntil videre. Du får en signert `.xpi` som kan installeres permanent, og utvidelsene bruker et uoffisielt dele.no-API som tjener på lav profil. Flex trenger eget ikon før en listed utgivelse. Stats-ikonet er klart (`stats/icons/listing/icon-256.png`, rendret med `stats/scripts/render-icons.sh`).

## 3. Signer

1. Logg inn på [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
2. Send inn ny versjon og velg «På egenhånd».
3. Last opp zip-en fra steg 1.
4. Vent på signeringen.
5. Last ned den signerte `.xpi`-en.

## 4. Installer

- **Permanent:** `about:addons`, tannhjulet, «Installer tillegg fra fil», velg `.xpi`-en.
- **Midlertidig:** `about:debugging`, «Last inn midlertidig tillegg», velg `manifest.json`. Forsvinner ved omstart, men trenger ikke signering.

## 5. Automatisk oppdatering

For eget bruk holder det å installere den nye `.xpi`-en. Automatiske oppdateringer krever en `update_url` i manifestet som peker på en `updates.json` du hoster selv, se [Firefox Extension Workshop](https://extensionworkshop.com/documentation/publish/).

Repoet bruker `package.sh` og manuell opplasting framfor `web-ext`, siden `web-ext` krever npm.
