import { filterDriven } from "./stats.js";

export const DEFAULT_CATEGORIES = {
  handletur:  { label: "Handletur" },
  helgetur:   { label: "Ferie og helgetur" },
  besok:      { label: "Besøk" },
  transport:  { label: "Frakt/transport" },
  aktivitet:  { label: "Aktivitet" },
  helse:      { label: "Helse" },
  hoytid:     { label: "Høytid" },
  jobb:       { label: "Jobb" },
  aerend:     { label: "Ærend" },
  annet:      { label: "Annet" },
};

// Kategorier som er slått inn i andre. Lagrede valg, egne ord og fjernede
// ord under de gamle nøklene flyttes til målet, så ingenting går tapt.
export const LEGACY_CATEGORIES = {
  flyplass: "transport",
  skyss: "transport",
  hyttetur: "aktivitet",
};

// Egne kategorier får nøkler med dette prefikset, så de aldri kolliderer med
// en standardkategori som kommer i en senere utgave.
export const CUSTOM_PREFIX = "egen-";

// Standardlisten skal treffe for hvem som helst i landet: kjeder, yrker,
// høytider og vanlige ord. Stedsnavn og ord som peker på én person eller
// familie hører hjemme i brukerens egne nøkkelord (storage: userKeywords).
//
// Et ord treffer i starten av et ord i notatet: «lege» treffer «legevakt»,
// men ikke «privilegert». Ender ordet på mellomrom, må hele ordet stå alene,
// så «fly » treffer «fly til Oslo», men ikke «flytting». Står det * først,
// treffer ordet også sist i et ord, med en bøyningsending etter
// (INFLECTION): «*besøk» treffer «bursdagsbesøket», men «*kurs» treffer ikke
// «ekskursjon». Det brukes bare for ord som ikke ligger gjemt i vanlige
// ord, ellers står sammensetningen for seg («hageavfall», «sommerferie»).
// Ord som likevel treffer feil, står i STOP_WORDS.
//
// Blandede notater: første kategori i listen med treff vinner, ikke det
// første ordet i notatet. Helse står først, siden et legebesøk sjelden er
// noe annet. Handletur står før Høytid, så «juleshopping» blir handletur.
// Flyplass og skyss ligger i Frakt/transport sammen med «hente» og
// «levere», så «Hente på flyplassen» får én kategori uansett hvilket ord som
// treffer. Transport står før Aktivitet, så «Hente ved til hytta» blir frakt
// og «Skyss til fotballkamp» transport. Hytteordene står sist i Aktivitet,
// etter Ferie og helgetur, så «Helg på hytta» blir helgetur. De vide
// sekkene (Jobb, Ærend) står sist.
export const DEFAULT_KEYWORDS = {
  helse: [
    "lege", "tannlege", "tannregulering", "helsestasjon", "veterinær",
    "dyrlege", "dyrelege", "fysioterap", "barnelege", "blodprøve", "vaksine",
    "poliklinikk", "sykehus", "røntgen", "mr ", "ultralyd", "*skopi",
    "operasjon", "kiropraktor", "optiker", "psykolog",
    "jordmor", "apotek", "helsesjekk", "passtime", "nytt pass",
  ],
  handletur: [
    "ikea", "obs ", "coop", "rema", "kiwi", "biltema", "handel", "handle",
    "butikk", "bygg ", "byggvare", "byggmakker", "byggmax", "jula ",
    "europris", "kjøp", "shop", "*shopping", "felleskjøp", "hagesenter",
    "hageshop", "hageland", "monter ", "meny ", "julehandel", "julegave",
    "loppemarked", "slakter", "vinmonopol", "pakke på posten",
    "pakker på posten",
  ],
  hoytid: [
    "jul", "17. mai", "konfirmasjon", "påske", "bryllup", "fastelav",
    "nyttår", "jonsok", "romjul", "navnefest", "dåp", "begravelse",
  ],
  besok: [
    "*besøk", "bursdag", "familie", "venner", "middag", "*dugnad",
    "selskap", "fest ",
  ],
  helgetur: [
    "ferie", "sommerferie", "høstferie", "vinterferie", "helg",
    "overnatting", "camping",
  ],
  transport: [
    "hente", "levere", "frakt", "flytt", "sofa", "møbler", "stillas",
    "dump ", "dumpe", "avfall", "hageavfall", "gjenbruk", "gjenvinning",
    "miljøstasjon", "boss", "søppel", "kaste", "pante", "returnere",
    "flyplass", "fly ", "flyet", "flytoget", "airport", "lufthavn",
    "skyss", "hente barn", "levere barn", "kjøre barn", "barnehage",
  ],
  aktivitet: [
    "skøyte", "fotball", "trening", "svømme", "bade", "tur ", "ski ",
    "skitur", "skisenter", "skiløyp", "alpint", "langrenn", "klatring",
    "klatre", "buldr", "*buldring", "kino", "gokart", "padle", "sykkel", "fiske",
    "konsert", "teater", "museum",
    "hytte", "hytta", "fjell", "hyttefelt", "naust", "sjøen", "øya",
  ],
  jobb: ["jobb", "arbeid", "kontor", "*møte", "*kurs", "intervju", "kunde"],
  aerend: [
    "ærend", "frisør", "verksted", "eu-kontroll", "dekkskift", "bilvask",
    "parkering",
  ],
};

// Rekkefølgen kategoriene prøves i når brukeren ikke har flyttet noe.
// Annet har ingen standardord og står sist.
export const DEFAULT_ORDER = [...Object.keys(DEFAULT_KEYWORDS), "annet"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCustomKey(key) {
  return typeof key === "string" && /^egen-[a-z0-9-]+$/.test(key);
}

function legacyTarget(key) {
  return Object.hasOwn(LEGACY_CATEGORIES, key) ? LEGACY_CATEGORIES[key] : key;
}

// Ikke-tomme strenger, små bokstaver, uten duplikater. Kantmellomrom står,
// siden mellomrom til slutt betyr helt ord.
function cleanWords(list) {
  const seen = new Set();
  for (const word of list) {
    if (typeof word !== "string" || word.trim() === "") continue;
    seen.add(word.toLowerCase());
  }
  return [...seen];
}

/**
 * Clean up categorySettings from storage or a file.
 * Returns { custom: { key: { label } }, removed: { key: [word] }, order }.
 * custom keeps only egen- keys with a label, removed only standard keys
 * (legacy keys are moved), order only known keys or null. Pure function.
 */
export function normalizeCategorySettings(raw) {
  const settings = { custom: {}, removed: {}, order: null };
  if (!isPlainObject(raw)) return settings;

  if (isPlainObject(raw.custom)) {
    for (const [key, value] of Object.entries(raw.custom)) {
      const label = typeof value?.label === "string" ? value.label.trim() : "";
      if (isCustomKey(key) && label !== "") settings.custom[key] = { label };
    }
  }

  if (isPlainObject(raw.removed)) {
    for (const [rawKey, words] of Object.entries(raw.removed)) {
      const key = legacyTarget(rawKey);
      if (!Object.hasOwn(DEFAULT_CATEGORIES, key) || !Array.isArray(words)) continue;
      const list = cleanWords([...(settings.removed[key] ?? []), ...words]);
      if (list.length > 0) settings.removed[key] = list;
    }
  }

  if (Array.isArray(raw.order)) {
    const known = (key) => Object.hasOwn(DEFAULT_CATEGORIES, key) || Object.hasOwn(settings.custom, key);
    const order = [...new Set(
      raw.order.filter((key) => typeof key === "string").map(legacyTarget).filter(known),
    )];
    if (order.length > 0) settings.order = order;
  }
  return settings;
}

/**
 * Key for a new custom category: egen- and a slug of the label, with -2, -3
 * on collision. The key stays when the category is renamed.
 */
export function customCategoryKey(label, existingKeys = []) {
  const slug = String(label ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = CUSTOM_PREFIX + (slug || "kategori");
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The order categories are tried in. Without a saved order, custom
 * categories come first, then DEFAULT_ORDER. With one, a standard category
 * missing from it (new in a later version) lands after its nearest
 * predecessor in DEFAULT_ORDER, and missing custom ones come last.
 */
export function resolveCategoryOrder(settings) {
  const { custom, order } = normalizeCategorySettings(settings);
  const customKeys = Object.keys(custom);
  if (!order) return [...customKeys, ...DEFAULT_ORDER];

  const result = [...order];
  DEFAULT_ORDER.forEach((key, i) => {
    if (result.includes(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const found = result.indexOf(DEFAULT_ORDER[j]);
      if (found !== -1) {
        at = found + 1;
        break;
      }
    }
    result.splice(at, 0, key);
  });
  for (const key of customKeys) {
    if (!result.includes(key)) result.push(key);
  }
  return result;
}

/**
 * All categories in match order: { key: { label, custom } }.
 */
export function resolveCategories(settings) {
  const normalized = normalizeCategorySettings(settings);
  const categories = {};
  for (const key of resolveCategoryOrder(normalized)) {
    categories[key] = normalized.custom[key]
      ? { label: normalized.custom[key].label, custom: true }
      : { label: DEFAULT_CATEGORIES[key].label, custom: false };
  }
  return categories;
}

/**
 * Clean up user keywords from storage or an imported file.
 * Keeps only keys in `categories` and non-blank strings, lowercased and
 * deduplicated. Words under a legacy key are moved to its target, after
 * the target's own words. Edge spaces are kept, since a trailing space
 * makes the keyword match whole words only ("fly " but not "flytting").
 * Pure function.
 */
export function normalizeUserKeywords(raw, categories = DEFAULT_CATEGORIES) {
  const result = {};
  if (!isPlainObject(raw)) return result;

  for (const key of Object.keys(categories)) {
    const sources = [key, ...Object.keys(LEGACY_CATEGORIES).filter((old) => LEGACY_CATEGORIES[old] === key)];
    const words = cleanWords(
      sources.flatMap((k) => (Object.hasOwn(raw, k) && Array.isArray(raw[k]) ? raw[k] : [])),
    );
    if (words.length > 0) result[key] = words;
  }
  return result;
}

/**
 * Parse a comma separated text field into a keyword list.
 * Entries are trimmed, so a trailing space cannot be typed here; the
 * editor adds it with «Bare som helt ord».
 */
export function parseKeywordInput(text) {
  if (typeof text !== "string") return [];
  return text.split(",").map((w) => w.trim()).filter(Boolean);
}

/**
 * Merge the default list with the user's own keywords and settings.
 * Category order comes from resolveCategoryOrder(), so first match wins in
 * the order the user sees. Within a category the user's words come first,
 * then the defaults the user has not removed. Categories without words are
 * included, so every category has a list. Pure function.
 */
export function mergeKeywords(defaults, userKeywords, settings = {}) {
  const normalized = normalizeCategorySettings(settings);
  const categories = resolveCategories(normalized);
  const user = normalizeUserKeywords(userKeywords, categories);
  const merged = {};

  for (const key of Object.keys(categories)) {
    const removed = new Set(normalized.removed[key] ?? []);
    const kept = (defaults[key] ?? []).filter((w) => !removed.has(w));
    merged[key] = [...new Set([...(user[key] ?? []), ...kept])];
  }
  return merged;
}

// Ord i notatet som aldri skal treffe noe nøkkelord, med alt som henger
// etter: «juli» er ikke «jul», og «konkurs» er ikke et kurs. Gjelder også
// brukerens egne nøkkelord.
export const STOP_WORDS = ["juli", "konkurs", "diskurs", "kursiv"];

// Bøyningsendelser et *-ord kan ha etter seg når det står sist i et ord.
const INFLECTION = "(?:e|en|et|er|ene|a|ar|ane|n|t|r|ne|s)?";

// Ett regulært uttrykk per nøkkelord, bygd én gang per flettet liste.
// WeakMap-en holder på listen bare så lenge kalleren gjør det.
const compiledCache = new WeakMap();

const LETTER_BEFORE = "(?<!\\p{L})";
const LETTER_AFTER = "(?!\\p{L})";
const STOP_PATTERN = new RegExp(
  `${LETTER_BEFORE}(?:${STOP_WORDS.join("|")})\\p{L}*`,
  "gu",
);

/**
 * Build the matcher for one keyword. It must start a word. A trailing space
 * means the word must also end there. A leading "*" also lets it end a word,
 * followed by at most an inflection ending. Exported for tests.
 */
export function keywordPattern(keyword) {
  const lower = keyword.toLowerCase();
  const wholeWord = /\s$/.test(lower);
  let core = lower.trim();
  const inCompound = core.startsWith("*");
  if (inCompound) core = core.slice(1);
  const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const atStart = LETTER_BEFORE + escaped + (wholeWord ? LETTER_AFTER : "");
  if (!inCompound) return new RegExp(atStart, "u");
  return new RegExp(`${atStart}|${escaped}${INFLECTION}${LETTER_AFTER}`, "u");
}

function compileKeywords(keywords) {
  let compiled = compiledCache.get(keywords);
  if (!compiled) {
    compiled = Object.entries(keywords).map(([category, words]) => [
      category,
      words.filter((w) => w.replace("*", "").trim() !== "").map((w) => [w, keywordPattern(w)]),
    ]);
    compiledCache.set(keywords, compiled);
  }
  return compiled;
}

/**
 * Find the category and the keyword that decides it for a note.
 * `keywords` is an ordered map { categoryKey: [keyword, ...] }, normally
 * mergeKeywords(DEFAULT_KEYWORDS, userKeywords). First category with a hit
 * wins, see the note on DEFAULT_KEYWORDS.
 * Returns { category, keyword } or null.
 */
export function matchKeyword(notes, keywords) {
  if (!notes || typeof notes !== "string") return null;
  const lower = notes.toLowerCase().replace(STOP_PATTERN, " ");

  for (const [category, patterns] of compileKeywords(keywords)) {
    for (const [keyword, pattern] of patterns) {
      if (pattern.test(lower)) return { category, keyword };
    }
  }
  return null;
}

/**
 * Auto-suggest a category based on the reservation's notes field.
 * Returns a category key or null if no match is found.
 */
export function suggestCategory(reservation, keywords) {
  return matchKeyword(reservation?.notes, keywords)?.category ?? null;
}

/**
 * Count how many driven trips with notes the keywords catch, using the same
 * first-match rule as suggestCategory(). Pure function.
 * Returns { total, matched, perCategory: { categoryKey: count },
 * perKeyword: { categoryKey: { keyword: count } } }.
 */
export function keywordHits(reservations, keywords) {
  const withNotes = filterDriven(reservations)
    .filter((r) => typeof r.notes === "string" && r.notes.trim() !== "");
  const perCategory = {};
  const perKeyword = {};
  let matched = 0;

  for (const r of withNotes) {
    const match = matchKeyword(r.notes, keywords);
    if (!match) continue;
    const { category, keyword } = match;
    matched++;
    perCategory[category] = (perCategory[category] || 0) + 1;
    perKeyword[category] ??= {};
    perKeyword[category][keyword] = (perKeyword[category][keyword] || 0) + 1;
  }

  return { total: withNotes.length, matched, perCategory, perKeyword };
}

// Kategorivalg under en gammel nøkkel peker på målet. Andre verdier står,
// også egne nøkler for kategorier som er slettet.
function migrateTripValues(source) {
  const result = {};
  let migrated = 0;
  for (const [id, key] of Object.entries(source)) {
    const target = typeof key === "string" ? legacyTarget(key) : key;
    if (target !== key) migrated++;
    result[id] = target;
  }
  return { result, migrated };
}

/**
 * Load saved trip categories from storage, with legacy keys moved to their
 * target. Choices for a deleted custom category are still here; filter
 * them with knownTripCategories().
 * Returns an object { reservationId: categoryKey }.
 */
export async function loadCategories(storage) {
  const { tripCategories } = await storage.get("tripCategories");
  return isPlainObject(tripCategories) ? migrateTripValues(tripCategories).result : {};
}

/**
 * Save a single trip category to storage.
 */
export async function saveCategory(storage, reservationId, categoryKey) {
  const existing = await loadCategories(storage);
  existing[reservationId] = categoryKey;
  await storage.set({ tripCategories: existing });
}

/**
 * Save many trip categories at once, on top of the saved ones.
 * `categoryMap` is { reservationId: categoryKey }.
 */
export async function saveCategories(storage, categoryMap) {
  const existing = await loadCategories(storage);
  await storage.set({ tripCategories: { ...existing, ...categoryMap } });
}

/**
 * Clean up trip categories from an imported file. Accepts the exported
 * shape { tripCategories: {...} } or the bare map. Keeps string ids with a
 * key in `categories`, moves legacy keys to their target and counts them as
 * migrated, and counts the rest as skipped, so a file from a newer version
 * with more categories still imports what it can. Pure function.
 * Returns { categories: { id: categoryKey }, skipped, migrated }.
 */
export function normalizeTripCategories(raw, categories = DEFAULT_CATEGORIES) {
  const source = isPlainObject(raw) ? (raw.tripCategories ?? raw) : null;
  const result = {};
  let skipped = 0;
  let migrated = 0;
  if (!isPlainObject(source)) return { categories: result, skipped, migrated };

  for (const [id, key] of Object.entries(source)) {
    const target = typeof key === "string" ? legacyTarget(key) : null;
    if (id.trim() !== "" && target && Object.hasOwn(categories, target)) {
      result[id] = target;
      if (target !== key) migrated++;
    } else {
      skipped++;
    }
  }
  return { categories: result, skipped, migrated };
}

/**
 * Only the choices that point at a category that exists. A choice for a
 * deleted custom category falls back to the suggestion or uncategorized.
 */
export function knownTripCategories(tripCategories, categories) {
  const result = {};
  if (!isPlainObject(tripCategories)) return result;
  for (const [id, key] of Object.entries(tripCategories)) {
    const target = typeof key === "string" ? legacyTarget(key) : null;
    if (target && Object.hasOwn(categories, target)) result[id] = target;
  }
  return result;
}

function cleanLabel(label) {
  return typeof label === "string" ? label.trim().replace(/\s+/g, " ") : "";
}

// Navn sammenlignes uten hensyn til store og små bokstaver, så «katt» og
// «Katt» ikke blir to kategorier som ser like ut i listen.
function labelTaken(categories, label, exceptKey = null) {
  const wanted = label.toLocaleLowerCase("nb");
  return Object.entries(categories).some(
    ([key, category]) => key !== exceptKey && category.label.toLocaleLowerCase("nb") === wanted,
  );
}

/**
 * Add a custom category with this label. It goes first in the order, so it
 * wins over the others until the user moves it.
 * Returns { settings, key } or { error } with a Norwegian message.
 */
export function addCustomCategory(settings, label) {
  const normalized = normalizeCategorySettings(settings);
  const name = cleanLabel(label);
  if (name === "") return { error: "Skriv et navn." };
  const categories = resolveCategories(normalized);
  if (labelTaken(categories, name)) return { error: "Navnet er alt i bruk." };

  const key = customCategoryKey(name, [...Object.keys(categories), ...Object.keys(LEGACY_CATEGORIES)]);
  return {
    key,
    settings: {
      ...normalized,
      custom: { ...normalized.custom, [key]: { label: name } },
      order: [key, ...resolveCategoryOrder(normalized)],
    },
  };
}

/**
 * Rename a custom category. The key stays, so choices and words follow.
 * Returns { settings } or { error }.
 */
export function renameCustomCategory(settings, key, label) {
  const normalized = normalizeCategorySettings(settings);
  if (!normalized.custom[key]) return { error: "Fant ikke kategorien." };
  const name = cleanLabel(label);
  if (name === "") return { error: "Skriv et navn." };
  if (labelTaken(resolveCategories(normalized), name, key)) return { error: "Navnet er alt i bruk." };
  return {
    settings: { ...normalized, custom: { ...normalized.custom, [key]: { label: name } } },
  };
}

/**
 * Delete a custom category with its words and the trip choices for it.
 * Returns { settings, userKeywords, tripCategories, trips }, where trips is
 * how many choices were removed.
 */
export function removeCustomCategory({ settings, userKeywords = {}, tripCategories = {} }, key) {
  const normalized = normalizeCategorySettings(settings);
  const custom = { ...normalized.custom };
  delete custom[key];
  const order = normalized.order ? normalized.order.filter((k) => k !== key) : null;

  const keywords = { ...userKeywords };
  delete keywords[key];

  const trips = {};
  let removed = 0;
  for (const [id, value] of Object.entries(tripCategories)) {
    if (value === key) removed++;
    else trips[id] = value;
  }
  return {
    settings: { ...normalized, custom, order: order && order.length > 0 ? order : null },
    userKeywords: keywords,
    tripCategories: trips,
    trips: removed,
  };
}

function withList(map, key, list) {
  const next = { ...map };
  if (list.length > 0) next[key] = list;
  else delete next[key];
  return next;
}

/**
 * Add a word to a category. A removed default word comes back instead of
 * being added again. Edge spaces are kept.
 * Returns { userKeywords, settings, changed, exists }, where exists means
 * the category already has the word.
 */
export function addKeyword({ userKeywords = {}, settings }, key, word) {
  const normalized = normalizeCategorySettings(settings);
  const unchanged = { userKeywords, settings: normalized, changed: false, exists: false };
  const w = typeof word === "string" ? word.toLowerCase() : "";
  if (w.replace("*", "").trim() === "") return unchanged;
  if (!Object.hasOwn(resolveCategories(normalized), key)) return unchanged;

  const removed = normalized.removed[key] ?? [];
  if (removed.includes(w)) {
    return {
      ...unchanged,
      settings: { ...normalized, removed: withList(normalized.removed, key, removed.filter((x) => x !== w)) },
      changed: true,
    };
  }
  if (mergeKeywords(DEFAULT_KEYWORDS, userKeywords, normalized)[key].includes(w)) {
    return { ...unchanged, exists: true };
  }
  return {
    ...unchanged,
    userKeywords: { ...userKeywords, [key]: [...(userKeywords[key] ?? []), w] },
    changed: true,
  };
}

/**
 * Remove a word from a category. Own words are deleted. Default words are
 * kept in settings.removed, so they can be taken back.
 * Returns { userKeywords, settings, changed }.
 */
export function removeKeyword({ userKeywords = {}, settings }, key, word) {
  const normalized = normalizeCategorySettings(settings);
  let nextUser = userKeywords;
  let nextSettings = normalized;
  let changed = false;

  const own = userKeywords[key] ?? [];
  if (own.includes(word)) {
    nextUser = withList(userKeywords, key, own.filter((w) => w !== word));
    changed = true;
  }
  const removed = normalized.removed[key] ?? [];
  if ((DEFAULT_KEYWORDS[key] ?? []).includes(word) && !removed.includes(word)) {
    nextSettings = { ...normalized, removed: { ...normalized.removed, [key]: [...removed, word] } };
    changed = true;
  }
  return { userKeywords: nextUser, settings: nextSettings, changed };
}

/**
 * Back to the default list for one category: own words go and removed
 * default words come back. Returns { userKeywords, settings, changed }.
 */
export function resetCategory({ userKeywords = {}, settings }, key) {
  const normalized = normalizeCategorySettings(settings);
  const changed = Object.hasOwn(userKeywords, key) || Object.hasOwn(normalized.removed, key);
  return {
    userKeywords: withList(userKeywords, key, []),
    settings: { ...normalized, removed: withList(normalized.removed, key, []) },
    changed,
  };
}

/**
 * Move a category one step up (delta -1) or down (+1) in match order. The
 * full order is saved from then on. Returns { settings, changed }.
 */
export function moveCategory(settings, key, delta) {
  const normalized = normalizeCategorySettings(settings);
  const order = resolveCategoryOrder(normalized);
  const from = order.indexOf(key);
  const to = from + delta;
  if (from === -1 || delta === 0 || to < 0 || to >= order.length) {
    return { settings: normalized, changed: false };
  }
  [order[from], order[to]] = [order[to], order[from]];
  return { settings: { ...normalized, order }, changed: true };
}

/**
 * What the user has changed in one category compared with the defaults.
 * Returns { added: [own words], removed: [removed default words] }.
 */
export function categoryChanges(key, userKeywords = {}, settings = {}) {
  const normalized = normalizeCategorySettings(settings);
  const defaults = DEFAULT_KEYWORDS[key] ?? [];
  return {
    added: (userKeywords[key] ?? []).filter((w) => !defaults.includes(w)),
    removed: normalized.removed[key] ?? [],
  };
}

/**
 * Load the user's own keywords from storage, normalized against the
 * categories that exist, custom ones included.
 * Returns { categoryKey: [keyword, ...] }.
 */
export async function loadUserKeywords(storage) {
  const { userKeywords } = await storage.get("userKeywords");
  const settings = await loadCategorySettings(storage);
  return normalizeUserKeywords(userKeywords, resolveCategories(settings));
}

/**
 * Save the user's own keywords. Only categories with words are kept.
 * Without `settings`, the saved categorySettings decide which custom
 * categories exist.
 */
export async function saveUserKeywords(storage, userKeywords, settings) {
  const current = settings ?? (await loadCategorySettings(storage));
  await storage.set({ userKeywords: normalizeUserKeywords(userKeywords, resolveCategories(current)) });
}

/** Load categorySettings from storage, normalized. */
export async function loadCategorySettings(storage) {
  const { categorySettings } = await storage.get("categorySettings");
  return normalizeCategorySettings(categorySettings);
}

/** Save categorySettings, normalized. */
export async function saveCategorySettings(storage, settings) {
  await storage.set({ categorySettings: normalizeCategorySettings(settings) });
}

/**
 * Move data saved under LEGACY_CATEGORIES keys to their targets: trip
 * choices, own words and settings. Writes only what changed, so a second
 * run does nothing. Returns { changed }.
 */
export async function migrateLegacyCategories(storage) {
  const data = await storage.get(["tripCategories", "userKeywords", "categorySettings"]);
  const next = {};

  if (isPlainObject(data.tripCategories)) {
    const { result, migrated } = migrateTripValues(data.tripCategories);
    if (migrated > 0) next.tripCategories = result;
  }

  if (isPlainObject(data.userKeywords)) {
    const legacy = Object.keys(data.userKeywords).filter((key) => Object.hasOwn(LEGACY_CATEGORIES, key));
    if (legacy.length > 0) {
      const words = { ...data.userKeywords };
      for (const old of legacy) {
        const target = LEGACY_CATEGORIES[old];
        const own = Array.isArray(words[target]) ? words[target] : [];
        const moved = Array.isArray(words[old]) ? words[old] : [];
        words[target] = cleanWords([...own, ...moved]);
        delete words[old];
      }
      next.userKeywords = words;
    }
  }

  if (data.categorySettings !== undefined) {
    const settings = normalizeCategorySettings(data.categorySettings);
    if (JSON.stringify(settings) !== JSON.stringify(data.categorySettings)) next.categorySettings = settings;
  }

  const changed = Object.keys(next).length > 0;
  if (changed) await storage.set(next);
  return { changed };
}

/**
 * Compute per-category statistics from reservations and a category map.
 * A key not in `categories` counts as uncategorized. Pure function.
 */
export function categoryStats(reservations, categoryMap, categories = DEFAULT_CATEGORIES) {
  const driven = filterDriven(reservations);
  const stats = {};

  for (const r of driven) {
    const chosen = categoryMap[r.id];
    const key = chosen && Object.hasOwn(categories, chosen) ? chosen : "uncategorized";
    if (!stats[key]) {
      stats[key] = {
        label: key === "uncategorized" ? "Ukategorisert" : categories[key].label,
        count: 0,
        totalCost: 0,
        totalKm: 0,
        avgCost: 0,
      };
    }

    stats[key].count++;
    stats[key].totalCost += r.price?.total ?? 0;
    stats[key].totalKm += r.drivenKm ?? 0;
  }

  for (const entry of Object.values(stats)) {
    entry.avgCost = entry.count > 0 ? Math.round(entry.totalCost / entry.count) : 0;
  }

  return stats;
}

/**
 * Batch auto-suggest categories for all uncategorized reservations.
 * `keywords` is the merged keyword map, see suggestCategory().
 * Returns a map { id: suggestedCategoryKey } only for reservations
 * where a suggestion was found.
 */
export function autoSuggestAll(reservations, existingCategories, keywords) {
  const suggestions = {};

  for (const r of reservations) {
    if (existingCategories[r.id]) continue;

    const suggestion = suggestCategory(r, keywords);
    if (suggestion) {
      suggestions[r.id] = suggestion;
    }
  }

  return suggestions;
}
