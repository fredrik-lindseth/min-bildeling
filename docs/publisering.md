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

## 2. Velg distribusjonsmåte

Mozilla gir to valg når du sender inn en versjon på [addons.mozilla.org/developers](https://addons.mozilla.org/developers/):

- **På dette nettstedet (listed)**: offentlig oppført på addons.mozilla.org, søkbar for alle. Strengere, ofte manuell review.
- **På egenhånd (self / unlisted)**: Mozilla signerer, du laster ned `.xpi` fra utviklerhuben og distribuerer selv. Som regel automatisk review.

**Anbefaling nå: På egenhånd.** Det gir en signert `.xpi` du kan installere permanent (slutt på temp-add-on som forsvinner ved omstart), uten den offentlige bagasjen.

### Før offentlig oppføring (listed) er greit

Ikke publiser listed før dette er ryddet:

- **Ikon.** Ikonene i `icons/` er avledet av Dele sin offisielle logo. Greit for privat sideloading, men listed krever eget symbol. Den lilla `#51289D` er fri.

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
