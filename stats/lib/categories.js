import { filterDriven } from "./stats.js";

export const CATEGORIES = {
  handletur:  { label: "Handletur" },
  helgetur:   { label: "Helgetur" },
  hyttetur:   { label: "Hyttetur" },
  besok:      { label: "Besøk" },
  transport:  { label: "Frakt/transport" },
  aktivitet:  { label: "Aktivitet" },
  helse:      { label: "Helse" },
  hoytid:     { label: "Høytid" },
  jobb:       { label: "Jobb" },
  flyplass:   { label: "Flyplass" },
  annet:      { label: "Annet" },
};

// Standardlisten skal treffe for hvem som helst i landet: kjeder, yrker,
// høytider og vanlige ord. Stedsnavn og ord som peker på én person eller
// familie hører hjemme i brukerens egne nøkkelord (storage: userKeywords).
//
// Rekkefølge er signifikant: suggestCategory() returnerer første treff.
// handletur står før hoytid så "juleshopping" havner i handletur, ikke høytid.
export const DEFAULT_KEYWORDS = {
  handletur: [
    "ikea", "obs", "coop", "rema", "kiwi", "biltema", "handel", "handle",
    "butikk", "bygg", "jula", "europris", "kjøpe", "shop", "kjøpesenter",
    "felleskjøp", "hagesenter", "hageshop", "hageland",
    "monter", "meny", "pakke på posten", "pakker på posten",
  ],
  helse: [
    "lege", "helsestasjon", "veterinær", "tannlege", "vaksine", "legesenter",
    "fysioterap", "barnelege", "dyrleg", "blodprøve",
    "poliklinikk", "helsesjekk", "passtime", "nytt pass",
  ],
  besok: ["besøk", "bursdag", "familie", "venner"],
  hyttetur: [
    "hytte", "hytta", "fjell", "hyttefelt", "naust", "sjøen", "øya",
  ],
  flyplass: ["flyplass", "fly", "airport", "lufthavn"],
  aktivitet: [
    "skøyte", "fotball", "trening", "svømme", "tur ", "ski", "klatring",
    "klatre", "buldr", "kino", "gokart", "padle", "sykkel",
  ],
  transport: [
    "hente", "levere", "frakt", "flytt", "dump", "avfall", "gjenbruk",
    "boss", "kaste", "pante", "returnere",
  ],
  jobb: ["jobb", "arbeid", "kontor", "møte", "kurs", "intervju", "visning", "kunde"],
  hoytid: [
    "jul", "17. mai", "konfirmasjon", "påske", "bryllup", "fastelav",
    "nyttår", "jonsok", "romjul", "navnefest", "dåp", "begravelse",
  ],
};

/**
 * Clean up user keywords from storage or an imported file.
 * Keeps only known category keys and non-blank strings, lowercased and
 * deduplicated. Edge spaces are kept, since a keyword like "tur " relies on
 * its trailing space to avoid matching "turné". Pure function.
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
 * Categories only the user has words for (e.g. helgetur) come last, in
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

/**
 * Auto-suggest a category based on the reservation's notes field.
 * `keywords` is an ordered map { categoryKey: [keyword, ...] }, normally
 * mergeKeywords(DEFAULT_KEYWORDS, userKeywords).
 * Returns a category key or null if no match is found.
 */
export function suggestCategory(reservation, keywords) {
  const notes = reservation?.notes;
  if (!notes || typeof notes !== "string") return null;

  const lower = notes.toLowerCase();

  for (const [category, words] of Object.entries(keywords)) {
    for (const keyword of words) {
      if (lower.includes(keyword)) {
        return category;
      }
    }
  }

  return null;
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
