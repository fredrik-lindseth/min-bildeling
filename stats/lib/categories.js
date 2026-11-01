import { filterDriven } from "./stats.js";

export const CATEGORIES = {
  handletur:  { label: "Handletur" },
  helgetur:   { label: "Ferie og helgetur" },
  hyttetur:   { label: "Hyttetur" },
  besok:      { label: "Besøk" },
  transport:  { label: "Frakt/transport" },
  aktivitet:  { label: "Aktivitet" },
  helse:      { label: "Helse" },
  hoytid:     { label: "Høytid" },
  jobb:       { label: "Jobb" },
  flyplass:   { label: "Flyplass" },
  aerend:     { label: "Ærend" },
  skyss:      { label: "Skyss" },
  annet:      { label: "Annet" },
};

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
// første ordet i notatet. Tidligste treff lar vanlige verb som «hente»,
// «levere» og «handle» bestemme («Hente på flyplassen» ble frakt). Derfor står
// kategoriene med et tydelig formål først (Helse, Flyplass, Skyss), så
// Handletur før Høytid for at «juleshopping» blir handletur, og de vide
// sekkene (Frakt, Aktivitet, Jobb, Ærend) sist.
export const DEFAULT_KEYWORDS = {
  helse: [
    "lege", "tannlege", "tannregulering", "helsestasjon", "veterinær",
    "dyrlege", "dyrelege", "fysioterap", "barnelege", "blodprøve", "vaksine",
    "poliklinikk", "sykehus", "røntgen", "mr ", "ultralyd", "*skopi",
    "operasjon", "kiropraktor", "optiker", "psykolog",
    "jordmor", "apotek", "helsesjekk", "passtime", "nytt pass",
  ],
  flyplass: ["flyplass", "fly ", "flyet", "flytoget", "airport", "lufthavn"],
  skyss: [
    "skyss", "hente barn", "levere barn", "kjøre barn", "barnehage",
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
  hyttetur: [
    "hytte", "hytta", "fjell", "hyttefelt", "naust", "sjøen", "øya",
  ],
  helgetur: [
    "ferie", "sommerferie", "høstferie", "vinterferie", "helg",
    "overnatting", "camping",
  ],
  transport: [
    "hente", "levere", "frakt", "flytt", "sofa", "møbler", "stillas",
    "dump ", "dumpe", "avfall", "hageavfall", "gjenbruk", "gjenvinning",
    "miljøstasjon", "boss", "kaste", "pante", "returnere",
  ],
  aktivitet: [
    "skøyte", "fotball", "trening", "svømme", "bade", "tur ", "ski ",
    "skitur", "skisenter", "skiløyp", "alpint", "langrenn", "klatring",
    "klatre", "buldr", "*buldring", "kino", "gokart", "padle", "sykkel", "fiske",
    "konsert", "teater", "museum",
  ],
  jobb: ["jobb", "arbeid", "kontor", "*møte", "*kurs", "intervju", "kunde"],
  aerend: [
    "ærend", "frisør", "verksted", "eu-kontroll", "dekkskift", "bilvask",
    "parkering",
  ],
};

/**
 * Clean up user keywords from storage or an imported file.
 * Keeps only known category keys and non-blank strings, lowercased and
 * deduplicated. Edge spaces are kept, since a trailing space makes the
 * keyword match whole words only ("fly " but not "flytting"). Pure function.
 */
export function normalizeUserKeywords(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;

  for (const key of Object.keys(CATEGORIES)) {
    const list = raw[key];
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    for (const word of list) {
      if (typeof word !== "string" || word.trim() === "") continue;
      seen.add(word.toLowerCase());
    }
    if (seen.size > 0) result[key] = [...seen];
  }
  return result;
}

/**
 * Parse a comma separated text field into a keyword list.
 * Entries are trimmed, so a trailing space cannot be typed here; use JSON
 * import for that.
 */
export function parseKeywordInput(text) {
  if (typeof text !== "string") return [];
  return text.split(",").map((w) => w.trim()).filter(Boolean);
}

/**
 * Merge the default list with the user's own keywords.
 * Category order follows `defaults`, so first match wins exactly as before.
 * Categories only the user has words for (e.g. annet) come last, in
 * CATEGORIES order. Within a category the user's words come first.
 * Pure function.
 */
export function mergeKeywords(defaults, userKeywords) {
  const user = normalizeUserKeywords(userKeywords);
  const merged = {};

  for (const [key, words] of Object.entries(defaults)) {
    merged[key] = [...new Set([...(user[key] || []), ...words])];
  }
  for (const key of Object.keys(CATEGORIES)) {
    if (!merged[key] && user[key]) merged[key] = user[key];
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
 * Returns { total, matched, perCategory: { categoryKey: count } }.
 */
export function keywordHits(reservations, keywords) {
  const withNotes = filterDriven(reservations)
    .filter((r) => typeof r.notes === "string" && r.notes.trim() !== "");
  const perCategory = {};
  let matched = 0;

  for (const r of withNotes) {
    const category = suggestCategory(r, keywords);
    if (!category) continue;
    matched++;
    perCategory[category] = (perCategory[category] || 0) + 1;
  }

  return { total: withNotes.length, matched, perCategory };
}

/**
 * Load saved trip categories from storage.
 * Returns an object { reservationId: categoryKey }.
 */
export async function loadCategories(storage) {
  const result = await storage.get("tripCategories");
  return result.tripCategories || {};
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
 * known category key and counts the rest as skipped, so a file from a newer
 * version with more categories still imports what it can. Pure function.
 * Returns { categories: { id: categoryKey }, skipped }.
 */
export function normalizeTripCategories(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw.tripCategories ?? raw)
    : null;
  const categories = {};
  let skipped = 0;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { categories, skipped };
  }

  for (const [id, key] of Object.entries(source)) {
    if (id.trim() !== "" && typeof key === "string" && Object.hasOwn(CATEGORIES, key)) {
      categories[id] = key;
    } else {
      skipped++;
    }
  }
  return { categories, skipped };
}

/**
 * Load the user's own keywords from storage, normalized.
 * Returns { categoryKey: [keyword, ...] }.
 */
export async function loadUserKeywords(storage) {
  const result = await storage.get("userKeywords");
  return normalizeUserKeywords(result.userKeywords);
}

/**
 * Save the user's own keywords. Only categories with words are kept.
 */
export async function saveUserKeywords(storage, userKeywords) {
  await storage.set({ userKeywords: normalizeUserKeywords(userKeywords) });
}

/**
 * Compute per-category statistics from reservations and a category map.
 * Pure function, no side effects.
 */
export function categoryStats(reservations, categoryMap) {
  const driven = filterDriven(reservations);
  const stats = {};

  for (const r of driven) {
    const key = categoryMap[r.id] || "uncategorized";
    if (!stats[key]) {
      const cat = CATEGORIES[key];
      stats[key] = {
        label: cat ? cat.label : "Ukategorisert",
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

  // Compute averages
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
