/**
 * Sikkerhetskopi: én JSON-fil med brukerdataene og eventuelt turene.
 *
 * Rene funksjoner uten storage og DOM. Dashbordet leser lageret, kaller
 * createBackup() eller parseBackup() og mergeBackup(), og skriver resultatet.
 * syncState, syncLock og syncHistory er aldri med: de beskriver en synk i
 * denne installasjonen og gir ingen mening i en annen.
 */

import {
  DEFAULT_CATEGORIES,
  LEGACY_CATEGORIES,
  CUSTOM_PREFIX,
  normalizeTripCategories,
  normalizeUserKeywords,
  normalizeCategorySettings,
  resolveCategories,
  resolveCategoryOrder,
} from "./categories.js";
import { TRANSPORT_MODES } from "./transport.js";

// Formatnavnet er fra før utvidelsen het Min bildeling. Det står i alle
// eksporterte filer, så det beholdes for at gamle kopier skal kunne leses.
export const BACKUP_FORMAT = "bildeleringen-stats-backup";
// Versjon 2 har categorySettings. Versjon 1 leses fortsatt, og gamle
// kategorinøkler i den flyttes til målet (LEGACY_CATEGORIES).
export const BACKUP_VERSION = 2;

/**
 * Bygg sikkerhetskopien. Turene og lastSync er valgfrie: de kan hentes fra
 * dele.no på nytt, men med dem slipper en ny installasjon en full synk.
 */
export function createBackup(data, { includeReservations = true, now = new Date() } = {}) {
  const categorySettings = normalizeCategorySettings(data.categorySettings);
  const categories = resolveCategories(categorySettings);
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    tripCategories: normalizeTripCategories(data.tripCategories ?? {}, categories).categories,
    transportData: normalizeTransportData(data.transportData).data,
    userKeywords: normalizeUserKeywords(data.userKeywords, categories),
    categorySettings,
  };
  if (includeReservations) {
    backup.reservations = Array.isArray(data.reservations) ? data.reservations : [];
    backup.lastSync = Number.isFinite(data.lastSync) ? data.lastSync : null;
  }
  return backup;
}

/**
 * Transporttall per år og transportmiddel. Ukjente år, transportmidler og
 * felt, negative tall og ukjente drivstoff hoppes over og telles.
 * Returns { data: { "2025": { taxi: {...} } }, skipped }.
 */
export function normalizeTransportData(raw) {
  const data = {};
  let skipped = 0;
  if (!isPlainObject(raw)) return { data, skipped };

  for (const [year, modes] of Object.entries(raw)) {
    if (!/^\d{4}$/.test(year) || !isPlainObject(modes)) {
      skipped++;
      continue;
    }
    for (const [mode, entry] of Object.entries(modes)) {
      const definition = TRANSPORT_MODES[mode];
      if (!definition || !isPlainObject(entry)) {
        skipped++;
        continue;
      }
      const clean = {};
      for (const [field, value] of Object.entries(entry)) {
        const spec = definition.fields.find((f) => f.key === field);
        if (spec && isValidFieldValue(spec, value)) clean[field] = value;
        else skipped++;
      }
      if (Object.keys(clean).length > 0) {
        data[year] ??= {};
        data[year][mode] = clean;
      }
    }
  }
  return { data, skipped };
}

function isValidFieldValue(spec, value) {
  if (spec.type === "select") return spec.options.some((o) => o.value === value);
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * En lagret tur må være et detaljsvar. Listeelementer mangler pris og bil og
 * ville gitt feil tall uten synlig feil (se docs/arkitektur.md).
 */
export function isStoredReservation(item) {
  return (
    isPlainObject(item) &&
    ((typeof item.id === "string" && item.id.trim() !== "") || Number.isFinite(item.id)) &&
    typeof item.start === "string" &&
    "price" in item &&
    "car" in item &&
    typeof item.location !== "string"
  );
}

/**
 * Les en fil. Godtar den samlede sikkerhetskopien og de eldre enkeltfilene:
 * kategorieksporten, nøkkelordeksporten og utviklerpanelets turkopi.
 *
 * Returns { error } med en norsk melding, eller
 * { backup: { tripCategories, transportData, userKeywords, categorySettings, reservations, lastSync },
 *   skipped: { categories, transport, reservations } }.
 * reservations og lastSync er null når filen ikke har turer.
 */
export function parseBackup(raw) {
  if (Array.isArray(raw)) return parseParts({ reservations: raw });
  if (!isPlainObject(raw)) return { error: "Filen er ikke en sikkerhetskopi." };

  if (raw.format === BACKUP_FORMAT) {
    if (!Number.isInteger(raw.version) || raw.version < 1) {
      return { error: "Sikkerhetskopien mangler versjon." };
    }
    if (raw.version > BACKUP_VERSION) {
      return { error: "Sikkerhetskopien er fra en nyere utgave. Oppdater utvidelsen først." };
    }
    return parseParts(raw);
  }
  const parts = ["tripCategories", "reservations", "transportData", "userKeywords", "categorySettings"];
  if (parts.some((key) => key in raw)) return parseParts(raw);
  // Den eldste nøkkelordeksporten er bare { kategori: [ord] }.
  if (Object.keys(raw).length > 0 && Object.keys(raw).every(isCategoryKey)) {
    return parseParts({ userKeywords: raw });
  }
  return { error: "Filen er ikke en sikkerhetskopi." };
}

function isCategoryKey(key) {
  return Object.hasOwn(DEFAULT_CATEGORIES, key) || Object.hasOwn(LEGACY_CATEGORIES, key) || key.startsWith(CUSTOM_PREFIX);
}

function parseParts(raw) {
  // Kategorivalg og ord for egne kategorier gjelder bare når filen har med
  // kategorien selv, så de valideres mot filens kategorier.
  const categorySettings = normalizeCategorySettings(raw.categorySettings);
  const fileCategories = resolveCategories(categorySettings);
  const { categories, skipped: skippedCategories } = normalizeTripCategories(raw.tripCategories ?? {}, fileCategories);
  const transport = normalizeTransportData(raw.transportData);
  const userKeywords = normalizeUserKeywords(raw.userKeywords, fileCategories);

  let reservations = null;
  let skippedReservations = 0;
  if (Array.isArray(raw.reservations)) {
    reservations = raw.reservations.filter(isStoredReservation);
    skippedReservations = raw.reservations.length - reservations.length;
    if (reservations.length === 0) reservations = null;
  }

  const backup = {
    tripCategories: categories,
    transportData: transport.data,
    userKeywords,
    categorySettings,
    reservations,
    lastSync: reservations && Number.isFinite(raw.lastSync) ? raw.lastSync : null,
  };
  const empty =
    Object.keys(categories).length === 0 &&
    Object.keys(transport.data).length === 0 &&
    Object.keys(userKeywords).length === 0 &&
    !hasSettings(categorySettings) &&
    reservations === null;
  if (empty) return { error: "Fant ingenting å importere i filen." };

  return {
    backup,
    skipped: { categories: skippedCategories, transport: transport.skipped, reservations: skippedReservations },
  };
}

/**
 * Flett en lest sikkerhetskopi inn i det som alt er lagret.
 *
 * Uten overwrite vinner det som er lagret her: kategorier og transporttall
 * legges bare til der de mangler, og nøkkelordene legges etter de lagrede.
 * Med overwrite vinner filen for det den har med: kategorivalg og transporttall
 * i filen erstatter de lagrede, og nøkkelordene i filen erstatter hele den
 * lagrede listen for samme kategori, så ord som bare står her, forsvinner.
 * Kategorier og år filen ikke har med, står. categorySettings flettes i
 * mergeSettings(), før kategorivalg og ord, så egne kategorier fra filen
 * finnes når valgene for dem legges inn.
 * Turene flettes alltid på id, og de lagrede beholdes, siden de kan være
 * hentet senere enn filen ble laget.
 *
 * Står en synk midt i køen (current.syncState med pendingIds), tas de
 * importerte id-ene ut av køen og av failed, så synken ikke henter detaljer som
 * nettopp kom fra filen. De telles som ferdige, så fremdriften stemmer.
 *
 * Returns { next, counts }. next har reservations og lastSync bare når filen
 * har turer, og syncState bare når køen ble endret, så lageret ellers ikke
 * skrives for dem.
 */
export function mergeBackup(current, incoming, { overwrite = false } = {}) {
  const counts = {
    categoriesAdded: 0,
    categoriesReplaced: 0,
    categoriesKept: 0,
    keywordsAdded: 0,
    transportAdded: 0,
    transportReplaced: 0,
    transportKept: 0,
    transportYears: 0,
    reservationsAdded: 0,
    reservationsKept: 0,
    customCategoriesAdded: 0,
    keywordsRemoved: 0,
  };

  const categorySettings = mergeSettings(current.categorySettings, incoming.categorySettings, overwrite, counts);
  const categories = resolveCategories(categorySettings);

  const tripCategories = { ...(current.tripCategories ?? {}) };
  for (const [id, key] of Object.entries(incoming.tripCategories)) {
    if (!(id in tripCategories)) {
      tripCategories[id] = key;
      counts.categoriesAdded++;
    } else if (tripCategories[id] === key) {
      continue;
    } else if (overwrite) {
      tripCategories[id] = key;
      counts.categoriesReplaced++;
    } else {
      counts.categoriesKept++;
    }
  }

  const userKeywords = normalizeUserKeywords(current.userKeywords, categories);
  for (const [key, words] of Object.entries(incoming.userKeywords)) {
    if (!Object.hasOwn(categories, key)) continue;
    const existing = userKeywords[key] ?? [];
    const fresh = words.filter((w) => !existing.includes(w));
    counts.keywordsAdded += fresh.length;
    userKeywords[key] = overwrite ? [...words] : [...existing, ...fresh];
  }

  const transportData = structuredClone(current.transportData ?? {});
  for (const [year, modes] of Object.entries(incoming.transportData)) {
    transportData[year] ??= {};
    let changed = false;
    for (const [mode, entry] of Object.entries(modes)) {
      const existing = transportData[year][mode];
      if (!existing || !hasNumbers(existing)) {
        transportData[year][mode] = { ...entry };
        counts.transportAdded++;
        changed = true;
      } else if (sameEntry(existing, entry)) {
        continue;
      } else if (overwrite) {
        transportData[year][mode] = { ...entry };
        counts.transportReplaced++;
        changed = true;
      } else {
        counts.transportKept++;
      }
    }
    if (changed) counts.transportYears++;
  }

  const next = {
    tripCategories,
    userKeywords,
    transportData,
    categorySettings: normalizeCategorySettings(categorySettings, userKeywords),
  };
  counts.keywordsRemoved = countNewRemoved(current.categorySettings, next.categorySettings);

  if (incoming.reservations) {
    const stored = Array.isArray(current.reservations) ? current.reservations : [];
    const known = new Set(stored.map((r) => String(r.id)));
    const added = incoming.reservations.filter((r) => !known.has(String(r.id)));
    counts.reservationsAdded = added.length;
    counts.reservationsKept = incoming.reservations.length - added.length;
    next.reservations = [...stored, ...added];
    // Synken bruker lastSync som hentetid for turer uten detailFetchedAt.
    // Uten den ville alle importerte turer blitt hentet på nytt.
    const times = [current.lastSync, incoming.lastSync].filter(Number.isFinite);
    next.lastSync = times.length > 0 ? Math.max(...times) : null;

    const syncState = withoutImported(current.syncState, added);
    if (syncState) next.syncState = syncState;
  }

  return { next, counts };
}

// Egne kategorier som mangler her, legges til, og med overwrite får de
// filens navn. Fjernede standardord slås sammen, eller tas fra filen for
// kategoriene den har med når den skal vinne. Rekkefølgen her står når den
// finnes, og resolveCategoryOrder() setter inn det som mangler.
function mergeSettings(currentRaw, incomingRaw, overwrite, counts) {
  const current = normalizeCategorySettings(currentRaw);
  const incoming = normalizeCategorySettings(incomingRaw);

  const custom = { ...current.custom };
  for (const [key, value] of Object.entries(incoming.custom)) {
    if (!custom[key]) {
      custom[key] = { ...value };
      counts.customCategoriesAdded++;
    } else if (overwrite) {
      custom[key] = { ...value };
    }
  }

  const removed = { ...current.removed };
  for (const [key, words] of Object.entries(incoming.removed)) {
    const existing = removed[key] ?? [];
    const fresh = words.filter((w) => !existing.includes(w));
    removed[key] = overwrite ? [...words] : [...existing, ...fresh];
  }

  const chosen = overwrite ? (incoming.order ?? current.order) : (current.order ?? incoming.order);
  // En ny egen kategori havner først, som når den lages her, så den vinner
  // til brukeren flytter den. Uten lagret rekkefølge gjør
  // resolveCategoryOrder() det selv.
  const added = Object.keys(incoming.custom).filter((key) => !current.custom[key]);
  const order = chosen ? [...added.filter((key) => !chosen.includes(key)), ...chosen] : null;
  const merged = { custom, removed, order };
  return { ...merged, order: order ? resolveCategoryOrder(merged) : null };
}

// Fjernede standardord som er nye etter importen. Telles etter at ord som
// også er egne ord, er tatt ut, så meldingen ikke melder dem.
function countNewRemoved(currentRaw, merged) {
  const before = normalizeCategorySettings(currentRaw).removed;
  let n = 0;
  for (const [key, words] of Object.entries(merged.removed)) {
    n += words.filter((w) => !(before[key] ?? []).includes(w)).length;
  }
  return n;
}

/**
 * Den delen av en lest fil som én av importknappene i «Nøkkelord og
 * kategorier» tar med. part er "categories" eller "keywords".
 *
 * «Importer kategorier» tar kategorivalgene og bare de egne kategoriene
 * valgene peker på, så en full sikkerhetskopi ikke drar med seg ord.
 * «Importer nøkkelord» tar ordene og hele categorySettings, men ingen valg.
 * Turer og transporttall hører til «Sikkerhetskopi» og er aldri med.
 * Returns en backup for mergeBackup(), eller null når delen er tom.
 */
export function importPart(backup, part) {
  const settings = normalizeCategorySettings(backup.categorySettings);
  const base = { tripCategories: {}, transportData: {}, userKeywords: {}, reservations: null, lastSync: null };
  let picked;
  if (part === "categories") {
    const used = new Set(Object.values(backup.tripCategories));
    const custom = Object.fromEntries(Object.entries(settings.custom).filter(([key]) => used.has(key)));
    picked = {
      ...base,
      tripCategories: { ...backup.tripCategories },
      categorySettings: { custom, removed: {}, order: null },
    };
  } else if (part === "keywords") {
    picked = { ...base, userKeywords: { ...backup.userKeywords }, categorySettings: settings };
  } else {
    throw new Error(`Unknown import part: ${part}`);
  }
  const empty =
    Object.keys(picked.tripCategories).length === 0 &&
    Object.keys(picked.userKeywords).length === 0 &&
    Object.keys(picked.categorySettings.custom).length === 0 &&
    Object.keys(picked.categorySettings.removed).length === 0;
  return empty ? null : picked;
}

function hasSettings(settings) {
  return Object.keys(settings.custom).length > 0 || Object.keys(settings.removed).length > 0 || settings.order !== null;
}

// Køen til en synk som står midt i, uten id-ene som nettopp ble importert.
// Lagrede turer som venter på oppdatering, står: importen erstatter dem ikke.
function withoutImported(syncState, added) {
  if (!isPlainObject(syncState) || added.length === 0) return null;
  const ids = new Set(added.map((r) => String(r.id)));
  const pendingIds = Array.isArray(syncState.pendingIds) ? syncState.pendingIds : [];
  const remaining = pendingIds.filter((id) => !ids.has(String(id)));
  const failed = { ...(syncState.failed ?? {}) };
  let failedRemoved = 0;
  for (const id of Object.keys(failed)) {
    if (ids.has(id)) {
      delete failed[id];
      failedRemoved++;
    }
  }
  const removed = pendingIds.length - remaining.length;
  if (removed === 0 && failedRemoved === 0) return null;
  return {
    ...syncState,
    pendingIds: remaining,
    failed,
    done: Math.min((syncState.done || 0) + removed, syncState.total || 0),
  };
}

/**
 * Norsk tekst for hva en import faktisk la til eller endret, ut fra counts
 * fra mergeBackup(). «Ingenting nytt» står bare når ingenting ble endret.
 */
export function describeImport(counts) {
  const parts = [];
  if (counts.reservationsAdded > 0) parts.push(count(counts.reservationsAdded, "tur", "turer"));
  if (counts.customCategoriesAdded > 0) {
    parts.push(count(counts.customCategoriesAdded, "egen kategori", "egne kategorier"));
  }
  const categories = counts.categoriesAdded + counts.categoriesReplaced;
  if (categories > 0) parts.push(count(categories, "kategorivalg", "kategorivalg"));
  if (counts.keywordsAdded > 0) parts.push(count(counts.keywordsAdded, "nøkkelord", "nøkkelord"));
  if (counts.keywordsRemoved > 0) {
    parts.push(count(counts.keywordsRemoved, "fjernet standardord", "fjernede standardord"));
  }
  if (counts.transportYears > 0) parts.push(`transporttall for ${count(counts.transportYears, "år", "år")}`);

  const kept = counts.categoriesKept + counts.transportKept;
  const keptText = kept === 1
    ? "1 verdi var ulik i filen, og den lagrede ble beholdt."
    : `${kept} verdier var ulike i filen, og de lagrede ble beholdt.`;
  if (parts.length === 0) {
    return kept > 0 ? `Ingenting nytt. ${keptText}` : "Ingenting nytt. Alt i filen var lagret fra før.";
  }
  const message = `Importerte ${parts.join(", ").replace(/, ([^,]*)$/, " og $1")}.`;
  return kept > 0 ? `${message} ${keptText}` : message;
}

function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Et skjema der feltene er tømt, lagres som { taxi: {} } og regnes som tomt.
function hasNumbers(entry) {
  return Object.values(entry).some((v) => typeof v === "number" && v > 0);
}

function sameEntry(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
