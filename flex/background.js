import { browserAPI, storage } from "./lib/browser-polyfill.js";
import { searchAvailability, fetchLocations } from "./lib/search-api.js";
import { getWatches, setWatches, getSettings, saveSettings } from "./lib/storage.js";
import { detectHits, reconcile } from "./lib/watch.js";
import { parseLocalISO, toLocalISO } from "./lib/format.js";
import { originPatternFor } from "./lib/relay.js";

let currentAuth = null;

// Stabil id uten Math.random (unngår kollisjon innen samme ms).
let idSeq = 0;
function newId() {
  return `${Date.now()}-${idSeq++}`;
}

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATUS") {
    getAuth().then((auth) => sendResponse({ hasAuth: auth !== null }));
    return true;
  }
  if (message.type === "SEARCH") {
    handleSearch(message).then(sendResponse);
    return true;
  }
  if (message.type === "GET_LOCATIONS") {
    handleLocations().then(sendResponse);
    return true;
  }
  if (message.type === "GET_WATCHES") {
    Promise.all([getWatches(), getSettings()]).then(([watches, settings]) =>
      sendResponse({ watches, settings })
    );
    return true;
  }
  if (message.type === "ADD_WATCH") {
    getWatches().then((list) => {
      const w = { id: newId(), active: true, created: new Date().toISOString(),
                  lastChecked: null, notified: {}, ...message.watch };
      return setWatches([...list, w]);
    }).then((list) => sendResponse({ watches: list }));
    return true;
  }
  if (message.type === "TOGGLE_WATCH") {
    getWatches().then((list) =>
      setWatches(list.map((w) => w.id === message.id ? { ...w, active: !w.active } : w))
    ).then((list) => sendResponse({ watches: list }));
    return true;
  }
  if (message.type === "DELETE_WATCH") {
    getWatches().then((list) =>
      setWatches(list.filter((w) => w.id !== message.id))
    ).then((list) => sendResponse({ watches: list }));
    return true;
  }
  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then((settings) => {
      ensureAlarm();
      sendResponse({ settings });
    });
    return true;
  }
  if (message.type === "POLL_NOW") {
    pollWatches().then((r) => { dispatchAll(r.results); sendResponse(r); });
    return true;
  }
  return false;
});

export async function getAuth() {
  if (currentAuth) return currentAuth;
  const tabs = await browserAPI.tabs.query({ url: "*://app.dele.no/*" });
  if (tabs.length === 0) return null;
  for (const tab of tabs) {
    try {
      const res = await browserAPI.tabs.sendMessage(tab.id, { type: "GET_AUTH" });
      if (res && res.token) {
        currentAuth = res;
        return res;
      }
    } catch (e) {
      // content script ikke lastet, prøv injection
    }
    try {
      const results = await browserAPI.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const raw = localStorage.getItem("persist:data");
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return { token: JSON.parse(parsed.authentication) };
          } catch (e) {
            return null;
          }
        },
      });
      const result = results?.[0]?.result;
      if (result && result.token) {
        currentAuth = result;
        return result;
      }
    } catch (e) {
      console.warn("[bg] injection failed", tab.id, e);
    }
  }
  return null;
}

async function handleSearch({ point, start, end }) {
  const auth = await getAuth();
  if (!auth) return { error: "NOT_LOGGED_IN" };
  try {
    const result = await searchAvailability(point, new Date(start), new Date(end), auth.token);
    return { result };
  } catch (e) {
    if (e.message === "AUTH_EXPIRED") {
      currentAuth = null;
      return { error: "AUTH_EXPIRED" };
    }
    return { error: e.message };
  }
}

async function handleLocations() {
  const auth = await getAuth();
  if (!auth) return { error: "NOT_LOGGED_IN" };
  try {
    return { locations: await fetchLocations(auth.token) };
  } catch (e) {
    if (e.message === "AUTH_EXPIRED") {
      currentAuth = null;
      return { error: "AUTH_EXPIRED" };
    }
    return { error: e.message };
  }
}

async function getToken() {
  const { authToken } = await storage.get("authToken");
  if (authToken && authToken.token) return authToken.token;
  const auth = await getAuth(); // eksisterende pull (spør åpne dele.no-faner)
  return auth ? auth.token : null;
}

async function pollWatches() {
  const now = new Date();
  const settings = await getSettings();
  let watches = await getWatches();

  // Utløp: marker watches der latestEnd er passert.
  watches = watches.map((w) =>
    parseLocalISO(w.latestEnd) <= now ? { ...w, active: false } : w);

  const token = await getToken();
  const results = [];
  if (!token) {
    await setWatches(watches);
    console.log("[bg] pollWatches: ingen token, hopper over");
    return { results, noAuth: true };
  }

  for (let i = 0; i < watches.length; i++) {
    const w = watches[i];
    if (!w.active || parseLocalISO(w.latestEnd) <= now) continue;
    const start = new Date(Math.max(parseLocalISO(w.earliestStart).getTime(), now.getTime()));
    const end = parseLocalISO(w.latestEnd);
    let result;
    try {
      result = await searchAvailability(w.point, start, end, token);
    } catch (e) {
      if (e.message === "AUTH_EXPIRED") {
        await storage.set({ authToken: null });
        currentAuth = null;
        console.log("[bg] pollWatches: 401, token tømt");
        break;
      }
      console.warn("[bg] pollWatches søkefeil:", e.message);
      continue;
    }
    const hits = detectHits(result, w, { start, end });
    const rec = reconcile(hits, w.notified, now);
    watches[i] = { ...w, notified: rec.notified, lastChecked: now.toISOString() };
    results.push({ watchLabel: w.label, watch: watches[i], settings,
                   browserHits: rec.browserHits, relayHits: rec.relayHits });
  }
  await setWatches(watches);
  return { results, noAuth: false };
}

async function ensureAlarm() {
  const { pollMinutes } = await getSettings();
  browserAPI.alarms.create("watch-poll", { periodInMinutes: pollMinutes || 15 });
}

browserAPI.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "watch-poll") pollWatches().then((r) => dispatchAll(r.results));
});
ensureAlarm();

function summaryText(watch, hits) {
  if (hits.length === 1) {
    const h = hits[0];
    return `${h.model} #${h.carNumber} ledig ${Math.round(h.blockHours)} t ved ${h.location.name}`;
  }
  return `${hits.length} biler ledige minst ${watch.minHours} t ved ${watch.placeName}`;
}

function toPayloadHit(h) {
  const start = toLocalISO(h.blockStart);
  const end = toLocalISO(h.blockEnd);
  return {
    car: { model: h.model, number: h.carNumber, location: h.location.name, distanceM: h.location.distance },
    free: { start, end, hours: Math.round(h.blockHours) },
    // Tider urørt, ingen URL-enkoding (se docs/api/README.md).
    deepLink: `https://app.dele.no/findcar?start=${start}&end=${end}`,
  };
}

async function relay(settings, watch, relayHits) {
  // Uten innvilget tilgang ville fetch-en feilet på CORS. Kast, så treffet
  // står som ikke relayet og prøves igjen når tilgangen er gitt.
  const pattern = originPatternFor(settings.backendUrl);
  if (!pattern || !(await browserAPI.permissions.contains({ origins: [pattern] }))) {
    throw new Error("mangler tilgang til backend-URL, gi den på innstillingssiden");
  }
  const res = await fetch(`${settings.backendUrl}/api/notify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${settings.backendToken}` },
    body: JSON.stringify({
      watchLabel: watch.label, place: watch.placeName,
      hits: relayHits.map(toPayloadHit),
    }),
  });
  if (!res.ok) throw new Error(`relay ${res.status}`);
}

async function dispatchAll(results) {
  let watches = await getWatches();
  for (const r of results) {
    if (r.browserHits.length) {
      browserAPI.notifications.create(`watch-${r.watch.id}-${Date.now()}`, {
        type: "basic",
        iconUrl: browserAPI.runtime.getURL("icons/icon-48.png"),
        title: "Bildeleringen: bil ledig",
        message: summaryText(r.watch, r.browserHits),
      });
    }
    if (r.relayHits.length && r.settings.backendUrl && r.settings.backendToken) {
      try {
        await relay(r.settings, r.watch, r.relayHits);
        // Merk relaykede nøkler relayed=true i den ferske lista.
        watches = watches.map((w) => {
          if (w.id !== r.watch.id) return w;
          const notified = { ...w.notified };
          for (const h of r.relayHits) {
            const key = `${h.carId}|${toLocalISO(h.blockEnd)}`;
            if (notified[key]) notified[key] = { ...notified[key], relayed: true };
          }
          return { ...w, notified };
        });
      } catch (e) {
        console.warn("[bg] relay feilet, retry neste runde:", e.message);
      }
    }
  }
  await setWatches(watches);
}
