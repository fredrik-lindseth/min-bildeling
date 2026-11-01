// Banneret for manglende innlogging, felles for popupen og dashbordet.
// Tilstanden og teksten kommer fra lib/auth-state.js. Her bygges bare
// innholdet og knappen.

import { browserAPI } from "./browser-polyfill.js";
import { DELE_ORIGIN, describeAuthState } from "./auth-state.js";

const RELOAD_WAIT_MS = 15000;
const RELOAD_POLL_MS = 1000;

/**
 * Fyll statusfeltet for en tilstand fra lib/auth-state.js.
 * @param {object} opts
 * @param {HTMLElement} opts.statusEl   banneret, får klassen status--login
 * @param {HTMLElement} opts.textEl     teksten i banneret
 * @param {string} opts.state
 * @param {number|null} opts.tabId      fanen som skal lastes på nytt
 * @param {() => Promise<object>} opts.getStatus  svaret på GET_AUTH_STATUS
 * @param {() => void} opts.onRetry     kjøres når tilgangen er gitt eller fanen er lastet
 * @param {(message: string) => void} opts.onWait  viser ventetekst mens fanen lastes
 */
export function showAuthBanner({ statusEl, textEl, state, tabId, getStatus, onRetry, onWait }) {
  const info = describeAuthState(state);
  if (!info) return;
  const doc = statusEl.ownerDocument;

  statusEl.classList.add("status--login");
  const title = doc.createElement("strong");
  title.textContent = info.title;
  // Overskriften er en blokk i CSS-en, så teksten står på linjen under.
  textEl.replaceChildren(title, info.text);
  doc.getElementById("status-action")?.remove();

  let action;
  if (info.action.kind === "open") {
    action = doc.createElement("a");
    action.href = "https://app.dele.no";
    action.target = "_blank";
    action.rel = "noopener";
  } else {
    action = doc.createElement("button");
    action.type = "button";
    action.addEventListener("click", () =>
      info.action.kind === "permission"
        ? requestPermission(onRetry)
        : reloadTab(tabId, { getStatus, onRetry, onWait })
    );
  }
  action.id = "status-action";
  action.className = "btn btn--primary status__action";
  action.textContent = info.action.label;
  statusEl.appendChild(action);
  statusEl.hidden = false;
}

// permissions.request må kalles direkte i klikket, før noen await, ellers
// regner ikke Firefox det som en brukerhandling og avviser kallet.
// Tilgangsdialogen kan lukke popupen. Tilgangen gjelder likevel, og neste
// gang popupen åpnes, leses innloggingen.
function requestPermission(onRetry) {
  browserAPI.permissions
    .request({ origins: [DELE_ORIGIN] })
    .then((granted) => {
      if (granted) onRetry();
    })
    .catch((e) => console.error("[auth] permissions.request feilet:", e.message));
}

// Laster bare fanen brukeren ba om, og venter til content-scriptet har
// meldt innloggingen eller tiden er ute. Så avgjør onRetry hva som vises.
async function reloadTab(tabId, { getStatus, onRetry, onWait }) {
  onWait("Laster dele.no-fanen på nytt…");
  // background.js vet om fanen er lastet ut, og laster den riktig.
  const reply = await browserAPI.runtime
    .sendMessage({ type: "RELOAD_DELE_TAB", tabId })
    .catch((e) => ({ ok: false, error: e.message }));
  // Fanen kan være lukket imens. Da viser onRetry tilstanden slik den er nå.
  if (!reply?.ok) console.error("[auth] Ny lasting av fanen feilet:", reply?.error);
  const until = Date.now() + RELOAD_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_MS));
    const status = await getStatus().catch(() => null);
    if (status?.hasAuth) break;
  }
  onRetry();
}
