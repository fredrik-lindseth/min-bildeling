import { storage } from "./browser-polyfill.js";

// Ingen innebygde steder. Koden er offentlig, så brukerens egne steder
// (hjem og lignende) bor bare i storage. Finderen tilbyr stasjoner fra
// /api/locations og geolokasjon når ingenting er lagret.
export const DEFAULT_PLACES = [];

const PLACES_KEY = "places";
const FAV_KEY = "favoriteCarIds";

// Ren funksjon: lagrede steder overstyrer default på samme id, resten beholdes.
export function mergePlaces(defaults, saved) {
  const byId = new Map(defaults.map((p) => [p.id, p]));
  for (const p of saved) byId.set(p.id, p);
  return [...byId.values()];
}

export async function getPlaces() {
  const { [PLACES_KEY]: saved } = await storage.get(PLACES_KEY);
  return mergePlaces(DEFAULT_PLACES, saved || []);
}

export async function savePlace(place) {
  const { [PLACES_KEY]: saved } = await storage.get(PLACES_KEY);
  const next = mergePlaces(saved || [], [place]);
  await storage.set({ [PLACES_KEY]: next });
  return next;
}

export async function getFavoriteCarIds() {
  const { [FAV_KEY]: ids } = await storage.get(FAV_KEY);
  return ids || [];
}

export async function saveFavoriteCarIds(ids) {
  await storage.set({ [FAV_KEY]: ids });
}

const WATCHES_KEY = "watches";
const SETTINGS_KEY = "notifySettings"; // { backendUrl, backendToken, pollMinutes }

export async function getWatches() {
  const { [WATCHES_KEY]: w } = await storage.get(WATCHES_KEY);
  return w || [];
}

export async function setWatches(list) {
  await storage.set({ [WATCHES_KEY]: list });
  return list;
}

export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await storage.get(SETTINGS_KEY);
  return { backendUrl: "", backendToken: "", pollMinutes: 15, ...(s || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}
