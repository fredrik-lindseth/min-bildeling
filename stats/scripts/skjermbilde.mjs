// Tar skjermbilder med hodeløs Firefox over WebDriver BiDi. Kalles av
// skjermbilder.sh, én gang per profil (lys eller mørk).
//
// node skjermbilde.mjs <firefox> <profil> <utmappe> <navn> <bredde>x<høyde> <url> [<navn> <str> <url> ...]
//
// Høyden 0 betyr hele dokumentet (popupen, som ikke har fast høyde). Med 0
// og et anker i adressen tas bare elementet ankeret peker på, i full høyde.
//
// Firefox sin egen --screenshot tar bildet ved load og fotograferer alltid
// dokumentet fra toppen, så en seksjon lenger ned kan ikke tas med den.
// BiDi er innebygd i Firefox og WebSocket i Node, så ingenting må installeres.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const [firefox, profile, outDir, ...rest] = process.argv.slice(2);
if (!firefox || !profile || !outDir || rest.length === 0 || rest.length % 3 !== 0) {
  console.error("Bruk: node skjermbilde.mjs <firefox> <profil> <utmappe> <navn> <bredde>x<høyde> <url> ...");
  process.exit(2);
}
const shots = [];
for (let i = 0; i < rest.length; i += 3) {
  const [width, height] = rest[i + 1].split("x").map(Number);
  shots.push({ name: rest[i], width, height, url: rest[i + 2] });
}

const browser = spawn(
  firefox,
  ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port=0", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] }
);

// Firefox skriver adressen til stderr når BiDi lytter.
const wsUrl = await new Promise((resolve, reject) => {
  let log = "";
  // Firefox drepes ved tidsavbrudd, ellers blir den hengende igjen og
  // holder på profilen etter at scriptet har gitt opp.
  const timer = setTimeout(() => {
    browser.kill();
    reject(new Error(`Firefox startet ikke BiDi:\n${log}`));
  }, 30_000);
  browser.stderr.on("data", (chunk) => {
    log += chunk;
    const match = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  browser.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Firefox avsluttet (${code}):\n${log}`));
  });
});

const ws = new WebSocket(`${wsUrl}/session`);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener(
    "error",
    () => {
      browser.kill();
      reject(new Error(`Fikk ikke koblet til ${wsUrl}`));
    },
    { once: true }
  );
});

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id === undefined || !pending.has(msg.id)) return;
  const { resolve, reject, method } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.type === "error") reject(new Error(`${method}: ${msg.error} ${msg.message}`));
  else resolve(msg.result);
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

// Venter til siden har tegnet to hele rammer etter load. Diagrammer som
// Chart.js retter opp ved ResizeObserver, blir da ferdige før bildet tas.
const SETTLE = `new Promise((resolve) =>
  document.fonts.ready.then(() =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))`;

try {
  await send("session.new", { capabilities: {} });
  const { contexts } = await send("browsingContext.getTree", {});
  const context = contexts[0].context;

  for (const shot of shots) {
    await send("browsingContext.setViewport", {
      context,
      viewport: { width: shot.width, height: shot.height || 400 },
      devicePixelRatio: 1,
    });
    // Innom about:blank, så et anker på samme side gir full lasting og ikke
    // bare et hopp i siden som alt er åpen.
    await send("browsingContext.navigate", { context, url: "about:blank", wait: "complete" });
    await send("browsingContext.navigate", { context, url: shot.url, wait: "complete" });
    await send("script.evaluate", {
      expression: SETTLE,
      target: { context },
      awaitPromise: true,
    });
    const anchor = new URL(shot.url).hash.slice(1);
    let clip;
    if (!shot.height && anchor) {
      // Til toppen først, så den klebrige navigasjonen ligger der den hører
      // til i dokumentet og ikke over seksjonen.
      const { result } = await send("script.evaluate", {
        expression: `(() => {
          window.scrollTo(0, 0);
          const r = document.getElementById(${JSON.stringify(anchor)}).getBoundingClientRect();
          // Utsnittet starter under klebrige elementer over seksjonen, så
          // ikke halve navigasjonen kommer med over den første seksjonen.
          let floor = 0;
          for (const el of document.querySelectorAll("body *")) {
            if (getComputedStyle(el).position !== "sticky") continue;
            const b = el.getBoundingClientRect();
            if (b.bottom <= r.top) floor = Math.max(floor, b.bottom);
          }
          return JSON.stringify({ y: r.top, height: r.height, floor });
        })()`,
        target: { context },
        awaitPromise: false,
      });
      const box = JSON.parse(result.value);
      const pad = 24;
      const top = Math.max(box.floor, box.y - pad);
      clip = { type: "box", x: 0, y: top, width: shot.width, height: box.y + box.height + pad - top };
    }
    const { data } = await send("browsingContext.captureScreenshot", {
      context,
      origin: shot.height ? "viewport" : "document",
      ...(clip && { clip }),
    });
    await writeFile(join(outDir, `${shot.name}.png`), Buffer.from(data, "base64"));
  }
  await send("session.end", {}).catch(() => {});
} finally {
  ws.close();
  // Vent til Firefox er ute, så profilen kan slettes etterpå.
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill();
  await exited;
}
