# Fleksibel booking: implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ny Firefox-utvidelse som finner fleksible booking-alternativer oppå dele.no sitt `/api/search`, og deep-linker inn i dele.no for å fullføre.

**Architecture:** Monorepo: eksisterende stats-utvidelse flyttes til `stats/`, ny utvidelse i `flex/`. En ren, node-testet fleksibilitets-motor (`flex/lib/flex.js`) regner ut passende vinduer, søsken-biler og (fase 1.5) delte turer fra søkesvaret. En content script + background henter auth og proxyer søk; en fullside-UI viser resultatene.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS. Ingen bundler, ingen npm-avhengigheter. `node --test` (Node 24) for enhetstester. Firefox MV3.

## Global Constraints

- Ingen build-step. Ingen bundler eller npm-avhengigheter. Vendor-libs i `vendor/`.
- ES modules overalt unntatt content scripts (de støtter ikke modules).
- Alle farger via CSS custom properties i `:root`. Ingen hardkodede hex/rgb utenfor `:root`.
- Mørk modus påkrevd (`prefers-color-scheme`). Nye CSS-variabler trenger dark mode override.
- Norsk UI-tekst (labels, feilmeldinger, status). `console.log` kan være engelsk.
- Stats-lignende funksjoner er rene: `flex/lib/flex.js` har ingen sideeffekter, kaller ingen browser-API eller storage.
- Cross-browser: `typeof browser !== "undefined" ? browser : chrome`. `flex/lib/browser-polyfill.js` eksporterer `browserAPI` og `storage`.
- Estimat-tall prefikses "ca." / "~". (Ikke aktuelt i v1, men gjelder om vi legger til estimater.)
- API bruker naiv lokal ISO uten tidssone (`2026-07-08T09:00:00`). All tidsformattering skal matche dette (ingen `Z`).
- Commit kun når brukeren ber om det. Ikke commit uoppfordret. Repoet står på `main`, så spør om branch før commit.

---

## Filstruktur

Etter restruktureringen:

```
bildeleringen/
  stats/                         ← eksisterende utvidelse, flyttet uendret
    manifest.json, background.js, content.js, popup/, dashboard/,
    summary/, lib/, vendor/, icons/, debug.html, debug.js, scripts/
  flex/                          ← ny utvidelse
    manifest.json                  MV3-manifest
    content.js                     leser token fra persist:data (klassisk script)
    background.js                  auth + søk-proxy (module)
    popup/popup.html               inngang: knapp som åpner finder
    popup/popup.js
    finder.html                    fullside-UI
    finder.js                      UI-kontroller (module)
    finder.css
    lib/browser-polyfill.js        browserAPI + storage (kopi fra stats)
    lib/format.js                  lokal ISO parse/format
    lib/search-api.js              searchAvailability, fetchLocations
    lib/flex.js                    fleksibilitets-motoren (rene funksjoner)
    lib/storage.js                 lagrede steder + bil-favoritter
    icons/                         gjenbruk stats-ikoner
    package.json                   { "type": "module" }, kun for node-test, ingen deps
    test/format.test.js
    test/flex.test.js
    test/storage.test.js
    test/fixtures/search-sample.json
  docs/                          ← delte dokumenter
```

`flex/package.json` inneholder kun `{"type":"module"}` slik at `node --test` tolker `.js`-filene som ES modules. Det er ren konfigurasjon, ikke en avhengighet, og ignoreres av nettleseren.

---

### Task 0: Monorepo-restrukturering: flytt stats til `stats/`

**Files:**
- Move: alle sporede toppnivå-utvidelsesfiler → `stats/`
- Modify: `stats/scripts/package.sh`

**Interfaces:**
- Produces: en fungerende stats-utvidelse under `stats/`, lastbar via `stats/manifest.json`.

- [ ] **Step 1: Flytt utvidelsesfilene med git**

```bash
cd ~/bildeleringen-stats
mkdir stats
git mv manifest.json background.js content.js debug.html debug.js \
       popup dashboard summary lib vendor icons scripts stats/
```

Repo-nivå-filer blir værende på rot: `CLAUDE.md`, `AGENTS.md`, `LICENSE`, `README.md`, `docs/`, `.gitignore`.

- [ ] **Step 2: Oppdater `stats/scripts/package.sh` til å kjøre fra stats-mappen**

Erstatt toppen av `stats/scripts/package.sh` (linje 5-9) slik at den finner stats-rota uansett hvor den kalles fra, og hent delt LICENSE/README fra repo-rota:

```bash
set -e

# Kjør alltid fra stats/-rota (skriptet ligger i stats/scripts/)
cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
OUTDIR="dist"
ZIPNAME="bildeleringen-stats-v${VERSION}.zip"
```

Og bytt LICENSE/README-linjene i `zip`-kallet (var linje 27-28) til å peke på repo-rota via en midlertidig staging-kopi. Erstatt hele `zip -r ... README.md \` blokka med:

```bash
cp ../LICENSE ../README.md .
zip -r "$OUTDIR/$ZIPNAME" \
  manifest.json \
  background.js \
  content.js \
  popup/ \
  dashboard/ \
  summary/ \
  lib/ \
  vendor/ \
  icons/ \
  LICENSE \
  README.md \
  -x "*.DS_Store" \
  -x "*debug*"
rm -f LICENSE README.md
```

- [ ] **Step 3: Verifiser at pakking fortsatt virker**

Run: `cd ~/bildeleringen-stats && ./stats/scripts/package.sh`
Expected: "Created: dist/bildeleringen-stats-v1.1.0.zip" uten feil.

- [ ] **Step 4: Verifiser at utvidelsen laster i Firefox**

Manuelt: `about:debugging` → This Firefox → Load Temporary Add-on → velg `stats/manifest.json`. Utvidelsen skal laste uten manifest-feil, og popup skal åpne.

Bekreft at ingen interne stier brøt: alle stats-stier i manifest (`icons/…`, `popup/popup.html`) er relative og løser innenfor `stats/`.

- [ ] **Step 5: Commit** (spør brukeren først, jf. Global Constraints)

```bash
git add -A
git commit -m "refactor: flytt stats-utvidelsen til stats/ (monorepo)"
```

---

### Task 1: Flex-scaffold: manifest, auth, tomt finder-skall

**Files:**
- Create: `flex/manifest.json`, `flex/content.js`, `flex/background.js`, `flex/lib/browser-polyfill.js`, `flex/popup/popup.html`, `flex/popup/popup.js`, `flex/finder.html`, `flex/finder.js`, `flex/finder.css`
- Create: `flex/icons/` (kopi av `stats/icons/`)

**Interfaces:**
- Produces: `browserAPI`, `storage` fra `flex/lib/browser-polyfill.js`. Background svarer på `{type:"GET_AUTH_STATUS"}` → `{hasAuth: boolean}` og `{type:"SEARCH", point, start, end}` → søkesvar (implementeres i Task 7; her stubbet).

- [ ] **Step 1: Kopier browser-polyfill og ikoner fra stats**

```bash
cd ~/bildeleringen-stats
mkdir -p flex/lib flex/popup flex/icons flex/test/fixtures
cp stats/lib/browser-polyfill.js flex/lib/browser-polyfill.js
cp stats/icons/*.png flex/icons/
```

- [ ] **Step 2: Skriv `flex/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Bildeleringen Fleksibel",
  "version": "0.1.0",
  "description": "Fleksibelt booking-søk for dele.no: finn når en bil faktisk er ledig",
  "permissions": ["storage", "scripting"],
  "host_permissions": ["*://app.dele.no/*"],
  "background": {
    "scripts": ["background.js"],
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://app.dele.no/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "bildeleringen-flex@extension",
      "strict_min_version": "112.0"
    }
  }
}
```

- [ ] **Step 3: Skriv `flex/content.js`** (klassisk script, ikke module, leser auth, samme teknikk som stats)

```js
// Leser dele.no-token fra localStorage("persist:data") og svarer background.
const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH") {
    try {
      const raw = localStorage.getItem("persist:data");
      if (!raw) return sendResponse(null);
      const parsed = JSON.parse(raw);
      const token = JSON.parse(parsed.authentication);
      sendResponse({ token });
    } catch (e) {
      console.log("[content] auth read failed:", e.message);
      sendResponse(null);
    }
    return true;
  }
  return false;
});
```

- [ ] **Step 4: Skriv `flex/background.js`** (auth + søk-proxy; SEARCH stubbes til Task 7)

```js
import { browserAPI } from "./lib/browser-polyfill.js";

let currentAuth = null;

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATUS") {
    getAuth().then((auth) => sendResponse({ hasAuth: auth !== null }));
    return true;
  }
  if (message.type === "SEARCH") {
    // Fylles ut i Task 7.
    sendResponse({ error: "NOT_IMPLEMENTED" });
    return true;
  }
  return false;
});

export async function getAuth() {
  if (currentAuth) return currentAuth;
  const tabs = await browserAPI.tabs.query({ url: "*://app.dele.no/*" });
  if (tabs.length === 0) return null;
  for (const tab of tabs) {
    try {
      const res = await browserAPI.tabs.sendMessage(tab.id, { type: "GET_AUTH" });
      if (res && res.token) {
        currentAuth = res;
        return res;
      }
    } catch (e) {
      // content script ikke lastet, prøv injection
    }
    try {
      const results = await browserAPI.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const raw = localStorage.getItem("persist:data");
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return { token: JSON.parse(parsed.authentication) };
          } catch (e) {
            return null;
          }
        },
      });
      const result = results?.[0]?.result;
      if (result && result.token) {
        currentAuth = result;
        return result;
      }
    } catch (e) {
      console.warn("[bg] injection failed", tab.id, e);
    }
  }
  return null;
}
```

- [ ] **Step 5: Skriv `flex/popup/popup.html`** (inngang)

```html
<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <style>
    body { width: 220px; font: 14px system-ui; padding: 12px; }
    button { width: 100%; padding: 10px; cursor: pointer; }
    #status { margin-top: 8px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <button id="open">Åpne fleksibelt søk</button>
  <div id="status">Sjekker innlogging…</div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 6: Skriv `flex/popup/popup.js`**

```js
const api = typeof browser !== "undefined" ? browser : chrome;

document.getElementById("open").addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("finder.html") });
  window.close();
});

api.runtime.sendMessage({ type: "GET_AUTH_STATUS" }).then((res) => {
  const status = document.getElementById("status");
  status.textContent = res && res.hasAuth
    ? "Innlogget på dele.no"
    : "Åpne app.dele.no og logg inn først";
});
```

- [ ] **Step 7: Skriv midlertidig `flex/finder.html` + tom `finder.js` + `finder.css`**

`flex/finder.html`:

```html
<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <title>Bildeleringen Fleksibel</title>
  <link rel="stylesheet" href="finder.css" />
</head>
<body>
  <h1>Fleksibelt søk</h1>
  <p id="boot">Laster…</p>
  <script type="module" src="finder.js"></script>
</body>
</html>
```

`flex/finder.js`:

```js
document.getElementById("boot").textContent = "Klar. (UI fylles ut i Task 9.)";
```

`flex/finder.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #1a1a1a; --fg: #f0f0f0; }
}
body { background: var(--bg); color: var(--fg); font: 15px system-ui; margin: 24px; }
```

- [ ] **Step 8: Verifiser at flex-utvidelsen laster**

Manuelt: `about:debugging` → Load Temporary Add-on → `flex/manifest.json`. Popup åpner, viser innloggingsstatus (åpne app.dele.no-fane for "Innlogget"), og "Åpne fleksibelt søk" åpner finder-fanen.

- [ ] **Step 9: Commit** (spør først)

```bash
git add flex/
git commit -m "feat(flex): scaffold ny utvidelse med auth og tomt finder-skall"
```

---

### Task 2: Testoppsett + `format.js` (lokal ISO)

**Files:**
- Create: `flex/package.json`, `flex/lib/format.js`, `flex/test/format.test.js`

**Interfaces:**
- Produces: `toLocalISO(date: Date): string`, `parseLocalISO(s: string): Date` fra `flex/lib/format.js`.

- [ ] **Step 1: Skriv `flex/package.json`**

```json
{ "type": "module" }
```

- [ ] **Step 2: Skriv den feilende testen `flex/test/format.test.js`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalISO, parseLocalISO } from "../lib/format.js";

test("round-trip bevarer veggklokke uten tidssoneskift", () => {
  const s = "2026-07-08T09:30:00";
  assert.equal(toLocalISO(parseLocalISO(s)), s);
});

test("parseLocalISO tolker som lokal tid", () => {
  const d = parseLocalISO("2026-07-08T09:00:00");
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMonth(), 6); // juli
  assert.equal(d.getDate(), 8);
});

test("parseLocalISO godtar manglende sekunder", () => {
  assert.equal(toLocalISO(parseLocalISO("2026-07-08T09:00")), "2026-07-08T09:00:00");
});

test("parseLocalISO kaster på ugyldig streng", () => {
  assert.throws(() => parseLocalISO("ikke en dato"));
});
```

- [ ] **Step 3: Kjør testen og bekreft at den feiler**

Run: `cd ~/bildeleringen-stats/flex && node --test`
Expected: FAIL, "Cannot find module '../lib/format.js'".

- [ ] **Step 4: Skriv `flex/lib/format.js`**

```js
// Naiv lokal ISO uten tidssone, matcher dele.no ("2026-07-08T09:00:00").
// Vi jobber i lokal veggklokke (Europe/Oslo der brukeren er).

function pad(n) {
  return String(n).padStart(2, "0");
}

export function toLocalISO(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function parseLocalISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`Ugyldig lokal ISO: ${s}`);
  const [, y, mo, d, h, mi, se] = m;
  return new Date(
    Number(y), Number(mo) - 1, Number(d),
    Number(h), Number(mi), Number(se || 0)
  );
}
```

- [ ] **Step 5: Kjør testen og bekreft at den passerer**

Run: `cd ~/bildeleringen-stats/flex && node --test`
Expected: PASS, 4 tester.

- [ ] **Step 6: Commit** (spør først)

```bash
git add flex/package.json flex/lib/format.js flex/test/format.test.js
git commit -m "feat(flex): lokal ISO parse/format med tester"
```

---

### Task 3: `flex.js`: `freeBlocks`

**Files:**
- Create: `flex/lib/flex.js`
- Test: `flex/test/flex.test.js`

**Interfaces:**
- Consumes: `parseLocalISO` fra `format.js`.
- Produces: `freeBlocks(availability, windowStart: Date, windowEnd: Date): Array<{start: Date, end: Date}>`: maksimale AVAILABLE-blokker klippet til vinduet, stigende.

- [ ] **Step 1: Skriv den feilende testen (legg til i `flex/test/flex.test.js`)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalISO } from "../lib/format.js";
import { freeBlocks } from "../lib/flex.js";

const seg = (start, end, state) => ({ start, end, state, stateLabel: state });

test("freeBlocks henter kun AVAILABLE og klipper til vinduet", () => {
  const availability = [
    seg("2026-07-07T07:00:00", "2026-07-07T09:00:00", "AVAILABLE"),
    seg("2026-07-07T09:00:00", "2026-07-11T18:00:00", "RESERVED"),
    seg("2026-07-11T18:00:00", "2026-07-12T09:00:00", "AVAILABLE"),
  ];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T08:00:00"),
    parseLocalISO("2026-07-12T00:00:00")
  );
  assert.equal(blocks.length, 2);
  // første blokk klippet til vindusstart 08:00, ikke 07:00
  assert.equal(blocks[0].start.getTime(), parseLocalISO("2026-07-07T08:00:00").getTime());
  assert.equal(blocks[0].end.getTime(), parseLocalISO("2026-07-07T09:00:00").getTime());
  // andre blokk klippet til vindusslutt 00:00, ikke 09:00
  assert.equal(blocks[1].end.getTime(), parseLocalISO("2026-07-12T00:00:00").getTime());
});

test("freeBlocks utelater segmenter uten overlapp med vinduet", () => {
  const availability = [seg("2026-07-01T00:00:00", "2026-07-02T00:00:00", "AVAILABLE")];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T00:00:00"),
    parseLocalISO("2026-07-08T00:00:00")
  );
  assert.equal(blocks.length, 0);
});

test("freeBlocks behandler UNAVAILABLE som ikke-ledig", () => {
  const availability = [seg("2026-07-07T00:00:00", "2026-07-08T00:00:00", "UNAVAILABLE")];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T00:00:00"),
    parseLocalISO("2026-07-08T00:00:00")
  );
  assert.equal(blocks.length, 0);
});
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `cd flex && node --test test/flex.test.js`
Expected: FAIL, "does not provide an export named 'freeBlocks'".

- [ ] **Step 3: Skriv `flex/lib/flex.js`**

```js
import { parseLocalISO } from "./format.js";

const MS_PER_MINUTE = 60 * 1000;

export function blockMinutes(b) {
  return (b.end - b.start) / MS_PER_MINUTE;
}

// Maksimale AVAILABLE-blokker klippet til [windowStart, windowEnd], stigende.
// Antar at availability-segmentene kommer sortert og sammenhengende fra API-et.
export function freeBlocks(availability, windowStart, windowEnd) {
  const blocks = [];
  for (const s of availability) {
    if (s.state !== "AVAILABLE") continue;
    const segStart = parseLocalISO(s.start);
    const segEnd = parseLocalISO(s.end);
    const start = segStart < windowStart ? windowStart : segStart;
    const end = segEnd > windowEnd ? windowEnd : segEnd;
    if (end <= start) continue;
    const last = blocks[blocks.length - 1];
    if (last && start <= last.end) {
      if (end > last.end) last.end = end;
    } else {
      blocks.push({ start, end });
    }
  }
  return blocks;
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `cd flex && node --test test/flex.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (spør først)

```bash
git add flex/lib/flex.js flex/test/flex.test.js
git commit -m "feat(flex): freeBlocks, maksimale ledige blokker i vinduet"
```

---

### Task 4: `flex.js`: `fitCar`

**Files:**
- Modify: `flex/lib/flex.js`
- Test: `flex/test/flex.test.js`

**Interfaces:**
- Consumes: `freeBlocks`, `blockMinutes`.
- Produces: `clippedSegments(availability, windowStart, windowEnd): Array<{start: Date, end: Date, state}>` og `fitCar(car, wish): CarFit`.
  - `car`: objekt fra `searchResult.cars[]` (`carId`, `carNumber`, `model`, `carCategory`, `seats`, `hourlyRate`, `carProperties`, `location: {name, distance, id}`, `availability`).
  - `wish`: `{ earliestStart: Date, latestEnd: Date, durationMinutes: number|null, filters }`.
  - `CarFit`: `{ carId, carNumber, model, category, seats, carProperties, hourlyRate, location, segments, kind: "fits"|"short"|"none", proposed: {start,end}|null, coversWholeWindow: boolean, shiftMinutes: number, bestBlockMinutes: number, shortfallMinutes: number }`. `segments` er alle availability-segmenter (uansett state) klippet til vinduet, grunnlaget for tidslinjen i UI-en.

- [ ] **Step 1: Skriv feilende tester (legg til i `flex/test/flex.test.js`)**

```js
import { fitCar, clippedSegments } from "../lib/flex.js";

const car = (availability, extra = {}) => ({
  carId: "c1", carNumber: "948", model: "Toyota Yaris", carCategory: "Småbil",
  seats: 5, hourlyRate: 41, carProperties: [], location: { name: "Eksempelveien", distance: 166, id: "L" },
  availability, ...extra,
});

const wholeWindowWish = {
  earliestStart: parseLocalISO("2026-07-08T09:00:00"),
  latestEnd: parseLocalISO("2026-07-10T17:00:00"),
  durationMinutes: null,
  filters: {},
};

test("fitCar: fri hele vinduet -> fits + coversWholeWindow", () => {
  const f = fitCar(car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")]), wholeWindowWish);
  assert.equal(f.kind, "fits");
  assert.equal(f.coversWholeWindow, true);
  assert.equal(f.shiftMinutes, 0);
});

test("fitCar: opptatt i midten, hele-vinduet-modus -> short", () => {
  const f = fitCar(car([
    seg("2026-07-08T09:00:00", "2026-07-09T12:00:00", "AVAILABLE"),
    seg("2026-07-09T12:00:00", "2026-07-10T17:00:00", "RESERVED"),
  ]), wholeWindowWish);
  assert.equal(f.kind, "short");
  assert.equal(f.coversWholeWindow, false);
  assert.ok(f.shortfallMinutes > 0);
});

test("fitCar: varighetsmodus finner blokk >= varighet og skyver start", () => {
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-12T09:00:00"),
    durationMinutes: 24 * 60, // 1 døgn
    filters: {},
  };
  const f = fitCar(car([
    seg("2026-07-08T09:00:00", "2026-07-09T00:00:00", "RESERVED"),
    seg("2026-07-09T00:00:00", "2026-07-12T09:00:00", "AVAILABLE"),
  ]), wish);
  assert.equal(f.kind, "fits");
  assert.equal(f.coversWholeWindow, false);
  assert.equal(f.proposed.start.getTime(), parseLocalISO("2026-07-09T00:00:00").getTime());
  assert.equal(f.proposed.end.getTime(), parseLocalISO("2026-07-10T00:00:00").getTime());
  assert.ok(f.shiftMinutes > 0);
});

test("fitCar: ingen ledig tid -> none", () => {
  const f = fitCar(car([seg("2026-07-08T09:00:00", "2026-07-10T17:00:00", "RESERVED")]), wholeWindowWish);
  assert.equal(f.kind, "none");
  assert.equal(f.proposed, null);
});

test("fitCar returnerer segments (alle states) klippet til vinduet", () => {
  const f = fitCar(car([
    seg("2026-07-01T00:00:00", "2026-07-09T00:00:00", "AVAILABLE"),
    seg("2026-07-09T00:00:00", "2026-07-20T00:00:00", "RESERVED"),
  ]), wholeWindowWish);
  assert.equal(f.segments.length, 2);
  assert.equal(f.segments[0].state, "AVAILABLE");
  // klippet til vindusstart 09:00 08.07, ikke 01.07
  assert.equal(f.segments[0].start.getTime(), wholeWindowWish.earliestStart.getTime());
  assert.equal(f.segments[1].state, "RESERVED");
});

test("clippedSegments dropper segmenter uten overlapp", () => {
  const segs = clippedSegments(
    [seg("2026-07-01T00:00:00", "2026-07-02T00:00:00", "RESERVED")],
    parseLocalISO("2026-07-08T00:00:00"),
    parseLocalISO("2026-07-09T00:00:00")
  );
  assert.equal(segs.length, 0);
});
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `cd flex && node --test test/flex.test.js`
Expected: FAIL, "does not provide an export named 'fitCar'".

- [ ] **Step 3: Legg til `fitCar` i `flex/lib/flex.js`**

```js
// Alle availability-segmenter (uansett state) klippet til vinduet, for tidslinjen.
export function clippedSegments(availability, windowStart, windowEnd) {
  const out = [];
  for (const s of availability) {
    const start = parseLocalISO(s.start);
    const end = parseLocalISO(s.end);
    const cs = start < windowStart ? windowStart : start;
    const ce = end > windowEnd ? windowEnd : end;
    if (ce <= cs) continue;
    out.push({ start: cs, end: ce, state: s.state });
  }
  return out;
}

function carBase(car, segments) {
  return {
    carId: car.carId,
    carNumber: car.carNumber,
    model: car.model,
    category: car.carCategory,
    seats: car.seats,
    hourlyRate: car.hourlyRate,
    carProperties: car.carProperties || [],
    location: {
      name: car.location?.name,
      distance: car.location?.distance,
      id: car.location?.id,
    },
    segments,
  };
}

export function fitCar(car, wish) {
  const segments = clippedSegments(car.availability, wish.earliestStart, wish.latestEnd);
  const base = carBase(car, segments);
  const blocks = freeBlocks(car.availability, wish.earliestStart, wish.latestEnd);
  if (blocks.length === 0) {
    return { ...base, kind: "none", proposed: null, coversWholeWindow: false,
             shiftMinutes: 0, bestBlockMinutes: 0, shortfallMinutes: null };
  }
  const longest = blocks.reduce((a, b) => (blockMinutes(b) >= blockMinutes(a) ? b : a));
  const bestBlockMinutes = blockMinutes(longest);
  const coversWindow = (b) => b.start <= wish.earliestStart && b.end >= wish.latestEnd;

  if (wish.durationMinutes == null) {
    // hele-vinduet-modus
    const windowMinutes = (wish.latestEnd - wish.earliestStart) / MS_PER_MINUTE;
    if (blocks.some(coversWindow)) {
      return { ...base, kind: "fits",
               proposed: { start: wish.earliestStart, end: wish.latestEnd },
               coversWholeWindow: true, shiftMinutes: 0,
               bestBlockMinutes: windowMinutes, shortfallMinutes: 0 };
    }
    return { ...base, kind: "short",
             proposed: { start: longest.start, end: longest.end },
             coversWholeWindow: false, shiftMinutes: 0,
             bestBlockMinutes, shortfallMinutes: windowMinutes - bestBlockMinutes };
  }

  // varighets-modus
  const D = wish.durationMinutes;
  const fitting = blocks.filter((b) => blockMinutes(b) >= D);
  if (fitting.length > 0) {
    const earliest = fitting.reduce((a, b) => (b.start < a.start ? b : a));
    const proposed = { start: earliest.start, end: new Date(earliest.start.getTime() + D * MS_PER_MINUTE) };
    return { ...base, kind: "fits", proposed,
             coversWholeWindow: coversWindow(proposed),
             shiftMinutes: (proposed.start - wish.earliestStart) / MS_PER_MINUTE,
             bestBlockMinutes, shortfallMinutes: 0 };
  }
  return { ...base, kind: "short",
           proposed: { start: longest.start, end: longest.end },
           coversWholeWindow: false, shiftMinutes: (longest.start - wish.earliestStart) / MS_PER_MINUTE,
           bestBlockMinutes, shortfallMinutes: D - bestBlockMinutes };
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `cd flex && node --test test/flex.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (spør først)

```bash
git add flex/lib/flex.js flex/test/flex.test.js
git commit -m "feat(flex): fitCar, klassifiser bil mot ønske"
```

---

### Task 5: `flex.js`: `solve` (filtre, buckets, rangering)

**Files:**
- Modify: `flex/lib/flex.js`
- Test: `flex/test/flex.test.js`

**Interfaces:**
- Consumes: `fitCar`.
- Produces: `solve(searchResult, wish): { whole: CarFit[], adjusted: CarFit[], siblings: CarFit[] }`.
  - `wish.filters`: `{ category?, fuel?, seats?, maxDistanceM?, carIds? }`.
  - `wish.target?`: `{ carId?, model?, category? }`: hvis satt og målet ikke passer, fylles `siblings`.

- [ ] **Step 1: Skriv feilende tester**

```js
import { solve } from "../lib/flex.js";

function result(cars) { return { cars }; }

test("solve deler i whole og adjusted", () => {
  const freeAll = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")], { carId: "free" });
  const partial = car([seg("2026-07-08T09:00:00", "2026-07-09T00:00:00", "AVAILABLE"),
                       seg("2026-07-09T00:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "part" });
  const out = solve(result([partial, freeAll]), wholeWindowWish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["free"]);
  assert.deepEqual(out.adjusted.map((f) => f.carId), ["part"]);
});

test("solve filtrerer på kategori og maks distanse", () => {
  const near = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                   { carId: "near", location: { name: "A", distance: 200, id: "A" } });
  const far = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                  { carId: "far", location: { name: "B", distance: 5000, id: "B" } });
  const suv = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                  { carId: "suv", carCategory: "SUV" });
  const wish = { ...wholeWindowWish, filters: { category: "Småbil", maxDistanceM: 1000 } };
  const out = solve(result([near, far, suv]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["near"]);
});

test("solve rangerer whole nærmest først", () => {
  const a = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                { carId: "a", location: { name: "A", distance: 800, id: "A" } });
  const b = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                { carId: "b", location: { name: "B", distance: 150, id: "B" } });
  const out = solve(result([a, b]), wholeWindowWish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["b", "a"]);
});

test("solve fyller siblings når målbilen er opptatt", () => {
  const target = car([seg("2026-07-08T09:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "target" });
  const sibling = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                      { carId: "sib", location: { name: "Nær", distance: 300, id: "N" } });
  const wish = { ...wholeWindowWish, target: { carId: "target" } };
  const out = solve(result([target, sibling]), wish);
  assert.deepEqual(out.siblings.map((f) => f.carId), ["sib"]);
});
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `cd flex && node --test test/flex.test.js`
Expected: FAIL, "does not provide an export named 'solve'".

- [ ] **Step 3: Legg til `solve` + hjelpere i `flex/lib/flex.js`**

```js
function matchesFilters(car, filters = {}) {
  if (filters.category && car.carCategory !== filters.category) return false;
  if (filters.seats && (car.seats || 0) < filters.seats) return false;
  if (filters.fuel) {
    const fuels = (car.carProperties || [])
      .filter((p) => p.carPropertyGroup === "Drivstoff")
      .map((p) => p.carPropertyName);
    if (!fuels.includes(filters.fuel)) return false;
  }
  if (filters.carIds && filters.carIds.length && !filters.carIds.includes(car.carId)) return false;
  return true;
}

function withinDistance(car, filters = {}) {
  if (!filters.maxDistanceM) return true;
  const d = car.location?.distance;
  return d == null ? false : d <= filters.maxDistanceM;
}

function rankFits(list) {
  list.sort((a, b) => {
    if (a.coversWholeWindow !== b.coversWholeWindow) return a.coversWholeWindow ? -1 : 1;
    if (a.shiftMinutes !== b.shiftMinutes) return a.shiftMinutes - b.shiftMinutes;
    if (a.bestBlockMinutes !== b.bestBlockMinutes) return b.bestBlockMinutes - a.bestBlockMinutes;
    return (a.location.distance ?? Infinity) - (b.location.distance ?? Infinity);
  });
}

function siblingSuggestions(fits, wish) {
  const t = wish.target;
  const targetFit = t.carId ? fits.find((f) => f.carId === t.carId) : null;
  if (targetFit && targetFit.kind === "fits" && targetFit.coversWholeWindow) return [];
  const model = t.model || targetFit?.model;
  const category = t.category || targetFit?.category;
  const siblings = fits.filter((f) => {
    if (t.carId && f.carId === t.carId) return false;
    if (f.kind !== "fits") return false;
    return model ? f.model === model : f.category === category;
  });
  rankFits(siblings);
  return siblings;
}

export function solve(searchResult, wish) {
  const cars = (searchResult.cars || [])
    .filter((c) => matchesFilters(c, wish.filters))
    .filter((c) => withinDistance(c, wish.filters));
  const fits = cars.map((c) => fitCar(c, wish));

  const whole = fits.filter((f) => f.kind === "fits" && f.coversWholeWindow);
  const adjusted = fits.filter((f) => (f.kind === "fits" && !f.coversWholeWindow) || f.kind === "short");
  rankFits(whole);
  rankFits(adjusted);

  const siblings = wish.target ? siblingSuggestions(fits, wish) : [];
  return { whole, adjusted, siblings };
}
```

Merk: `siblingSuggestions` kalles med alle `fits` (før distanse-filter fjerner målbilen). Hvis målbilen kan ligge utenfor `maxDistanceM`, la den stå. Den er brukerens eget valg. For v1 antar vi at målbilen er innenfor filteret; edge-case dokumenteres i "Åpne spørsmål".

- [ ] **Step 4: Kjør og bekreft pass**

Run: `cd flex && node --test`
Expected: PASS, alle tester.

- [ ] **Step 5: Commit** (spør først)

```bash
git add flex/lib/flex.js flex/test/flex.test.js
git commit -m "feat(flex): solve, filtre, buckets, rangering, søsken"
```

---

### Task 6: `search-api.js` + background SEARCH-handler + fixture

**Files:**
- Create: `flex/lib/search-api.js`, `flex/test/fixtures/search-sample.json`
- Modify: `flex/background.js`

**Interfaces:**
- Consumes: `toLocalISO`.
- Produces: `searchAvailability(point, start, end, token): Promise<searchResult>`, `fetchLocations(token): Promise<Location[]>`. Background svarer nå `{type:"SEARCH", point, start, end}` → `searchResult` eller `{error}`.

- [ ] **Step 1: Skriv `flex/lib/search-api.js`**

```js
import { toLocalISO } from "./format.js";

const API_BASE = "https://app.dele.no/api";
const REQUEST_DELAY_MS = 50;
const MAX_RETRIES = 3;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, token, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { headers: { authorization: token, accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 429) {
      await delay(Math.pow(2, attempt) * 1000);
      continue;
    }
    if (res.status === 401) throw new Error("AUTH_EXPIRED");
    throw new Error(`API error: ${res.status}`);
  }
  throw new Error("Max retries exceeded");
}

// point: {lng, lat}. start/end: Date. Returnerer søkesvaret.
export async function searchAvailability(point, start, end, token) {
  const location = encodeURIComponent(
    JSON.stringify({ type: "Point", coordinates: [point.lng, point.lat] })
  );
  const url =
    `${API_BASE}/search?start=${toLocalISO(start)}&end=${toLocalISO(end)}&location=${location}`;
  await delay(REQUEST_DELAY_MS);
  return fetchWithRetry(url, token);
}

export async function fetchLocations(token) {
  return fetchWithRetry(`${API_BASE}/locations`, token);
}
```

- [ ] **Step 2: Koble SEARCH i `flex/background.js`**

Legg til import øverst:

```js
import { searchAvailability } from "./lib/search-api.js";
```

Bytt ut SEARCH-stubben fra Task 1 med:

```js
  if (message.type === "SEARCH") {
    handleSearch(message).then(sendResponse);
    return true;
  }
```

Legg til funksjonen:

```js
async function handleSearch({ point, start, end }) {
  const auth = await getAuth();
  if (!auth) return { error: "NOT_LOGGED_IN" };
  try {
    const result = await searchAvailability(point, new Date(start), new Date(end), auth.token);
    return { result };
  } catch (e) {
    if (e.message === "AUTH_EXPIRED") {
      currentAuth = null;
      return { error: "AUTH_EXPIRED" };
    }
    return { error: e.message };
  }
}
```

Merk: `start`/`end` sendes som ISO-streng over runtime-meldinger (Date serialiseres ikke), og re-parses med `new Date(...)` her.

- [ ] **Step 3: Skriv fixture `flex/test/fixtures/search-sample.json`** (håndlaget, dekker alle casene; ingen persondata)

```json
{
  "start": "2026-07-08T09:00:00",
  "end": "2026-07-10T17:00:00",
  "cars": [
    {
      "carId": "free-1", "carNumber": "100", "model": "Toyota Yaris",
      "carCategory": "Småbil", "seats": 5, "hourlyRate": 41,
      "carProperties": [{ "carPropertyName": "Bensin", "carPropertyGroup": "Drivstoff" }],
      "location": { "id": "eks", "name": "Eksempelveien", "distance": 166 },
      "availability": [{ "start": "2026-07-01T00:00:00", "end": "2026-07-20T00:00:00", "state": "AVAILABLE", "stateLabel": "Ledig" }]
    },
    {
      "carId": "part-1", "carNumber": "200", "model": "Toyota Corolla",
      "carCategory": "Kombi", "seats": 5, "hourlyRate": 46,
      "carProperties": [{ "carPropertyName": "Elektrisitet", "carPropertyGroup": "Drivstoff" }],
      "location": { "id": "test", "name": "Testgata", "distance": 844 },
      "availability": [
        { "start": "2026-07-08T09:00:00", "end": "2026-07-09T12:00:00", "state": "AVAILABLE", "stateLabel": "Ledig" },
        { "start": "2026-07-09T12:00:00", "end": "2026-07-10T17:00:00", "state": "RESERVED", "stateLabel": "Reservert" }
      ]
    },
    {
      "carId": "sib-1", "carNumber": "101", "model": "Toyota Yaris",
      "carCategory": "Småbil", "seats": 5, "hourlyRate": 41,
      "carProperties": [{ "carPropertyName": "Bensin", "carPropertyGroup": "Drivstoff" }],
      "location": { "id": "prove", "name": "Prøvegata", "distance": 553 },
      "availability": [{ "start": "2026-07-01T00:00:00", "end": "2026-07-20T00:00:00", "state": "AVAILABLE", "stateLabel": "Ledig" }]
    },
    {
      "carId": "far-1", "carNumber": "999", "model": "Toyota Proace",
      "carCategory": "Varebil", "seats": 3, "hourlyRate": 60,
      "carProperties": [{ "carPropertyName": "Diesel", "carPropertyGroup": "Drivstoff" }],
      "location": { "id": "trd", "name": "Trondheim", "distance": 430925 },
      "availability": [{ "start": "2026-07-01T00:00:00", "end": "2026-07-20T00:00:00", "state": "AVAILABLE", "stateLabel": "Ledig" }]
    }
  ]
}
```

- [ ] **Step 4: Legg til en integrasjonstest som kjører `solve` på fixturen**

Legg til i `flex/test/flex.test.js`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/search-sample.json", import.meta.url)))
);

test("solve på realistisk fixture: free-1 er whole, part-1 er adjusted, far filtreres bort", () => {
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null,
    filters: { maxDistanceM: 2000 },
  };
  const out = solve(sample, wish);
  assert.ok(out.whole.some((f) => f.carId === "free-1"));
  assert.ok(out.adjusted.some((f) => f.carId === "part-1"));
  assert.ok(!out.whole.some((f) => f.carId === "far-1"));
  assert.ok(!out.adjusted.some((f) => f.carId === "far-1"));
});
```

- [ ] **Step 5: Kjør alle tester**

Run: `cd flex && node --test`
Expected: PASS.

- [ ] **Step 6: Verifiser søk ende-til-ende i nettleseren**

Last flex på nytt i `about:debugging`, åpne finder-fanen, og i konsollen:

```js
browser.runtime.sendMessage({ type: "SEARCH",
  point: { lng: 5.3331, lat: 60.3903 },
  start: "2026-07-08T09:00:00", end: "2026-07-13T20:00:00" }).then(console.log);
```

Expected: `{ result: { cars: [...], ... } }` med ekte biler (krever åpen, innlogget app.dele.no-fane).

- [ ] **Step 7: Commit** (spør først)

```bash
git add flex/lib/search-api.js flex/background.js flex/test/
git commit -m "feat(flex): søke-API-klient, SEARCH-proxy og fixture"
```

---

### Task 7: `storage.js`: lagrede steder + favoritter

**Files:**
- Create: `flex/lib/storage.js`, `flex/test/storage.test.js`

**Interfaces:**
- Produces: `DEFAULT_PLACES` (inkl. Eksempelveien), `getPlaces()`, `savePlace(place)`, `getFavoriteCarIds()`, `saveFavoriteCarIds(ids)`. `place`: `{ id, name, point: {lng, lat} }`.
- Merk: `getPlaces`/`savePlace` kaller `storage` (browser-API) og testes bare for ren logikk (`mergePlaces`); resten røyktestes i nettleser.

- [ ] **Step 1: Skriv feilende test `flex/test/storage.test.js`** (kun ren fletting)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePlaces, DEFAULT_PLACES } from "../lib/storage.js";

test("DEFAULT_PLACES inneholder Eksempelveien (hjem)", () => {
  assert.ok(DEFAULT_PLACES.some((p) => /eksempelveien/i.test(p.name)));
});

test("mergePlaces overstyrer default med lagret på samme id", () => {
  const saved = [{ id: "home", name: "Hjemme", point: { lng: 1, lat: 2 } }];
  const merged = mergePlaces([{ id: "home", name: "Standard", point: { lng: 0, lat: 0 } }], saved);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Hjemme");
});

test("mergePlaces beholder default som ikke er overstyrt", () => {
  const merged = mergePlaces([{ id: "a", name: "A", point: {} }], [{ id: "b", name: "B", point: {} }]);
  assert.deepEqual(merged.map((p) => p.id).sort(), ["a", "b"]);
});
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `cd flex && node --test test/storage.test.js`
Expected: FAIL, modulen finnes ikke.

- [ ] **Step 3: Skriv `flex/lib/storage.js`**

```js
import { storage } from "./browser-polyfill.js";

// Eksempelveien (hjem), midtpunkt av gatens LineString fra /api/locations.
export const DEFAULT_PLACES = [
  { id: "home", name: "Eksempelveien (hjem)", point: { lng: 5.3331, lat: 60.3903 } },
];

const PLACES_KEY = "places";
const FAV_KEY = "favoriteCarIds";

// Ren funksjon: lagrede steder overstyrer default på samme id, resten beholdes.
export function mergePlaces(defaults, saved) {
  const byId = new Map(defaults.map((p) => [p.id, p]));
  for (const p of saved) byId.set(p.id, p);
  return [...byId.values()];
}

export async function getPlaces() {
  const { [PLACES_KEY]: saved } = await storage.get(PLACES_KEY);
  return mergePlaces(DEFAULT_PLACES, saved || []);
}

export async function savePlace(place) {
  const { [PLACES_KEY]: saved } = await storage.get(PLACES_KEY);
  const next = mergePlaces(saved || [], [place]);
  await storage.set({ [PLACES_KEY]: next });
  return next;
}

export async function getFavoriteCarIds() {
  const { [FAV_KEY]: ids } = await storage.get(FAV_KEY);
  return ids || [];
}

export async function saveFavoriteCarIds(ids) {
  await storage.set({ [FAV_KEY]: ids });
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `cd flex && node --test test/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (spør først)

```bash
git add flex/lib/storage.js flex/test/storage.test.js
git commit -m "feat(flex): lagrede steder og favoritter"
```

---

### Task 8: Finder-UI: ønske-form, søk, resultater, tidslinje, handoff

**Files:**
- Modify: `flex/finder.html`, `flex/finder.js`, `flex/finder.css`

**Interfaces:**
- Consumes: `solve` fra `flex.js`, `parseLocalISO`/`toLocalISO` fra `format.js`, `getPlaces` fra `storage.js`, background `SEARCH`.
- Produces: fungerende v1-finner (nivå 1–3).

- [ ] **Step 1: Skriv `flex/finder.html`**

```html
<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <title>Bildeleringen Fleksibel</title>
  <link rel="stylesheet" href="finder.css" />
</head>
<body>
  <header><h1>Fleksibelt søk</h1></header>
  <main class="layout">
    <form id="wish" class="wish">
      <label>Posisjon
        <select id="place"></select>
      </label>
      <label>Tidligst start
        <input type="datetime-local" id="earliest" required />
      </label>
      <label>Senest slutt
        <input type="datetime-local" id="latest" required />
      </label>
      <fieldset>
        <legend>Varighet</legend>
        <label><input type="radio" name="mode" value="whole" checked /> Hele vinduet</label>
        <label><input type="radio" name="mode" value="duration" /> <input type="number" id="hours" min="1" value="24" /> timer</label>
      </fieldset>
      <label>Biltype
        <select id="category">
          <option value="">Alle</option>
          <option>Småbil</option><option>Minibil</option><option>Kombi</option>
          <option>Stasjonsvogn</option><option>SUV</option><option>Varebil</option>
        </select>
      </label>
      <label>Drivstoff
        <select id="fuel">
          <option value="">Alle</option>
          <option>Bensin</option><option>Diesel</option><option>Elektrisitet</option>
        </select>
      </label>
      <label>Maks gangavstand (m)
        <input type="number" id="maxdist" min="0" step="100" value="1500" />
      </label>
      <button type="submit">Søk</button>
    </form>
    <section id="results" class="results" aria-live="polite">
      <p class="hint">Fyll inn og trykk Søk.</p>
    </section>
  </main>
  <script type="module" src="finder.js"></script>
</body>
</html>
```

- [ ] **Step 2: Skriv `flex/finder.css`** (alle farger via `:root`, mørk modus)

```css
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #666666;
  --border: #dddddd;
  --panel: #f6f6f7;
  --accent: #51289d;
  --available: #2e9e5b;
  --reserved: #cccccc;
  --marker: #51289d;
  --short: #c98a1a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16131c; --fg: #f0f0f0; --muted: #a0a0a0; --border: #3a3442;
    --panel: #211c2b; --accent: #b79aec; --available: #43c07a;
    --reserved: #4a4a4a; --marker: #b79aec; --short: #e0a84a;
  }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 15px system-ui; margin: 0; }
header { padding: 16px 24px; border-bottom: 1px solid var(--border); }
h1 { margin: 0; font-size: 20px; }
.layout { display: grid; grid-template-columns: 300px 1fr; gap: 24px; padding: 24px; }
@media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
.wish { display: flex; flex-direction: column; gap: 12px; }
.wish label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
.wish input, .wish select { padding: 8px; font-size: 14px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; }
.wish fieldset { border: 1px solid var(--border); border-radius: 6px; }
.wish button { padding: 10px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 15px; }
.results { display: flex; flex-direction: column; gap: 20px; }
.hint { color: var(--muted); }
.bucket h2 { font-size: 15px; margin: 0 0 8px; }
.car { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: var(--panel); }
.car .head { display: flex; justify-content: space-between; gap: 12px; }
.car .meta { color: var(--muted); font-size: 13px; }
.car .sub { font-size: 13px; color: var(--short); margin: 4px 0; }
.timeline { position: relative; height: 14px; background: var(--reserved); border-radius: 4px; margin: 8px 0; overflow: hidden; }
.timeline .seg { position: absolute; top: 0; bottom: 0; }
.timeline .seg.available { background: var(--available); }
.timeline .marker { position: absolute; top: -2px; bottom: -2px; border-left: 2px solid var(--marker); border-right: 2px solid var(--marker); }
.car a.open { display: inline-block; margin-top: 6px; color: var(--accent); font-weight: 600; text-decoration: none; }
```

- [ ] **Step 3: Skriv `flex/finder.js`**

```js
import { solve } from "./lib/flex.js";
import { parseLocalISO, toLocalISO } from "./lib/format.js";
import { getPlaces } from "./lib/storage.js";

const api = typeof browser !== "undefined" ? browser : chrome;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function fmt(date) {
  return date.toLocaleString("nb-NO", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

let places = [];

async function init() {
  places = await getPlaces();
  const sel = document.getElementById("place");
  for (const p of places) sel.append(el("option", { value: p.id, text: p.name }));

  // fornuftige default-tider: i morgen 09:00 -> +2 dager 17:00
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 17, 0, 0);
  document.getElementById("earliest").value = toLocalISO(start).slice(0, 16);
  document.getElementById("latest").value = toLocalISO(end).slice(0, 16);

  document.getElementById("wish").addEventListener("submit", onSearch);
}

function readWish() {
  const place = places.find((p) => p.id === document.getElementById("place").value);
  const earliestStart = parseLocalISO(document.getElementById("earliest").value);
  const latestEnd = parseLocalISO(document.getElementById("latest").value);
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const durationMinutes = mode === "duration"
    ? Number(document.getElementById("hours").value) * 60
    : null;
  const filters = {
    category: document.getElementById("category").value || undefined,
    fuel: document.getElementById("fuel").value || undefined,
    maxDistanceM: Number(document.getElementById("maxdist").value) || undefined,
  };
  return { point: place.point, earliestStart, latestEnd, durationMinutes, filters };
}

async function onSearch(e) {
  e.preventDefault();
  const results = document.getElementById("results");
  results.replaceChildren(el("p", { class: "hint", text: "Søker…" }));
  const wish = readWish();
  const res = await api.runtime.sendMessage({
    type: "SEARCH",
    point: wish.point,
    start: toLocalISO(wish.earliestStart),
    end: toLocalISO(wish.latestEnd),
  });
  if (res.error) {
    results.replaceChildren(el("p", { class: "hint", text: errorText(res.error) }));
    return;
  }
  const out = solve(res.result, wish);
  render(results, out, wish);
}

function errorText(code) {
  if (code === "NOT_LOGGED_IN") return "Åpne app.dele.no i en fane og logg inn først.";
  if (code === "AUTH_EXPIRED") return "Innloggingen utløp. Last app.dele.no på nytt.";
  return `Noe gikk galt: ${code}`;
}

function render(container, out, wish) {
  container.replaceChildren();
  bucket(container, "Ledig hele ditt vindu", out.whole, wish);
  bucket(container, "Passer med justering", out.adjusted, wish);
  if (out.siblings.length) bucket(container, "Lignende bil i nærheten", out.siblings, wish);
  if (!out.whole.length && !out.adjusted.length) {
    container.append(el("p", { class: "hint", text: "Ingen biler passer i dette tidsrommet. Prøv et større vindu eller lengre gangavstand." }));
  }
}

function bucket(container, title, fits, wish) {
  if (!fits.length) return;
  const box = el("section", { class: "bucket" }, [el("h2", { text: `${title} (${fits.length})` })]);
  for (const f of fits) box.append(carCard(f, wish));
  container.append(box);
}

function carCard(f, wish) {
  const card = el("div", { class: "car" });
  card.append(el("div", { class: "head" }, [
    el("strong", { text: `#${f.carNumber} ${f.model}` }),
    el("span", { class: "meta", text: `${f.location.name} · ${Math.round(f.location.distance)} m · ${f.hourlyRate} kr/t` }),
  ]));
  if (f.kind === "short") {
    const t = Math.round(f.bestBlockMinutes / 60);
    card.append(el("div", { class: "sub", text: `Kort ned: lengste ledige blokk er ~${t} t` }));
  } else if (f.shiftMinutes > 0 && f.proposed) {
    card.append(el("div", { class: "sub", text: `Skyv start til ${fmt(f.proposed.start)}` }));
  }
  card.append(timeline(f, wish));
  if (f.proposed) {
    const url = `https://app.dele.no/findcar?start=${encodeURIComponent(toLocalISO(f.proposed.start))}&end=${encodeURIComponent(toLocalISO(f.proposed.end))}`;
    card.append(el("a", { class: "open", href: url, target: "_blank", rel: "noopener",
      text: `Åpne i dele.no (velg «${f.location.name}»)` }));
  }
  return card;
}

function timeline(f, wish) {
  const bar = el("div", { class: "timeline" });
  const span = wish.latestEnd - wish.earliestStart;
  const pct = (ms) => `${(ms / span) * 100}%`;
  // Grå bakgrunn = opptatt/utilgjengelig. Tegn ledige segmenter grønt oppå.
  for (const s of f.segments || []) {
    if (s.state !== "AVAILABLE") continue;
    const left = s.start - wish.earliestStart;
    const width = s.end - s.start;
    bar.append(el("div", { class: "seg available", style: `left:${pct(left)};width:${pct(width)}` }));
  }
  // Lilla markør-brakett rundt det foreslåtte booking-vinduet.
  if (f.proposed) {
    const left = f.proposed.start - wish.earliestStart;
    const width = f.proposed.end - f.proposed.start;
    bar.append(el("div", { class: "marker", style: `left:${pct(left)};width:${pct(width)}` }));
  }
  return bar;
}

init();
```

Tidslinjen tegner hele ledig/opptatt-mønsteret i vinduet (grønne ledige segmenter på grå bakgrunn) med en lilla brakett rundt det foreslåtte vinduet, spec-krav nivå 1.

- [ ] **Step 4: Verifiser hele flyten i nettleseren**

Last flex på nytt, åpne en innlogget app.dele.no-fane, åpne finder via popup. Velg Eksempelveien, sett et tidsvindu, trykk Søk. Bekreft:
- "Ledig hele ditt vindu" og "Passer med justering" fylles med ekte biler.
- Hver bil viser distanse, pris, tidslinje-segment og "Åpne i dele.no"-lenke.
- Klikk lenka: ny fane åpner dele.no med riktig tid forhåndsutfylt.
- Test i både lys og mørk modus (bytt OS-tema eller `prefers-color-scheme`).

- [ ] **Step 5: Commit** (spør først)

```bash
git add flex/finder.html flex/finder.js flex/finder.css
git commit -m "feat(flex): finder-UI med ønske-form, resultater og dele.no-handoff"
```

---

### Task 9 (fase 1.5): `splitPairs`: del hele-vinduet på to biler

**Files:**
- Modify: `flex/lib/flex.js`, `flex/finder.js`
- Test: `flex/test/flex.test.js`

**Interfaces:**
- Consumes: `freeBlocks`, filtre.
- Produces: `splitPairs(searchResult, wish, opts?): Array<{ handover: Date, first: CarRef, second: CarRef }>` der `CarRef = { carId, carNumber, model, location }`. `opts.sameLocationOnly` (default false).

- [ ] **Step 1: Skriv feilende test**

```js
import { splitPairs } from "../lib/flex.js";

test("splitPairs finner par med overlevering når ingen enkeltbil dekker", () => {
  const a = car([seg("2026-07-08T09:00:00", "2026-07-09T09:00:00", "AVAILABLE"),
                 seg("2026-07-09T09:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "A" });
  const b = car([seg("2026-07-08T09:00:00", "2026-07-09T09:00:00", "RESERVED"),
                 seg("2026-07-09T09:00:00", "2026-07-10T17:00:00", "AVAILABLE")], { carId: "B" });
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null, filters: {},
  };
  const pairs = splitPairs({ cars: [a, b] }, wish);
  assert.ok(pairs.length >= 1);
  assert.equal(pairs[0].handover.getTime(), parseLocalISO("2026-07-09T09:00:00").getTime());
  assert.deepEqual([pairs[0].first.carId, pairs[0].second.carId], ["A", "B"]);
});

test("splitPairs gir ingen par når én bil dekker alt", () => {
  const full = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")], { carId: "F" });
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null, filters: {},
  };
  // full dekker alt -> del-opp er unødvendig; splitPairs skal filtrere bort par der begge halvdeler er samme dekning
  const pairs = splitPairs({ cars: [full] }, wish);
  assert.equal(pairs.length, 0);
});
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `cd flex && node --test test/flex.test.js`
Expected: FAIL, "does not provide an export named 'splitPairs'".

- [ ] **Step 3: Legg til `splitPairs` i `flex/lib/flex.js`**

```js
function coversRange(blocks, from, to) {
  return blocks.some((b) => b.start <= from && b.end >= to);
}

function carRef(car) {
  return { carId: car.carId, carNumber: car.carNumber, model: car.model,
           location: { name: car.location?.name, distance: car.location?.distance, id: car.location?.id } };
}

export function splitPairs(searchResult, wish, opts = {}) {
  const { sameLocationOnly = false } = opts;
  const ES = wish.earliestStart, LE = wish.latestEnd;
  const entries = (searchResult.cars || [])
    .filter((c) => matchesFilters(c, wish.filters))
    .filter((c) => withinDistance(c, wish.filters))
    .map((c) => ({ car: c, blocks: freeBlocks(c.availability, ES, LE) }))
    .filter((e) => e.blocks.length > 0);

  // Hvis en enkeltbil dekker hele vinduet er del-opp unødvendig.
  if (entries.some((e) => coversRange(e.blocks, ES, LE))) return [];

  const boundaries = new Set();
  for (const e of entries) {
    for (const b of e.blocks) {
      if (b.start > ES && b.start < LE) boundaries.add(b.start.getTime());
      if (b.end > ES && b.end < LE) boundaries.add(b.end.getTime());
    }
  }

  const seen = new Set();
  const pairs = [];
  for (const tMs of [...boundaries].sort((a, b) => a - b)) {
    const T = new Date(tMs);
    const first = entries.filter((e) => coversRange(e.blocks, ES, T));
    const second = entries.filter((e) => coversRange(e.blocks, T, LE));
    for (const a of first) {
      for (const b of second) {
        if (a.car.carId === b.car.carId) continue;
        if (sameLocationOnly && a.car.location?.id !== b.car.location?.id) continue;
        const key = `${a.car.carId}|${b.car.carId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ handover: T, first: carRef(a.car), second: carRef(b.car) });
      }
    }
  }
  // ranger: samme sted for bytte først, så nærmest midten
  const mid = (ES.getTime() + LE.getTime()) / 2;
  pairs.sort((p, q) => {
    const ps = p.first.location.id === p.second.location.id ? 0 : 1;
    const qs = q.first.location.id === q.second.location.id ? 0 : 1;
    if (ps !== qs) return ps - qs;
    return Math.abs(p.handover.getTime() - mid) - Math.abs(q.handover.getTime() - mid);
  });
  return pairs.slice(0, 10);
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `cd flex && node --test`
Expected: PASS, alle tester.

- [ ] **Step 5: Vis del-opp i UI-en**

I `flex/finder.js`, importer og kall `splitPairs` når begge hovedbuckets er tomme i hele-vinduet-modus. Legg til i importen:

```js
import { solve, splitPairs } from "./lib/flex.js";
```

Utvid `render` slik at den etter tom-sjekken foreslår del-opp:

```js
function render(container, out, wish, searchResult) {
  container.replaceChildren();
  bucket(container, "Ledig hele ditt vindu", out.whole, wish);
  bucket(container, "Passer med justering", out.adjusted, wish);
  if (out.siblings.length) bucket(container, "Lignende bil i nærheten", out.siblings, wish);
  if (!out.whole.length && wish.durationMinutes == null) {
    const pairs = splitPairs(searchResult, wish);
    if (pairs.length) renderSplits(container, pairs);
  }
  if (!out.whole.length && !out.adjusted.length) {
    container.append(el("p", { class: "hint", text: "Ingen biler passer i dette tidsrommet. Prøv et større vindu eller lengre gangavstand." }));
  }
}

function renderSplits(container, pairs) {
  const box = el("section", { class: "bucket" }, [el("h2", { text: `Del opp på to biler (${pairs.length})` })]);
  for (const p of pairs) {
    box.append(el("div", { class: "car" }, [
      el("div", { text: `#${p.first.carNumber} ${p.first.model} (${p.first.location.name}) → bytt ${fmt(p.handover)} → #${p.second.carNumber} ${p.second.model} (${p.second.location.name})` }),
    ]));
  }
  container.append(box);
}
```

Og oppdater `onSearch` sitt kall til `render(results, out, wish, res.result);`.

- [ ] **Step 6: Verifiser i nettleseren**

Søk et langt vindu i en travel periode (fellesferie) der ingen enkeltbil er ledig hele veien. Bekreft at "Del opp på to biler" dukker opp med fornuftige par og byttetidspunkt.

- [ ] **Step 7: Commit** (spør først)

```bash
git add flex/lib/flex.js flex/finder.js flex/test/flex.test.js
git commit -m "feat(flex): del-opp-på-to-biler (fase 1.5)"
```

---

## Self-Review

**Spec-dekning:**
- Ledig-tidslinje → Task 4 (`clippedSegments` → `CarFit.segments`) + Task 8 (full segment-for-segment tidslinje).
- Passende vinduer (eksakt/skyv/kort ned) → Task 4 (`fitCar`), Task 5 (`solve` buckets).
- Søsken-bil → Task 5 (`siblingSuggestions`).
- Del opp på to biler → Task 9 (`splitPairs`), markert fase 1.5.
- API `/api/search` + `/api/locations` → Task 6 (`search-api.js`).
- Auth via content script + scripting-fallback → Task 1.
- Handoff/redirect med tid (sted som navn) → Task 8 (`carCard` lenke).
- Lagring (mine steder / favoritter) → Task 7.
- Monorepo `stats/` + `flex/` → Task 0.
- Testrunner uten build-step → Task 2 (`node --test`, `package.json` type:module).

**Placeholder-skann:** Ingen "TBD/TODO". Tidslinje-noten i Task 8 er en bevisst, valgfri utvidelse med konkret oppskrift, ikke en åpen placeholder. v1 fungerer uten den.

**Type-konsistens:** `CarFit`-felter (`kind`, `proposed`, `coversWholeWindow`, `shiftMinutes`, `bestBlockMinutes`, `shortfallMinutes`, `segments`, `location.{name,distance,id}`) er like i Task 4, 5 og forbrukt i Task 8 (`timeline` leser `f.segments`). `searchAvailability(point, start, end, token)` med `point:{lng,lat}` er lik i Task 6 og kalt i background. `solve`-retur `{whole, adjusted, siblings}` matcher `render` i Task 8.

## Åpne spørsmål / risiko

- `siblingSuggestions` antar at målbilen er innenfor distansefilteret; hvis brukeren favoriserer en bil langt unna, kan den falle ut. Håndteres når "mine biler"-favoritter kobles på target.
- Per-bil deep-link ikke funnet, handoff bruker tid + stedsnavn (godkjent for v1).
- `before`/`after` i søkesvaret er fortsatt ukjent (ikke brukt).
