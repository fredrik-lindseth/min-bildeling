// Limet mellom synkmotoren og utvidelsessidene (dashbord og popup). Synken
// kjører i siden selv. Background brukes bare til å hente innloggingen fra
// app.dele.no-fanen. Se kommentaren øverst i sync.js for hvorfor.

import { browserAPI, storage } from "./browser-polyfill.js";
import { runSync } from "./sync.js";

export { isAuthError, describeSyncResult, describeProgress } from "./sync-messages.js";

const owner =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `side-${Date.now()}-${Math.random()}`;

let inFlight = null;

async function getAuth() {
  return browserAPI.runtime.sendMessage({ type: "GET_SYNC_AUTH" });
}

/**
 * Start (eller bli med på) synken fra denne siden.
 * @param {object} opts { force, full, maxDetails, onProgress }
 */
export function startSync(opts = {}) {
  if (inFlight) return inFlight;
  const clientId = `bildeleringen-stats/${browserAPI.runtime.getManifest().version}`;
  inFlight = runSync({
    fetch: (url, init) => fetch(url, init),
    storage,
    getAuth,
    clientId,
    owner,
    ...opts,
  })
    .then(async (result) => {
      if (result.error === "AUTH_EXPIRED") {
        await browserAPI.runtime.sendMessage({ type: "CLEAR_AUTH" }).catch(() => {});
      }
      return result;
    })
    .catch((e) => {
      console.error("[sync] Uventet feil", e);
      return { status: "ERROR", error: e.message || String(e) };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
