// Laster den utpakkede Chrome-utgaven i en kasteprofil i hodeløs Chrome og
// feiler på alt Chrome selv melder om utvidelsen: manifestfeil,
// installasjonsadvarsler (ukjente nøkler o.l.) og feil fra service workeren.
// Chrome Web Store har ingen offentlig validator, så dette er det nærmeste.
//
// Chrome 137+ ignorerer --load-extension, så utvidelsen lastes via CDP
// (Extensions.loadUnpacked) over --remote-debugging-pipe. Advarslene står
// bare i chrome.developerPrivate, API-et bak chrome://extensions, så
// skriptet åpner den siden og spør der.
//
// Bruk: node scripts/sjekk-chrome.mjs <utpakket mappe>
// CHROME_BIN overstyrer stien til Chrome.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Service workeren får tid til å starte og eventuelt kaste før vi leser feil.
const VENT_PA_WORKER_MS = 2000;
const TIDSAVBRUDD_MS = 30000;

const dir = process.argv[2];
if (!dir) {
  console.error("Bruk: node sjekk-chrome.mjs <utpakket mappe>");
  process.exit(2);
}
const extDir = resolve(dir);
if (!existsSync(join(extDir, "manifest.json"))) {
  console.error(`Fant ikke ${extDir}/manifest.json. Kjør package.sh først.`);
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`Fant ikke Chrome på ${CHROME}. Installer Google Chrome eller sett CHROME_BIN.`);
  process.exit(2);
}

const profil = mkdtempSync(join(tmpdir(), "min-bildeling-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--user-data-dir=${profil}`,
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    // Ingen navneoppslag lykkes, så verken content-scriptet, synken eller
    // Chrome selv når app.dele.no eller noe annet på nettet.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);

let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d));

const tilChrome = chrome.stdio[3];
const fraChrome = chrome.stdio[4];
let nesteId = 1;
const venter = new Map();
let buffer = Buffer.alloc(0);

fraChrome.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let slutt;
  // Meldingene på pipen er JSON skilt med NUL-byte.
  while ((slutt = buffer.indexOf(0)) !== -1) {
    const melding = JSON.parse(buffer.subarray(0, slutt).toString("utf8"));
    buffer = buffer.subarray(slutt + 1);
    const v = venter.get(melding.id);
    if (!v) continue;
    venter.delete(melding.id);
    if (melding.error) v.reject(new Error(`${v.method}: ${melding.error.message}`));
    else v.resolve(melding.result);
  }
});

function send(method, params = {}, sessionId) {
  const id = nesteId++;
  const melding = { id, method, params };
  if (sessionId) melding.sessionId = sessionId;
  tilChrome.write(`${JSON.stringify(melding)}\0`);
  return new Promise((res, rej) => venter.set(id, { resolve: res, reject: rej, method }));
}

const vent = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluer(sessionId, uttrykk) {
  const svar = await send("Runtime.evaluate", { expression: uttrykk, awaitPromise: true, returnByValue: true }, sessionId);
  if (svar.exceptionDetails) {
    throw new Error(svar.exceptionDetails.exception?.description ?? svar.exceptionDetails.text);
  }
  return svar.result.value;
}

async function sjekk() {
  // Åpne chrome://extensions først og slå på utviklermodus, ellers samler
  // Chrome ikke manifest- og kjøretidsfeil for utvidelsen.
  const { targetId } = await send("Target.createTarget", { url: "chrome://extensions" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await vent(500);
  await evaluer(sessionId, "chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })");

  const { id } = await send("Extensions.loadUnpacked", { path: extDir });
  await vent(VENT_PA_WORKER_MS);

  const info = await evaluer(
    sessionId,
    `chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)}).then((i) => ({
      versjon: i.version,
      tilstand: i.state,
      installWarnings: i.installWarnings,
      manifestErrors: i.manifestErrors.map((e) => e.message),
      runtimeErrors: i.runtimeErrors.map((e) => e.severity + ": " + e.message + " (" + e.source + ")"),
    }))`,
  );

  const { targetInfos } = await send("Target.getTargets");
  const worker = targetInfos.find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${id}/`));

  const funn = [
    ...info.installWarnings.map((m) => `advarsel: ${m}`),
    ...info.manifestErrors.map((m) => `manifest: ${m}`),
    ...info.runtimeErrors.map((m) => `kjøretid: ${m}`),
  ];
  if (info.tilstand !== "ENABLED") funn.push(`tilstand: ${info.tilstand}, ikke ENABLED`);
  if (!worker) funn.push("service workeren startet ikke");

  console.log(`Chrome: lastet ${id} v${info.versjon}, service worker ${worker ? "kjører" : "mangler"}.`);
  for (const f of funn) console.log(`  ${f}`);
  return funn.length;
}

let avslutter = false;
async function avslutt(kode) {
  avslutter = true;
  clearTimeout(tidsavbrudd);
  // Chrome skriver til profilen til den er helt nede, så den må være
  // avsluttet før mappen kan slettes.
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const nede = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await nede;
  }
  rmSync(profil, { recursive: true, force: true, maxRetries: 5 });
  process.exit(kode);
}

const tidsavbrudd = setTimeout(() => {
  console.error(`Chrome svarte ikke innen ${TIDSAVBRUDD_MS / 1000} s.`);
  if (stderr) console.error(stderr.trim());
  avslutt(1);
}, TIDSAVBRUDD_MS);

chrome.on("exit", (kode) => {
  if (avslutter) return;
  console.error(`Chrome avsluttet uventet (kode ${kode}).`);
  if (stderr) console.error(stderr.trim());
  avslutt(1);
});

let antall;
try {
  antall = await sjekk();
} catch (e) {
  console.error(`Chrome-sjekken kunne ikke kjøre: ${e.message}`);
  await avslutt(1);
}
if (antall > 0) {
  console.log(`Chrome-sjekken feilet: ${antall} funn.`);
  await avslutt(1);
}
console.log("Chrome-sjekken: ingen feil eller advarsler.");
await avslutt(0);
