import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEMO_SEED,
  DEMO_TRIP_TYPES,
  DEMO_EXTREME_NOTES,
  generateDemoReservations,
  createDemoSession,
  createDemoStorage,
  isDemoMode,
} from "../lib/demo-data.js";
import { DEFAULT_KEYWORDS, suggestCategory, loadCategories, saveCategory } from "../lib/categories.js";
import {
  filterValid,
  filterDriven,
  costStats,
  mileageStats,
  bookingPatterns,
  usagePatterns,
} from "../lib/stats.js";
import { estimateOwnershipCost } from "../lib/ownership-cost.js";
import { co2Comparison } from "../lib/co2.js";
import { loadTransportData, saveTransportData } from "../lib/transport.js";

const NOW = new Date(2026, 10, 1, 12, 0);

test("samme seed og samme dag gir nøyaktig samme data", () => {
  const a = generateDemoReservations({ seed: DEMO_SEED, now: NOW });
  const b = generateDemoReservations({ seed: DEMO_SEED, now: new Date(2026, 10, 1, 23, 59) });
  assert.deepEqual(a, b);
  const other = generateDemoReservations({ seed: DEMO_SEED + 1, now: NOW });
  assert.notDeepEqual(a, other);
});

test("rundt 180 reservasjoner over tre kalenderår", () => {
  const r = generateDemoReservations({ now: NOW });
  assert.ok(r.length >= 160 && r.length <= 200, `fikk ${r.length}`);
  const years = new Set(r.map((x) => new Date(x.start).getFullYear()));
  assert.deepEqual([...years].sort(), [2024, 2025, 2026]);
  assert.ok(r.every((x) => new Date(x.start) <= new Date(2026, 10, 2)), "ingen turer etter dagens dato");
});

test("bruker API-feltnavnene", () => {
  for (const r of generateDemoReservations({ now: NOW })) {
    assert.equal(typeof r.price.total, "number");
    assert.ok(Array.isArray(r.price.lines));
    assert.ok("drivenKm" in r);
    assert.equal(typeof r.car.model, "string");
    assert.match(r.car.category, /^(Småbil|Minibil|Kombi|Stasjonsvogn|SUV|Varebil)$/);
    assert.ok(r.car.properties.some((p) => p.groupKey === "FUEL_TYPE"));
    assert.ok("canceled" in r && "noTrips" in r && "notes" in r);
    assert.ok(!Number.isNaN(Date.parse(r.start)) && !Number.isNaN(Date.parse(r.created)));
    assert.equal(typeof r.location.name, "string");
    assert.equal(r.totalPrice, undefined);
    assert.equal(r.distance, undefined);
  }
});

test("har noTrips, avbestilte og stasjoner i både Bergen og Trondheim", () => {
  const r = generateDemoReservations({ now: NOW });
  const valid = filterValid(r);
  assert.ok(valid.some((x) => x.noTrips && x.price.total > 0), "noTrips med gebyr");
  assert.ok(r.filter((x) => x.canceled != null).length >= 2, "avbestilte");
  const names = r.map((x) => x.location.name);
  assert.ok(names.some((n) => n.endsWith("Bergen")));
  assert.ok(names.some((n) => n.endsWith("Trondheim")));
  assert.ok(r.some((x) => x.organizationName === "Trondheim Bilkollektiv"));
});

test("notatene treffer standard-nøkkelordene slik de er ment", () => {
  for (const type of DEMO_TRIP_TYPES) {
    for (const notes of type.notes) {
      if (notes == null) continue;
      assert.equal(suggestCategory({ notes }, DEFAULT_KEYWORDS), type.category, notes);
    }
  }
  for (const [notes, category] of Object.entries(DEMO_EXTREME_NOTES)) {
    assert.equal(suggestCategory({ notes }, DEFAULT_KEYWORDS), category, notes);
  }
});

test("alle seksjoner har innhold og ytterpunktene synes", () => {
  const r = generateDemoReservations({ now: NOW });
  const mileage = mileageStats(r);
  assert.ok(mileage.max > 1000, "lengste tur skiller seg ut");
  const costs = costStats(r);
  assert.ok(costs.max > costs.median * 10, "dyreste tur skiller seg ut");

  const booking = bookingPatterns(r);
  for (const bucket of booking.distribution) {
    assert.ok(bucket.count > 0, `tom bøtte ${bucket.label}`);
  }
  assert.ok(booking.uniqueStations >= 5);

  const usage = usagePatterns(r);
  assert.ok(usage.topCars.length >= 5);

  const valid = filterValid(r);
  assert.ok(valid.some((x) => x.start.startsWith("2026-11")), "popupen har turer denne måneden");
  assert.ok(valid.some((x) => x.start.startsWith("2026-10")), "og forrige måned");

  for (const year of [2024, 2025, 2026]) {
    const own = estimateOwnershipCost(r, year);
    assert.ok(own && own.savings > 0, `sparing ${year}`);
    const yearTrips = r.filter((x) => new Date(x.start).getFullYear() === year);
    assert.ok(co2Comparison(yearTrips).savedKg > 0, `CO₂ ${year}`);
    assert.ok(filterDriven(yearTrips).length > 30);
  }
});

test("demolageret er forhåndsfylt og lever bare i minnet", async () => {
  const session = createDemoSession({ now: NOW });
  assert.equal(session.lastSync, undefined, "demo har ingen synktid å vise");
  const categories = await loadCategories(session.storage);
  assert.ok(Object.values(categories).includes("helgetur"));
  const transport = await loadTransportData(session.storage);
  assert.deepEqual(Object.keys(transport).sort(), ["2024", "2025", "2026"]);

  // Endringer i én økt lekker ikke til neste.
  await saveCategory(session.storage, "x", "jobb");
  const fresh = createDemoSession({ now: NOW });
  assert.equal((await loadCategories(fresh.storage)).x, undefined);
});

test("demomodus rører aldri utvidelsens storage eller runtime", async () => {
  const calls = [];
  const spy = (name) => async (...args) => {
    calls.push([name, args]);
    return {};
  };
  globalThis.browser = {
    storage: { local: { get: spy("get"), set: spy("set"), remove: spy("remove") } },
    runtime: { sendMessage: spy("sendMessage"), getManifest: () => ({ version: "0" }) },
  };
  try {
    const session = createDemoSession({ now: NOW });
    await saveCategory(session.storage, session.reservations[0].id, "jobb");
    await saveTransportData(session.storage, { 2026: { buss: { trips: 1 } } });
    await session.storage.get(["reservations", "lastSync"]);
    await session.storage.remove(["tripCategories"]);
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.browser;
  }

  // Modulen skal ikke dra inn nettleser-API eller synken.
  const source = await readFile(new URL("../lib/demo-data.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /browser\.|chrome\.|sendMessage/);
});

test("sidene går utenom synk og storage i demomodus", async () => {
  for (const page of ["dashboard/dashboard.js", "popup/popup.js", "summary/summary.js"]) {
    const source = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.ok(source.includes("isDemoMode("), `${page} sjekker ikke demomodus`);
    // Uten utvidelses-API (vanlig http) må ikke en bar `chrome`-referanse kaste.
    assert.ok(!/:\s*chrome;/.test(source), `${page} refererer chrome uten vern`);
  }
  const polyfill = await readFile(new URL("../lib/browser-polyfill.js", import.meta.url), "utf8");
  assert.ok(!/:\s*chrome;/.test(polyfill), "browser-polyfill refererer chrome uten vern");
});

test("?demo=1 slår på demomodus, alt annet ikke", () => {
  assert.equal(isDemoMode("?demo=1"), true);
  assert.equal(isDemoMode("?dev=1&demo=1"), true);
  assert.equal(isDemoMode(""), false);
  assert.equal(isDemoMode("?demo=0"), false);
});
