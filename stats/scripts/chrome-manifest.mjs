// Lager manifestet til Chrome-pakken fra manifest.json, som er det eneste
// manifestet i repoet. Chrome varsler om nøkler bare Firefox kjenner, så de
// fjernes her: browser_specific_settings (gecko, gecko_android og
// AMO-kravene) og action.theme_icons. Firefox ignorerer
// background.service_worker og AMO-validatoren varsler om den, så
// manifest.json har bare background.scripts. Chrome vil ha det motsatte, og
// første script blir service_worker her. type: module blir stående.
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
  const [worker, ...rest] = manifest.background.scripts ?? [];
  // En service worker er én fil. Flere script ville stille mistet resten.
  if (!worker || rest.length > 0) {
    console.error("manifest.json må ha nøyaktig ett background.scripts, som blir Chrome sin service_worker.");
    process.exit(1);
  }
  const { scripts, ...other } = manifest.background;
  manifest.background = { service_worker: worker, ...other };
}
manifest.minimum_chrome_version = MINIMUM_CHROME_VERSION;

writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
