# Utvikling

## Bygg og test

### 1. Bygg

Fra repo-roten:

```bash
./stats/scripts/package.sh
```

Zip-ene havner i `stats/dist/`: `min-bildeling-v<versjon>.zip` for Firefox og `min-bildeling-chrome-v<versjon>.zip` for Chrome, og Chrome-utgaven ligger også utpakket i `stats/dist/chrome/`. Før de lages, kjører kontrast- og stilsjekken, og etterpå sjekker byggevakten begge zip-ene for persondata, utviklingsrot og endrede vendor-filer. Ved funn blir det ingen zip.

Til slutt kjører `valider.sh`. Firefox-zip-en går gjennom Mozillas `addons-linter` (10.15.0, via `npx`), som er de samme reglene AMO bruker: feil stopper, og advarsler stopper med mindre de står med begrunnelse i lista `TILLATT` i scriptet. Chrome har ingen offentlig validator, så `sjekk-chrome.mjs` laster `stats/dist/chrome/` i hodeløs Chrome med en kasteprofil uten nett og feiler på manifestfeil, installasjonsadvarsler og feil fra service workeren. Krever Google Chrome og nett første gang `npx` henter linteren. `--uten-validering` hopper over steget, og `./stats/scripts/valider.sh` kjører det alene.

### 2. Last inn i Firefox

```text
about:debugging#/runtime/this-firefox
```

Trykk «Last inn midlertidig tillegg…» og velg zip-en. Tillegget forsvinner når Firefox startes på nytt.

### 2b. Last inn i Chrome

Åpne `chrome://extensions`, slå på Utviklermodus, trykk «Last inn upakket» og velg `stats/dist/chrome/`. Ikke velg `stats/` direkte: Chrome nekter å laste manifestet fordi bakgrunnen står som Firefox-nøkkelen `background.scripts`, uten `service_worker`. Etter ny bygging trykker du på pilen for å laste inn på nytt. Feil fra service workeren står under «Feil» på kortet, og «service worker»-lenken åpner konsollen.

Chrome 137 og nyere ignorerer `--load-extension`. Automatisert lasting går via CDP: start Chrome med `--remote-debugging-pipe --enable-unsafe-extension-debugging` og kall `Extensions.loadUnpacked`.

### 3. Rask sjekk

- Popupen og dashbordet åpner, og synken går ferdig mens du er innlogget på app.dele.no.
- Tallene ser ut som før.
- «Slik beregnes det» åpner med kilder.
- Lys og mørk modus ser riktige ut.
- Ingen feil i konsollen (Inspiser på tillegget i `about:debugging`).
- Uten app.dele.no-fane sier popupen hva som mangler.

### 4. Tester

```bash
cd stats && node --test
cd flex && node --test
```

Node 24, ingen avhengigheter. Testene dekker de rene funksjonene i `lib/` og at [api-bruk.md](api-bruk.md) stemmer med konstantene.

### 5. Skjermbilder

```bash
./stats/scripts/skjermbilder.sh
```

Bildene havner i `skjermbilder/`, og butikksettet på 1280x800 i `skjermbilder/butikk/`. Krever Firefox, Node, python3 og ImageMagick. `--butikk` lager bare butikksettet fra bildene som alt ligger der.

### 6. Send til AMO

`./stats/scripts/amo-upload.sh` tørrkjører, og med `--yes` sendes zip-en inn til signering. Hele løpet står i [publisering.md](publisering.md).

## Mer

- **Uten zip:** velg `stats/manifest.json` i stedet for zip-en. Da trenger endringer i HTML, JS og CSS bare at siden lastes på nytt. `background.js` og `manifest.json` krever «Last inn på nytt» på tillegget.
- **Demomodus:** `?demo=1` på dashbordet, popupen eller årsoppsummeringen viser rundt 180 oppdiktede turer og skriver ingenting til storage. Virker over vanlig http: `cd stats && python3 -m http.server 8765`, så `http://127.0.0.1:8765/dashboard/dashboard.html?demo=1`.
- **Utviklerpanelet:** `?dev=1` på dashbordet i tillegget viser storage, de siste synkene og eksport, import og «Nullstill alt». Av i demomodus.
- **Firefox via MCP:** `firefox-devtools`-MCP-en kjører en egen Firefox med profilen `~/.firefox-devtools-mcp-profile`. Installer på nytt med `install_extension` bare når `background.js` eller `manifest.json` er endret, ellers last fanen på nytt.
- **MCP-fallgruver:** Hoper serverne seg opp (`pgrep -fl firefox-devtools-mcp`), kjør `pkill -f firefox-devtools-mcp`. MCP-en kan ikke åpne `moz-extension://` eller `about:debugging`, så bruk demomodus over http. WebDriver svarer `false` på `confirm()` uten å vise noe, derfor `<dialog>`.
- **Chrome via MCP:** `chrome-devtools-mcp` 1.12.0 er satt opp lokalt med `--categoryExtensions=true`, som gir `install_extension`, `reload_extension` og `list_extensions`. Installer `stats/dist/chrome/`, ikke `stats/`.
- **Ny UUID:** `install_extension` kan gi tillegget ny intern UUID. Den står i `webextensions.uuids` i `~/.firefox-devtools-mcp-profile/prefs.js`.
- **Ikoner:** `./stats/scripts/render-icons.sh` rendrer PNG-ene fra SVG-kildene (krever `rsvg-convert`). `render-promo.sh` rendrer promobildet til Chrome Web Store.
- **Byggevakten alene:** `./stats/scripts/sjekk-pakke.test.sh` viser at vakten slår til.

Filstruktur, storage og synk står i [arkitektur.md](arkitektur.md), regler for agenter i [AGENTS.md](../AGENTS.md).
