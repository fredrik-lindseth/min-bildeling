// Tokenet og medlemskaps-id-en skal aldri havne i konsollen. Testen leser
// kildekoden og ser på argumentene til hvert console.*-kall. Tekst i
// strenger er lov («Auth token received»), men et uttrykk som peker på
// tokenet, headeren eller medlemskapet er det ikke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["vendor", "test", "node_modules"]);

// auth og currentAuth er objektene som bærer tokenet.
const FORBIDDEN = /\b(token|authorization|membershipId|auth|currentAuth)\b/i;

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
        i++;
        while (i < source.length && source[i] !== c) i += source[i] === "\\" ? 2 : 1;
        code += '""';
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
