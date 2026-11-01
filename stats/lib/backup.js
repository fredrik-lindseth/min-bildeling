/**
 * Sikkerhetskopi: én JSON-fil med brukerdataene og eventuelt turene.
 *
 * Rene funksjoner uten storage og DOM. Dashbordet leser lageret, kaller
 * createBackup() eller parseBackup() og mergeBackup(), og skriver resultatet.
 * syncState, syncLock og syncHistory er aldri med: de beskriver en synk i
 * denne installasjonen og gir ingen mening i en annen.
 */

import { CATEGORIES, normalizeTripCategories, normalizeUserKeywords } from "./categories.js";
import { TRANSPORT_MODES } from "./transport.js";

export const BACKUP_FORMAT = "bildeleringen-stats-backup";
export const BACKUP_VERSION = 1;

/**
 * Bygg sikkerhetskopien. Turene og lastSync er valgfrie: de kan hentes fra
 * dele.no på nytt, men med dem slipper en ny installasjon en full synk.
 */
export function createBackup(data, { includeReservations = true, now = new Date() } = {}) {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    tripCategories: normalizeTripCategories(data.tripCategories ?? {}).categories,
    transportData: normalizeTransportData(data.transportData).data,
    userKeywords: normalizeUserKeywords(data.userKeywords),
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
 * { backup: { tripCategories, transportData, userKeywords, reservations, lastSync },
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
  if ("tripCategories" in raw || "reservations" in raw || "transportData" in raw || "userKeywords" in raw) {
    return parseParts(raw);
  }
  // Nøkkelordeksporten er bare { kategori: [ord] }.
  if (Object.keys(raw).length > 0 && Object.keys(raw).every((key) => Object.hasOwn(CATEGORIES, key))) {
    return parseParts({ userKeywords: raw });
  }
  return { error: "Filen er ikke en sikkerhetskopi." };
}

function parseParts(raw) {
  const { categories, skipped: skippedCategories } = normalizeTripCategories(raw.tripCategories ?? {});
  const transport = normalizeTransportData(raw.transportData);
  const userKeywords = normalizeUserKeywords(raw.userKeywords);

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
    reservations,
    lastSync: reservations && Number.isFinite(raw.lastSync) ? raw.lastSync : null,
  };
  const empty =
    Object.keys(categories).length === 0 &&
    Object.keys(transport.data).length === 0 &&
    Object.keys(userKeywords).length === 0 &&
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
 * Med overwrite vinner filen for det den har med, men ingenting slettes.
 * Turene flettes alltid på id, og de lagrede beholdes, siden de kan være
 * hentet senere enn filen ble laget.
 *
 * Returns { next, counts }. next har reservations og lastSync bare når filen
 * har turer, så lageret ellers ikke skrives for dem.
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
    reservationsAdded: 0,
    reservationsKept: 0,
  };

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

  const userKeywords = normalizeUserKeywords(current.userKeywords);
  for (const [key, words] of Object.entries(incoming.userKeywords)) {
    const existing = userKeywords[key] ?? [];
    const fresh = words.filter((w) => !existing.includes(w));
    counts.keywordsAdded += fresh.length;
    userKeywords[key] = overwrite ? [...words] : [...existing, ...fresh];
  }

  const transportData = structuredClone(current.transportData ?? {});
  for (const [year, modes] of Object.entries(incoming.transportData)) {
    transportData[year] ??= {};
    for (const [mode, entry] of Object.entries(modes)) {
      const existing = transportData[year][mode];
      if (!existing || !hasNumbers(existing)) {
        transportData[year][mode] = { ...entry };
        counts.transportAdded++;
      } else if (sameEntry(existing, entry)) {
        continue;
      } else if (overwrite) {
        transportData[year][mode] = { ...entry };
        counts.transportReplaced++;
      } else {
        counts.transportKept++;
      }
    }
  }

  const next = { tripCategories, userKeywords, transportData };

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
  }

  return { next, counts };
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
