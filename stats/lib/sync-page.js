// Limet mellom synkmotoren og utvidelsessidene (dashbord og popup). Synken
// kjører i siden selv. Background brukes bare til å hente innloggingen fra
// app.dele.no-fanen. Se kommentaren øverst i sync.js for hvorfor.

import { browserAPI, storage } from "./browser-polyfill.js";
import { releaseLock, runSyncWhenFree } from "./sync.js";

export {
  isAuthError,
  describeSyncResult,
  describeProgress,
} from "./sync-messages.js";

const owner =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `side-${Date.now()}-${Math.random()}`;

let inFlight = null;
let holdsLock = false;

// Lukkes siden midt i en synk, slippes låsen med en gang, så neste side
// slipper å vente på at leasen går ut. Låsen slettes bare hvis den fortsatt
// er vår: en annen side kan ha tatt den over siden holdsLock ble satt.
// Best effort: siden venter ikke på svaret. Rekker det ikke fram, tar neste
// side over når leasen er ute, eller med en gang om låsen var popupens.
globalThis.addEventListener?.("pagehide", () => {
  if (holdsLock) releaseLock(storage, owner).catch(() => {});
});

async function getAuth() {
  return browserAPI.runtime.sendMessage({ type: "GET_SYNC_AUTH" });
}

/**
 * Start (eller bli med på) synken fra denne siden. Synker en annen side, venter
 * den og melder fremdriften derfra (se runSyncWhenFree).
 * @param {object} opts { force, full, maxDetails, role, onProgress }
 *   role: "popup" for popupen, som et dashboard alltid kan ta over fra.
 */
export function startSync(opts = {}) {
  if (inFlight) return inFlight;
  const clientId = `bildeleringen-stats/${browserAPI.runtime.getManifest().version}`;
  inFlight = runSyncWhenFree({
    fetch: (url, init) => fetch(url, init),
    storage,
    getAuth,
    clientId,
    owner,
    onLock: (held) => {
      holdsLock = held;
    },
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
      holdsLock = false;
    });
  return inFlight;
}
