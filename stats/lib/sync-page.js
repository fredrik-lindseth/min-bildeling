// Limet mellom synkmotoren og utvidelsessidene (dashbord og popup). Synken
// kjører i siden selv. Background brukes bare til å hente innloggingen fra
// app.dele.no-fanen. Se kommentaren øverst i sync.js for hvorfor.

import { browserAPI, storage } from "./browser-polyfill.js";
import { runSync } from "./sync.js";

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

export function isAuthError(error) {
  return error === "NOT_LOGGED_IN" || error === "AUTH_EXPIRED";
}

/**
 * Norsk tekst for et synkresultat som brukeren bør se, eller null når alt
 * gikk som det skulle. Auth-feil håndteres for seg av sidene (login-boksen).
 */
export function describeSyncResult(result) {
  if (!result) return "Synkroniseringen ga ikke noe svar.";
  if (result.status === "BUSY") {
    return "En synkronisering pågår allerede i et annet vindu. Prøv igjen om et minutt.";
  }
  if (result.error === "SERVICE_UNAVAILABLE") {
    return withProgress(
      result,
      "Dele sin tjeneste svarer ikke akkurat nå. Prøver igjen ved neste synkronisering."
    );
  }
  if (result.error && !isAuthError(result.error)) {
    return withProgress(result, `Synkroniseringen stoppet: ${result.error}`);
  }
  if (result.status === "PARTIAL") {
    return `Hentet ${result.done} av ${result.total}. Resten hentes når du åpner dashbordet.`;
  }
  if (result.status === "SYNCED" && result.failedThisRun > 0) {
    return `Hentet ${result.done - result.failedThisRun} av ${result.total}. ${result.failedThisRun} kunne ikke hentes og prøves igjen neste gang.`;
  }
  return null;
}

function withProgress(result, message) {
  if (!result.total) return message;
  return `${message} Hentet ${result.done} av ${result.total} så langt.`;
}

export function describeProgress({ phase, current, total }) {
  if (phase === "list") {
    return total ? `Henter reservasjonslisten (${total} totalt)…` : "Henter reservasjonslisten…";
  }
  if (phase === "details" && total > 0) return `Henter detaljer: ${current} av ${total}`;
  return "Synkroniserer…";
}
