// Tokenet og medlemskaps-id-en skal aldri havne i konsollen. Den første
// sjekken leser kildekoden og ser på argumentene til hvert console.*-kall.
// Tekst i strenger er lov («Auth token received»), men et uttrykk som peker
// på tokenet, headeren eller medlemskapet er det ikke. Den kan ikke se at
// `result` eller `response` bærer tokenet, så den andre sjekken kjører
// innloggingsstien i background.js med et falskt token og leser konsollen.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["vendor", "test", "node_modules"]);

// auth og currentAuth er objektene som bærer tokenet, getAuth() gir det
// tilbake, og JSON.stringify skriver ut hele objekter.
const FORBIDDEN = /\b(token|authorization|membershipId|auth|currentAuth|getAuth|stringify)\b/i;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.m?js$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Argumentene til hvert console.*-kall, med strengtekst fjernet og
 * ${…}-uttrykk i malstrenger beholdt.
 */
function consoleArguments(source) {
  const calls = [];
  const start = /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/g;
  let m;
  while ((m = start.exec(source))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let code = "";
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '"' || c === "'") {
        const from = ++i;
        while (i < source.length && source[i] !== c) i += source[i] === "\\" ? 2 : 1;
        // Strengen i headers["Authorization"] er et feltnavn, ikke tekst.
        code += code.trimEnd().endsWith("[") ? source.slice(from, i) : '""';
      } else if (c === "`") {
        i++;
        while (i < source.length && source[i] !== "`") {
          if (source[i] === "\\") i += 2;
          else if (source[i] === "$" && source[i + 1] === "{") {
            // Uttrykket leses til matchende }.
            let d = 1;
            i += 2;
            while (i < source.length && d > 0) {
              if (source[i] === "{") d++;
              else if (source[i] === "}") d--;
              if (d > 0) code += source[i];
              i++;
            }
            code += " ";
          } else i++;
        }
      } else {
        if (c === "(") depth++;
        else if (c === ")") depth--;
        if (depth > 0) code += c;
      }
      i++;
    }
    const line = source.slice(0, m.index).split("\n").length;
    calls.push({ line, code });
  }
  return calls;
}

test("sjekken griper et kall som logger tokenet", () => {
  const bad = [
    "console.log(auth.token);",
    "console.log(`hdr ${headers.authorization}`);",
    "console.warn('x', { membershipId });",
    "console.log(currentAuth);",
    "console.log('svar', await getAuth());",
    'console.log(headers["Authorization"]);',
    "console.log(JSON.stringify(response));",
  ];
  for (const src of bad) {
    const [call] = consoleArguments(src);
    assert.match(call.code, FORBIDDEN, src);
  }
  const [ok] = consoleArguments('console.log("[BG] Auth token received", tabs.length);');
  assert.doesNotMatch(ok.code, FORBIDDEN);
});

test("ingen console.* i stats logger token, authorization eller membershipId", () => {
  const hits = [];
  for (const file of sourceFiles(ROOT)) {
    for (const { line, code } of consoleArguments(readFileSync(file, "utf8"))) {
      if (FORBIDDEN.test(code)) hits.push(`${relative(ROOT, file)}:${line}: ${code.trim()}`);
    }
  }
  assert.deepEqual(hits, []);
});

// Falske verdier som er lette å kjenne igjen i loggen.
const FAKE_TOKEN = "eyJfalsk.token-9f3c2a7e";
const FAKE_MEMBERSHIP = "medlemskap-4b8d1e60";

/** Alt konsollen fikk, som tekst, mens fn kjører. */
async function captureConsole(fn) {
  const lines = [];
  const methods = ["log", "warn", "error", "info", "debug", "trace"];
  const original = Object.fromEntries(methods.map((m) => [m, console[m]]));
  for (const m of methods) {
    console[m] = (...args) => lines.push(args.map((a) => inspect(a, { depth: null })).join(" "));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

function leaks(lines) {
  return lines.filter((l) => l.includes(FAKE_TOKEN) || l.includes(FAKE_MEMBERSHIP));
}

test("fangsten kjenner igjen tokenet i et logget objekt", async () => {
  const result = { token: { accessToken: FAKE_TOKEN }, membershipId: FAKE_MEMBERSHIP };
  const lines = await captureConsole(() => console.log("[BG] svar", result));
  assert.equal(leaks(lines).length, 1);
});

test("innloggingsstien i background.js logger aldri tokenet eller medlemskapet", async () => {
  // Tokenet fra dele.no er et JSON-objekt, ikke bare en streng.
  const auth = { token: { accessToken: FAKE_TOKEN }, membershipId: FAKE_MEMBERSHIP };
  let listener;
  // Hver fane har sitt svar fra content-scriptet og fra executeScript.
  let tabs = [];
  let hasPermission = true;
  globalThis.browser = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    permissions: { contains: async () => hasPermission },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      // Uten host-tilgang finner tabs.query ingen app.dele.no-faner.
      query: async () => (hasPermission ? tabs.map(({ id, discarded }) => ({ id, discarded })) : []),
      sendMessage: async (id) => {
        const reply = tabs.find((t) => t.id === id).content;
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
    scripting: {
      executeScript: async ({ target }) => {
        const reply = tabs.find((t) => t.id === target.tabId).injected;
        if (reply instanceof Error) throw reply;
        return [{ result: reply }];
      },
    },
  };
  // Tidsavbruddet i getAuth() skal ikke holde testen åpen i fem sekunder.
  mock.timers.enable({ apis: ["setTimeout"] });

  const send = (message) =>
    new Promise((resolve) => {
      if (!listener(message, {}, resolve)) resolve(undefined);
    });

  try {
    const lines = await captureConsole(async () => {
      await import("../background.js");

      // Content-scriptet sender tokenet av seg selv.
      await send({ type: "AUTH_TOKEN", data: auth });
      assert.deepEqual(await send({ type: "GET_SYNC_AUTH" }), auth);

      // Uten token i minnet: første fane har content-script uten token og en
      // side uten medlemskap, andre fane gir tokenet gjennom executeScript.
      await send({ type: "CLEAR_AUTH" });
      tabs = [
        {
          id: 1,
          content: { membershipId: FAKE_MEMBERSHIP },
          injected: { error: "no selectedMembership field", parsedKeys: ["authentication"] },
        },
        { id: 2, content: new Error("Could not establish connection"), injected: auth },
      ];
      assert.deepEqual(await send({ type: "GET_SYNC_AUTH" }), auth);
      assert.deepEqual(await send({ type: "GET_AUTH_STATUS" }), { hasAuth: true, state: "ok", tabId: null });

      // Content-scriptet svarer med tokenet.
      await send({ type: "CLEAR_AUTH" });
      tabs = [{ id: 3, content: auth, injected: new Error("ikke brukt") }];
      assert.deepEqual(await send({ type: "GET_SYNC_AUTH" }), auth);

      // executeScript feiler.
      await send({ type: "CLEAR_AUTH" });
      tabs = [{ id: 4, content: null, injected: new Error("Missing host permission") }];
      assert.equal(await send({ type: "GET_SYNC_AUTH" }), null);

      // Fanen var åpen før installasjonen og er lastet ut: den prøves ikke,
      // og svaret ber om å laste den på nytt.
      tabs = [{ id: 5, discarded: true, content: new Error("ikke brukt"), injected: new Error("ikke brukt") }];
      assert.deepEqual(await send({ type: "GET_AUTH_STATUS" }), {
        hasAuth: false,
        state: "reload-needed",
        tabId: 5,
      });

      // Uten host-tilgang er det tilgangen som mangler.
      hasPermission = false;
      assert.deepEqual(await send({ type: "GET_AUTH_STATUS" }), {
        hasAuth: false,
        state: "no-permission",
        tabId: null,
      });
    });

    assert.ok(lines.length >= 8, `for lite logg til å si noe: ${lines.length} linjer`);
    assert.deepEqual(leaks(lines), []);
  } finally {
    mock.timers.reset();
    delete globalThis.browser;
  }
});
