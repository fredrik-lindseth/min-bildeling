// Lager manifestet til Chrome-pakken fra manifest.json, som er det eneste
// manifestet i repoet. Chrome varsler om nøkler bare Firefox kjenner, så de
// fjernes her: browser_specific_settings (gecko-id og AMO-kravene),
// action.theme_icons og background.scripts (Chrome vil bare ha service_worker).
//
// Bruk: node scripts/chrome-manifest.mjs <manifest.json> <ut.json>

import { readFileSync, writeFileSync } from "node:fs";

// light-dark() i lib/tokens.css kom i Chrome 123. Ingenting annet i koden
// krever nyere.
const MINIMUM_CHROME_VERSION = "123";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("Bruk: node chrome-manifest.mjs <manifest.json> <ut.json>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(src, "utf8"));

delete manifest.browser_specific_settings;
if (manifest.action) delete manifest.action.theme_icons;
if (manifest.background) {
  if (!manifest.background.service_worker) {
    console.error("manifest.json mangler background.service_worker, som Chrome trenger.");
    process.exit(1);
  }
  delete manifest.background.scripts;
}
manifest.minimum_chrome_version = MINIMUM_CHROME_VERSION;

writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
