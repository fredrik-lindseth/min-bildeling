import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  mergeBackup,
  describeImport,
  normalizeTransportData,
  isStoredReservation,
} from "../lib/backup.js";

function trip(id, extra = {}) {
  return { id, start: "2025-03-01T10:00:00", price: { total: 100 }, car: { model: "Testbil" }, ...extra };
}

const USER = {
  tripCategories: { a: "jobb", b: "handletur" },
  transportData: { 2025: { taxi: { trips: 3, totalKm: 40, totalCost: 900 } } },
  userKeywords: { jobb: ["kontor"] },
};

test("createBackup har format, versjon og alle brukerdata", () => {
  const backup = createBackup(
    { ...USER, reservations: [trip("a")], lastSync: 1000, syncState: { phase: "idle" }, syncLock: { owner: "x" } },
    { now: new Date("2026-11-01T12:00:00Z") },
  );
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.exportedAt, "2026-11-01T12:00:00.000Z");
  assert.deepEqual(backup.tripCategories, USER.tripCategories);
  assert.deepEqual(backup.transportData, { 2025: USER.transportData[2025] });
  assert.deepEqual(backup.userKeywords, USER.userKeywords);
  assert.equal(backup.reservations.length, 1);
  assert.equal(backup.lastSync, 1000);
  assert.ok(!("syncState" in backup));
  assert.ok(!("syncLock" in backup));
});

test("createBackup uten turer har verken reservations eller lastSync", () => {
  const backup = createBackup({ ...USER, reservations: [trip("a")], lastSync: 1000 }, { includeReservations: false });
  assert.ok(!("reservations" in backup));
  assert.ok(!("lastSync" in backup));
});

test("createBackup tåler tomt lager", () => {
  const backup = createBackup({});
  assert.deepEqual(backup.tripCategories, {});
  assert.deepEqual(backup.transportData, {});
  assert.deepEqual(backup.userKeywords, {});
  assert.deepEqual(backup.reservations, []);
  assert.equal(backup.lastSync, null);
});

test("parseBackup leser det createBackup skriver, også gjennom JSON", () => {
  const written = createBackup({ ...USER, reservations: [trip("a"), trip("b")], lastSync: 1000 });
  const { backup, skipped, error } = parseBackup(JSON.parse(JSON.stringify(written)));
  assert.equal(error, undefined);
  assert.deepEqual(backup.tripCategories, USER.tripCategories);
  assert.deepEqual(backup.transportData, { 2025: USER.transportData[2025] });
  assert.deepEqual(backup.userKeywords, USER.userKeywords);
  assert.equal(backup.reservations.length, 2);
  assert.equal(backup.lastSync, 1000);
  assert.deepEqual(skipped, { categories: 0, transport: 0, reservations: 0 });
});

test("parseBackup avviser nyere versjon, manglende versjon og annen JSON", () => {
  assert.match(parseBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }).error, /nyere utgave/);
  assert.match(parseBackup({ format: BACKUP_FORMAT }).error, /versjon/);
  assert.match(parseBackup({ format: BACKUP_FORMAT, version: "1" }).error, /versjon/);
  assert.ok(parseBackup(null).error);
  assert.ok(parseBackup("tekst").error);
  assert.ok(parseBackup({ hei: 1 }).error);
  assert.ok(parseBackup({}).error);
});

test("parseBackup avviser en kopi uten noe innhold", () => {
  const { error } = parseBackup(createBackup({}, { includeReservations: true }));
  assert.match(error, /ingenting/);
});

test("parseBackup hopper over ugyldige deler og teller dem", () => {
  const { backup, skipped } = parseBackup({
    format: BACKUP_FORMAT,
    version: 1,
    tripCategories: { a: "jobb", b: "finnesikke", c: 7 },
    transportData: {
      2025: { taxi: { trips: 2, totalCost: -5, ukjent: 1 }, romskip: { trips: 1 } },
      neste: { taxi: { trips: 1 } },
      2024: { egenbil: { fuelType: "elbil", totalKm: 100 }, leiebil: { days: "tre" } },
    },
    userKeywords: { jobb: ["Kontor", "kontor", ""], finnesikke: ["x"] },
    reservations: [trip("a"), { id: "liste", start: "2025-01-01", location: "Sentrum" }, "tull"],
    lastSync: 5,
  });
  assert.deepEqual(backup.tripCategories, { a: "jobb" });
  assert.equal(skipped.categories, 2);
  assert.deepEqual(backup.transportData, {
    2025: { taxi: { trips: 2 } },
    2024: { egenbil: { fuelType: "elbil", totalKm: 100 } },
  });
  // totalCost, ukjent, romskip, neste og days
  assert.equal(skipped.transport, 5);
  assert.deepEqual(backup.userKeywords, { jobb: ["kontor"] });
  assert.deepEqual(backup.reservations.map((r) => r.id), ["a"]);
  assert.equal(skipped.reservations, 2);
  assert.equal(backup.lastSync, 5);
});

test("parseBackup gir null for turer når ingen er gyldige, og dropper da lastSync", () => {
  const { backup } = parseBackup({ tripCategories: { a: "jobb" }, reservations: [{ id: 1 }], lastSync: 5 });
  assert.equal(backup.reservations, null);
  assert.equal(backup.lastSync, null);
});

test("parseBackup godtar de eldre enkeltfilene", () => {
  assert.deepEqual(parseBackup({ tripCategories: { a: "jobb" } }).backup.tripCategories, { a: "jobb" });
  assert.deepEqual(parseBackup({ jobb: ["kontor"], helse: ["lege"] }).backup.userKeywords, {
    jobb: ["kontor"],
    helse: ["lege"],
  });
  const dev = parseBackup({ exportedAt: "2026-01-01", reservations: [trip("a")], lastSync: 9 }).backup;
  assert.equal(dev.reservations.length, 1);
  assert.equal(dev.lastSync, 9);
  assert.equal(parseBackup([trip("a")]).backup.reservations.length, 1);
});

test("isStoredReservation skiller detaljsvar fra listeelementer", () => {
  assert.ok(isStoredReservation(trip("a")));
  assert.ok(isStoredReservation(trip(12)));
  assert.ok(isStoredReservation(trip("a", { price: null })));
  assert.ok(!isStoredReservation({ id: "a", start: "2025-01-01", location: "Sentrum" }));
  assert.ok(!isStoredReservation(trip("a", { location: "Sentrum" })));
  assert.ok(!isStoredReservation(trip("")));
  assert.ok(!isStoredReservation(trip("a", { start: 5 })));
  assert.ok(!isStoredReservation(null));
});

test("normalizeTransportData tåler tull", () => {
  assert.deepEqual(normalizeTransportData(undefined), { data: {}, skipped: 0 });
  assert.deepEqual(normalizeTransportData([1, 2]), { data: {}, skipped: 0 });
  assert.deepEqual(normalizeTransportData({ 2025: { taxi: { trips: Number.NaN } } }), { data: {}, skipped: 1 });
});

function incoming(parts) {
  return { tripCategories: {}, transportData: {}, userKeywords: {}, reservations: null, lastSync: null, ...parts };
}

test("mergeBackup legger til uten å overskrive det som er lagret", () => {
  const current = {
    tripCategories: { a: "jobb" },
    userKeywords: { jobb: ["kontor"] },
    transportData: { 2025: { taxi: { trips: 3 } } },
  };
  const { next, counts } = mergeBackup(current, incoming({
    tripCategories: { a: "helse", b: "handletur" },
    userKeywords: { jobb: ["møte", "kontor"], helse: ["lege"] },
    transportData: { 2025: { taxi: { trips: 9 }, buss: { trips: 100 } }, 2024: { fly: { trips: 2 } } },
  }));
  assert.deepEqual(next.tripCategories, { a: "jobb", b: "handletur" });
  assert.deepEqual(next.userKeywords, { jobb: ["kontor", "møte"], helse: ["lege"] });
  assert.deepEqual(next.transportData, {
    2025: { taxi: { trips: 3 }, buss: { trips: 100 } },
    2024: { fly: { trips: 2 } },
  });
  assert.equal(counts.categoriesAdded, 1);
  assert.equal(counts.categoriesKept, 1);
  assert.equal(counts.categoriesReplaced, 0);
  assert.equal(counts.keywordsAdded, 2);
  assert.equal(counts.transportAdded, 2);
  assert.equal(counts.transportKept, 1);
  assert.ok(!("reservations" in next));
  assert.ok(!("lastSync" in next));
});

test("mergeBackup med overwrite lar filen vinne og erstatter nøkkellisten for samme kategori", () => {
  const current = {
    tripCategories: { a: "jobb", c: "annet" },
    userKeywords: { jobb: ["kontor"], helse: ["lege"] },
    transportData: { 2025: { taxi: { trips: 3 }, fly: { trips: 1 } } },
  };
  const { next, counts } = mergeBackup(current, incoming({
    tripCategories: { a: "helse" },
    userKeywords: { jobb: ["møte"] },
    transportData: { 2025: { taxi: { trips: 9 } } },
  }), { overwrite: true });
  assert.deepEqual(next.tripCategories, { a: "helse", c: "annet" });
  // «kontor» forsvinner: listen for jobb erstattes. helse er ikke i filen og står.
  assert.deepEqual(next.userKeywords, { jobb: ["møte"], helse: ["lege"] });
  assert.deepEqual(next.transportData, { 2025: { taxi: { trips: 9 }, fly: { trips: 1 } } });
  assert.equal(counts.categoriesReplaced, 1);
  assert.equal(counts.transportReplaced, 1);
});

test("mergeBackup teller ikke like verdier som konflikter", () => {
  const current = { tripCategories: { a: "jobb" }, transportData: { 2025: { taxi: { trips: 3 } } } };
  const { counts } = mergeBackup(current, incoming({
    tripCategories: { a: "jobb" },
    transportData: { 2025: { taxi: { trips: 3 } } },
  }));
  assert.equal(counts.categoriesKept + counts.categoriesAdded, 0);
  assert.equal(counts.transportKept + counts.transportAdded, 0);
});

test("mergeBackup fyller et tømt transportskjema", () => {
  const current = { transportData: { 2025: { taxi: {} } } };
  const { next, counts } = mergeBackup(current, incoming({ transportData: { 2025: { taxi: { trips: 4 } } } }));
  assert.deepEqual(next.transportData[2025].taxi, { trips: 4 });
  assert.equal(counts.transportAdded, 1);
});

test("mergeBackup fletter turer på id og beholder de lagrede", () => {
  const stored = trip("a", { notes: "lagret" });
  const current = { reservations: [stored, trip(7)], lastSync: 2000 };
  const { next, counts } = mergeBackup(current, incoming({
    reservations: [trip("a", { notes: "fra fil" }), trip("7"), trip("b")],
    lastSync: 1000,
  }));
  assert.deepEqual(next.reservations.map((r) => r.id), ["a", 7, "b"]);
  assert.equal(next.reservations[0].notes, "lagret");
  assert.equal(counts.reservationsAdded, 1);
  assert.equal(counts.reservationsKept, 2);
  assert.equal(next.lastSync, 2000);
});

test("mergeBackup tar lastSync fra filen når lageret er tomt", () => {
  const { next } = mergeBackup({}, incoming({ reservations: [trip("a")], lastSync: 1000 }));
  assert.equal(next.lastSync, 1000);
  assert.equal(next.reservations.length, 1);
});

test("mergeBackup tar importerte turer ut av køen til en synk som pågår", () => {
  const syncState = {
    phase: "details",
    initial: true,
    pendingIds: ["c", "d", "e", "a"],
    failed: { d: { status: 500, attempts: 1 }, x: { status: 404, attempts: 1 } },
    total: 6,
    done: 2,
    fetchedSoFar: 2,
  };
  // a er lagret og venter på oppdatering. Filens versjon erstatter den ikke, så a står.
  const current = { reservations: [trip("a"), trip("b")], syncState };
  const { next, counts } = mergeBackup(current, incoming({ reservations: [trip("a"), trip("c"), trip("d")] }));
  assert.equal(counts.reservationsAdded, 2);
  assert.deepEqual(next.syncState.pendingIds, ["e", "a"]);
  assert.deepEqual(Object.keys(next.syncState.failed), ["x"]);
  assert.equal(next.syncState.done, 4);
  assert.equal(next.syncState.total, 6);
  assert.equal(next.syncState.fetchedSoFar, 2);
  assert.equal(next.syncState.phase, "details");
  assert.deepEqual(current.syncState.pendingIds, ["c", "d", "e", "a"]);
});

test("mergeBackup rører ikke syncState når køen ikke endres", () => {
  const syncState = { phase: "done", pendingIds: [], failed: {}, total: 2, done: 2 };
  const { next } = mergeBackup({ reservations: [], syncState }, incoming({ reservations: [trip("a")] }));
  assert.ok(!("syncState" in next));
  const userOnly = mergeBackup({ syncState: { pendingIds: ["a"] } }, incoming({ tripCategories: { a: "jobb" } }));
  assert.ok(!("syncState" in userOnly.next));
});

test("mergeBackup teller år med nye transporttall", () => {
  const { counts } = mergeBackup(
    { transportData: { 2025: { taxi: { trips: 3 } } } },
    incoming({ transportData: { 2025: { taxi: { trips: 3 }, buss: { trips: 1 } }, 2024: { fly: { trips: 2 }, tog: { trips: 1 } }, 2023: {} } }),
  );
  assert.equal(counts.transportAdded, 3);
  assert.equal(counts.transportYears, 2);
});

test("describeImport sier hva som faktisk ble lagt til", () => {
  const none = mergeBackup({}, incoming({})).counts;
  assert.equal(
    describeImport({ ...none, reservationsAdded: 662, categoriesAdded: 120, keywordsAdded: 30, transportYears: 2 }),
    "Importerte 662 turer, 120 kategorivalg, 30 nøkkelord og transporttall for 2 år.",
  );
  assert.equal(describeImport({ ...none, reservationsAdded: 1 }), "Importerte 1 tur.");
  assert.equal(
    describeImport({ ...none, categoriesReplaced: 1, transportYears: 1 }),
    "Importerte 1 kategorivalg og transporttall for 1 år.",
  );
  assert.equal(describeImport(none), "Ingenting nytt. Alt i filen var lagret fra før.");
  assert.equal(
    describeImport({ ...none, categoriesKept: 2 }),
    "Ingenting nytt. 2 verdier var ulike i filen, og de lagrede ble beholdt.",
  );
  assert.equal(
    describeImport({ ...none, keywordsAdded: 1, transportKept: 1 }),
    "Importerte 1 nøkkelord. 1 verdi var ulik i filen, og den lagrede ble beholdt.",
  );
});

test("en tom installasjon som importerer alt, får ikke «Ingenting nytt»", () => {
  const { counts } = mergeBackup({}, incoming({ reservations: [trip("a"), trip("b")], tripCategories: { a: "jobb" } }));
  assert.equal(describeImport(counts), "Importerte 2 turer og 1 kategorivalg.");
});

test("mergeBackup endrer ikke det den får inn", () => {
  const current = { tripCategories: { a: "jobb" }, transportData: { 2025: { taxi: { trips: 3 } } }, userKeywords: { jobb: ["x"] } };
  const snapshot = structuredClone(current);
  mergeBackup(current, incoming({ tripCategories: { b: "jobb" }, transportData: { 2025: { buss: { trips: 1 } } } }), { overwrite: true });
  assert.deepEqual(current, snapshot);
});

// ---------- Versjon 2: egne kategorier ----------

const KATT = { custom: { "egen-katt": { label: "Katt" } }, removed: { hoytid: ["jul"] }, order: null };

test("createBackup har categorySettings og versjon 2", () => {
  const backup = createBackup({
    tripCategories: { a: "egen-katt", b: "egen-hund" },
    userKeywords: { "egen-katt": ["katt"] },
    categorySettings: KATT,
  });
  assert.equal(BACKUP_VERSION, 2);
  assert.equal(backup.version, 2);
  assert.deepEqual(backup.categorySettings, KATT);
  assert.deepEqual(backup.tripCategories, { a: "egen-katt" });
  assert.deepEqual(backup.userKeywords, { "egen-katt": ["katt"] });
  assert.deepEqual(createBackup({}).categorySettings, { custom: {}, removed: {}, order: null });
});

test("parseBackup leser versjon 1 og flytter gamle kategorinøkler", () => {
  const { backup, skipped } = parseBackup({
    format: BACKUP_FORMAT,
    version: 1,
    tripCategories: { a: "flyplass", b: "hyttetur", c: "skyss" },
    userKeywords: { hyttetur: ["Naustet"], flyplass: ["gardermoen"] },
  });
  assert.deepEqual(backup.tripCategories, { a: "transport", b: "aktivitet", c: "transport" });
  assert.deepEqual(backup.userKeywords, { transport: ["gardermoen"], aktivitet: ["naustet"] });
  assert.deepEqual(backup.categorySettings, { custom: {}, removed: {}, order: null });
  assert.equal(skipped.categories, 0);
});

test("parseBackup godtar egne kategorier bare når filen har dem med", () => {
  const withSettings = parseBackup({ tripCategories: { a: "egen-katt" }, categorySettings: KATT });
  assert.deepEqual(withSettings.backup.tripCategories, { a: "egen-katt" });
  assert.equal(withSettings.skipped.categories, 0);

  const without = parseBackup({ tripCategories: { a: "egen-katt", b: "jobb" } });
  assert.deepEqual(without.backup.tripCategories, { b: "jobb" });
  assert.equal(without.skipped.categories, 1);
});

test("parseBackup kjenner nøkkelord- og kategorieksporten med categorySettings", () => {
  const keywords = parseBackup({ userKeywords: { "egen-katt": ["katt"] }, categorySettings: KATT }).backup;
  assert.deepEqual(keywords.userKeywords, { "egen-katt": ["katt"] });
  assert.deepEqual(keywords.categorySettings.custom, KATT.custom);
  // Bare innstillinger er også noe å importere.
  assert.equal(parseBackup({ categorySettings: KATT }).error, undefined);
  assert.match(parseBackup({ categorySettings: {} }).error, /ingenting/);
  // Den eldste nøkkelordeksporten med gamle nøkler.
  assert.deepEqual(parseBackup({ skyss: ["sfo"] }).backup.userKeywords, { transport: ["sfo"] });
  assert.ok(parseBackup({ skyss: ["sfo"], tull: ["x"] }).error);
});

test("mergeBackup legger til egne kategorier og slår sammen fjernede ord", () => {
  const current = {
    categorySettings: {
      custom: { "egen-hund": { label: "Hund" } },
      removed: { hoytid: ["påske"] },
      order: ["egen-hund", "helse"],
    },
    userKeywords: { "egen-hund": ["hund"] },
  };
  const file = incoming({
    tripCategories: { a: "egen-katt" },
    userKeywords: { "egen-katt": ["katt"] },
    categorySettings: {
      custom: { "egen-katt": { label: "Katt" }, "egen-hund": { label: "Bikkje" } },
      removed: { hoytid: ["jul"] },
      order: ["helse", "egen-katt"],
    },
  });
  const { next, counts } = mergeBackup(current, file);
  assert.deepEqual(next.categorySettings.custom, {
    "egen-hund": { label: "Hund" },
    "egen-katt": { label: "Katt" },
  });
  assert.deepEqual(next.categorySettings.removed, { hoytid: ["påske", "jul"] });
  // Lagret rekkefølge står, og det som mangler fylles inn.
  assert.deepEqual(next.categorySettings.order.slice(0, 2), ["egen-hund", "helse"]);
  assert.equal(next.categorySettings.order.at(-1), "egen-katt");
  assert.equal(next.categorySettings.order.length, 12);
  assert.deepEqual(next.tripCategories, { a: "egen-katt" });
  assert.deepEqual(next.userKeywords, { "egen-hund": ["hund"], "egen-katt": ["katt"] });
  assert.equal(counts.customCategoriesAdded, 1);
  assert.equal(counts.keywordsRemoved, 1);
});

test("mergeBackup med overwrite tar navn, fjernede ord og rekkefølge fra filen", () => {
  const current = {
    categorySettings: {
      custom: { "egen-hund": { label: "Hund" } },
      removed: { hoytid: ["påske"], helse: ["lege"] },
      order: null,
    },
  };
  const file = incoming({
    categorySettings: {
      custom: { "egen-hund": { label: "Bikkje" } },
      removed: { hoytid: ["jul"] },
      order: ["helse", "egen-hund"],
    },
  });
  const { next, counts } = mergeBackup(current, file, { overwrite: true });
  assert.deepEqual(next.categorySettings.custom, { "egen-hund": { label: "Bikkje" } });
  assert.deepEqual(next.categorySettings.removed, { hoytid: ["jul"], helse: ["lege"] });
  assert.equal(next.categorySettings.order[0], "helse");
  assert.ok(next.categorySettings.order.includes("egen-hund"));
  assert.equal(counts.customCategoriesAdded, 0);

  // Uten lagret rekkefølge tas filens også uten overwrite.
  const kept = mergeBackup({}, file).next.categorySettings;
  assert.equal(kept.order[0], "helse");
  assert.equal(mergeBackup({}, incoming({})).next.categorySettings.order, null);
});

test("describeImport teller egne kategorier", () => {
  const none = mergeBackup({}, incoming({})).counts;
  assert.equal(
    describeImport({ ...none, customCategoriesAdded: 1, keywordsAdded: 2 }),
    "Importerte 1 egen kategori og 2 nøkkelord.",
  );
  assert.equal(describeImport({ ...none, customCategoriesAdded: 2 }), "Importerte 2 egne kategorier.");
  assert.equal(describeImport({ ...none, keywordsRemoved: 1 }), "Importerte 1 fjernet standardord.");
});
