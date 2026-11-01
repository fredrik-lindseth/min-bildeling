import { browserAPI, storage } from "./lib/browser-polyfill.js";
import { AUTH_STATE, DELE_ORIGIN, chooseAuthState } from "./lib/auth-state.js";

// Background kjører ikke synken. Firefox avslutter MV3-event-pagen på idle,
// også midt i en lang synk, og da gikk alt i minnet tapt. Synken kjører i
// utvidelsessiden som ber om den (lib/sync.js via lib/sync-page.js). Her
// ligger bare innloggingen og lesing av lagrede data.
let currentAuth = null;

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Returner true KUN for meldinger som faktisk svarer async. Ellers tror
  // Firefox at vi venter på sendResponse og logger "went out of scope".
  if (message.type === "AUTH_TOKEN") {
    currentAuth = message.data;
    console.log("[BG] Auth token received");
    return false;
  }

  if (message.type === "GET_SYNC_AUTH") {
    getAuth().then(sendResponse);
    return true;
  }

  if (message.type === "CLEAR_AUTH") {
    currentAuth = null;
    return false;
  }

  if (message.type === "RELOAD_DELE_TAB") {
    // Bare etter brukerens klikk på «Last inn fanen på nytt» (lib/auth-banner.js).
    reloadDeleTab(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "GET_DATA") {
    storage.get(["reservations", "lastSync", "syncState"]).then(sendResponse);
    return true;
  }

  if (message.type === "GET_AUTH_STATUS") {
    // Probe aktivt: currentAuth er null etter bg-script-reload selv om
    // brukeren er innlogget. Svaret sier også hvorfor innloggingen mangler
    // (lib/auth-state.js), så sidene kan vise riktig handling.
    probeAuth().then(({ auth, state, tabId }) =>
      sendResponse({ hasAuth: auth !== null, state, tabId })
    );
    return true;
  }

  if (message.type === "DEBUG_DUMP") {
    storage.get(["reservations"]).then((data) => {
      const reservations = data.reservations || [];
      const sample = reservations.slice(0, 3);
      const keys = reservations.length > 0 ? Object.keys(reservations[0]) : [];
      sendResponse({ count: reservations.length, keys, sample });
    });
    return true;
  }

  // Andre meldinger har ingen response, viktig å returnere false.
  return false;
});

// Les innloggingen fra app.dele.no og si hvorfor den mangler, når den mangler.
// Content-scriptet spørres først. Svarer det ikke (fanen var åpen før
// utvidelsen ble lastet), leses localStorage med scripting.executeScript.
// En fane Firefox har lastet ut (discarded) har verken content-script eller
// en side å kjøre i, og executeScript gir bare «An unexpected error occurred».
// Den prøves derfor ikke, og brukeren får laste den inn på nytt i stedet.
async function probeAuth() {
  if (currentAuth) {
    console.log("[BG] getAuth: returning cached currentAuth");
    return { auth: currentAuth, state: AUTH_STATE.OK, tabId: null };
  }

  const hasPermission = await browserAPI.permissions
    .contains({ origins: [DELE_ORIGIN] })
    .catch(() => false);
  if (!hasPermission) {
    console.log("[BG] getAuth: host permission for app.dele.no is missing");
    return { auth: null, ...chooseAuthState({ hasPermission, tabs: [] }) };
  }

  const tabs = await browserAPI.tabs.query({ url: "https://app.dele.no/*" });
  console.log(`[BG] getAuth: found ${tabs.length} app.dele.no tab(s)`);
  // Lastede faner først, de er de eneste som kan svare.
  tabs.sort((a, b) => Number(Boolean(a.discarded)) - Number(Boolean(b.discarded)));

  const attempts = [];
  for (const tab of tabs) {
    const attempt = { id: tab.id, discarded: Boolean(tab.discarded), content: "failed", injected: "failed" };
    attempts.push(attempt);
    if (tab.discarded) {
      console.log(`[BG] getAuth: tab ${tab.id} is discarded, skipping`);
      attempt.content = attempt.injected = "skipped";
      continue;
    }
    console.log(`[BG] getAuth: trying tab ${tab.id}`);

    try {
      const response = await browserAPI.tabs.sendMessage(tab.id, { type: "GET_AUTH" });
      if (response && response.token) {
        console.log("[BG] getAuth: got auth via content script");
        currentAuth = response;
        return { auth: response, state: AUTH_STATE.OK, tabId: tab.id };
      }
      // content.js svarer null når innloggingen ikke finnes i localStorage.
      attempt.content = "empty";
      // Svaret kan inneholde membershipId, så bare feltnavnene logges.
      console.log("[BG] getAuth: content script returned", response ? Object.keys(response) : response);
    } catch (e) {
      console.log("[BG] getAuth: content script not loaded:", e.message);
    }

    const injected = await readAuthByScripting(tab.id);
    attempt.injected = injected.outcome;
    if (injected.auth) {
      console.log("[BG] getAuth: got auth via scripting");
      currentAuth = injected.auth;
      return { auth: injected.auth, state: AUTH_STATE.OK, tabId: tab.id };
    }
  }

  const choice = chooseAuthState({ hasPermission, tabs: attempts });
  console.log(`[BG] getAuth: no auth, state ${choice.state}`);
  return { auth: null, ...choice };
}

async function getAuth() {
  return (await probeAuth()).auth;
}

// tabs.reload på en utlastet fane gir en tom side i Firefox, og fanen
// forsvinner fra tabs.query på app.dele.no. Den lastes derfor med sin egen
// adresse. Bare app.dele.no-faner, siden id-en kommer fra en melding.
async function reloadDeleTab(tabId) {
  const tab = await browserAPI.tabs.get(tabId);
  if (!tab.url?.startsWith("https://app.dele.no/")) throw new Error("not an app.dele.no tab");
  if (tab.discarded) {
    await browserAPI.tabs.update(tabId, { url: tab.url });
  } else {
    await browserAPI.tabs.reload(tabId);
  }
}

// Inject direkte og les localStorage. Timeout etter 5 s: henger injeksjonen,
// gis fanen opp. outcome er "auth", "empty" (siden ble lest, innloggingen
// manglet) eller "failed" (fikk ikke kjørt i fanen).
async function readAuthByScripting(tabId) {
  try {
    const injectPromise = browserAPI.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const raw = localStorage.getItem("persist:data");
          if (!raw) return { error: "no persist:data key", keys: Object.keys(localStorage) };
          const parsed = JSON.parse(raw);
          if (!parsed.authentication) {
            return { error: "no authentication field", parsedKeys: Object.keys(parsed) };
          }
          if (!parsed.selectedMembership) {
            return { error: "no selectedMembership field", parsedKeys: Object.keys(parsed) };
          }
          const token = JSON.parse(parsed.authentication);
          const membership = JSON.parse(parsed.selectedMembership);
          return {
            token,
            membershipId: membership.id ?? membership,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    const results = await Promise.race([
      injectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("scripting.executeScript timeout")), 5000)
      ),
    ]);
    const result = results?.[0]?.result;
    if (result && result.token) return { outcome: "auth", auth: result };
    console.log("[BG] getAuth: injection result:", result?.error ?? (result ? Object.keys(result) : result));
    // Kjørte skriptet, ble siden lest. Uten resultat kjørte det ikke.
    return { outcome: result ? "empty" : "failed", auth: null };
  } catch (e) {
    console.warn("[BG] getAuth: injection failed for tab", tabId, e.message);
    return { outcome: "failed", auth: null };
  }
}
