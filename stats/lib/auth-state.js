// Hvorfor utvidelsen ikke har innloggingen, og hva brukeren kan gjøre med det.
// Ren modul uten nettleser-API, så valget kan testes i node. background.js
// samler forsøkene per fane, og sidene viser teksten og knappen herfra.

export const DELE_ORIGIN = "https://app.dele.no/*";

export const AUTH_STATE = {
  OK: "ok",
  LOGGED_OUT: "logged-out",
  NO_PERMISSION: "no-permission",
  RELOAD_NEEDED: "reload-needed",
};

/**
 * Utfallet av ett forsøk på å lese innloggingen i en fane:
 *   "auth"   tokenet ble lest
 *   "empty"  localStorage ble lest, men innloggingen var ikke der
 *   "failed" ingen kontakt med fanen (content-scriptet mangler, executeScript feilet)
 *   "skipped" ikke prøvd, fordi fanen er lastet ut (discarded)
 */

/**
 * Velg tilstand ut fra host-tilgangen og forsøkene i hver app.dele.no-fane.
 * @param {object} input
 * @param {boolean} input.hasPermission  permissions.contains for DELE_ORIGIN
 * @param {Array<{id:number, discarded?:boolean, content?:string, injected?:string}>} input.tabs
 * @returns {{ state: string, tabId: number|null }}
 */
export function chooseAuthState({ hasPermission, tabs = [] }) {
  const read = (t) => t.content === "auth" || t.injected === "auth";
  const found = tabs.find(read);
  if (found) return { state: AUTH_STATE.OK, tabId: found.id };

  // Uten host-tilgang finner tabs.query ingen app.dele.no-faner, så en tom
  // liste sier ingenting om innloggingen. Tilgangen må sjekkes først.
  if (!hasPermission) return { state: AUTH_STATE.NO_PERMISSION, tabId: null };
  if (tabs.length === 0) return { state: AUTH_STATE.LOGGED_OUT, tabId: null };

  // localStorage er felles for hele app.dele.no. Kunne én fane leses og
  // innloggingen manglet, er brukeren logget ut, uansett de andre fanene.
  if (tabs.some((t) => t.content === "empty" || t.injected === "empty")) {
    return { state: AUTH_STATE.LOGGED_OUT, tabId: null };
  }

  // Ingen fane kunne leses. Den er lastet ut, eller ble åpnet før utvidelsen
  // og har ikke content-scriptet. En ny lasting gir den begge deler.
  const target = tabs.find((t) => t.discarded) ?? tabs[0];
  return { state: AUTH_STATE.RELOAD_NEEDED, tabId: target.id };
}

/**
 * Tilstanden å vise når synken stoppet på innloggingen. 401 betyr at tokenet
 * er gått ut, og da hjelper bare ny innlogging. Ellers gjelder svaret fra
 * GET_AUTH_STATUS. Er det borte eller sier ok (innloggingen kom imens), er
 * det tryggest å be om innlogging.
 */
export function stateForSyncError(error, status) {
  if (error === "AUTH_EXPIRED") return { state: AUTH_STATE.LOGGED_OUT, tabId: null };
  const state = status?.state;
  if (state === AUTH_STATE.NO_PERMISSION || state === AUTH_STATE.RELOAD_NEEDED) {
    return { state, tabId: status.tabId ?? null };
  }
  return { state: AUTH_STATE.LOGGED_OUT, tabId: null };
}

/**
 * Overskrift, forklaring og handling for en tilstand, eller null for ok.
 * action.kind: "open" (lenke til app.dele.no), "permission" (permissions.request)
 * eller "reload" (tabs.reload på tabId).
 */
export function describeAuthState(state) {
  switch (state) {
    case AUTH_STATE.LOGGED_OUT:
      return {
        title: "Ikke innlogget",
        text: "Logg inn på app.dele.no og trykk Synkroniser.",
        action: { kind: "open", label: "Åpne app.dele.no" },
      };
    case AUTH_STATE.NO_PERMISSION:
      return {
        title: "Tilgang mangler",
        text: "Utvidelsen trenger tilgang til app.dele.no for å lese innloggingen.",
        action: { kind: "permission", label: "Gi tilgang" },
      };
    case AUTH_STATE.RELOAD_NEEDED:
      return {
        title: "Fanen må lastes på nytt",
        text: "Innloggingen i dele.no-fanen kan ikke leses før fanen er lastet inn på nytt.",
        action: { kind: "reload", label: "Last inn fanen på nytt" },
      };
    default:
      return null;
  }
}
