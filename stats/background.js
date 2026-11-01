import { browserAPI, storage } from "./lib/browser-polyfill.js";

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

  if (message.type === "GET_DATA") {
    storage.get(["reservations", "lastSync"]).then(sendResponse);
    return true;
  }

  if (message.type === "GET_AUTH_STATUS") {
    // Probe aktivt: currentAuth er null etter bg-script-reload selv om
    // brukeren er innlogget. getAuth() spør content-scriptet i dele.no-fanen.
    getAuth().then((auth) => sendResponse({ hasAuth: auth !== null }));
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

async function getAuth() {
  if (currentAuth) {
    console.log("[BG] getAuth: returning cached currentAuth");
    return currentAuth;
  }

  const tabs = await browserAPI.tabs.query({ url: "https://app.dele.no/*" });
  console.log(`[BG] getAuth: found ${tabs.length} app.dele.no tab(s)`);
  if (tabs.length === 0) return null;

  // Prøv hver fane til vi finner auth (bruker kan ha flere åpne).
  for (const tab of tabs) {
    console.log(`[BG] getAuth: trying tab ${tab.id}`);

    // Først: prøv content-scriptet hvis det er lastet (raskt).
    try {
      const response = await browserAPI.tabs.sendMessage(tab.id, { type: "GET_AUTH" });
      if (response && response.token) {
        console.log("[BG] getAuth: got auth via content script");
        currentAuth = response;
        return response;
      }
      // Svaret kan inneholde membershipId, så bare feltnavnene logges.
      console.log("[BG] getAuth: content script returned", response ? Object.keys(response) : response);
    } catch (e) {
      console.log("[BG] getAuth: content script not loaded:", e.message);
    }

    // Inject direkte og les localStorage. Returnerer diagnose ved feil.
    // Timeout etter 5s. Hvis injection henger, gi opp og prøv neste fane.
    try {
      const injectPromise = browserAPI.scripting.executeScript({
        target: { tabId: tab.id },
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
      if (result && result.token) {
        // Resultatet inneholder tokenet, så det logges ikke.
        console.log("[BG] getAuth: got auth via scripting");
        currentAuth = result;
        return result;
      }
      console.log("[BG] getAuth: injection result:", result?.error ?? (result ? Object.keys(result) : result));
    } catch (e) {
      console.warn("[BG] getAuth: injection failed for tab", tab.id, e);
    }
  }

  return null;
}
