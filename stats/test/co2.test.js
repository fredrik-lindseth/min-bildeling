// Gjennomsnittsbilen i Klima: SSB-tallene regnes om riktig, og brukeren
// sammenlignes med et helt år, eller med et delår mot et skalert snitt.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_CAR_AVG_CO2,
  averageCarCO2PerKm,
  averageCarKgPerYear,
  comparisonYear,
  averageCarComparison,
} from "../lib/co2.js";

function trip(start, km, fuel, category = "Småbil") {
  return {
    start, drivenKm: km, price: { total: 100 }, canceled: null, noTrips: false,
    car: { category, properties: [{ groupKey: "FUEL_TYPE", name: fuel }] },
  };
}

test("snittet er SSBs utslipp delt på kjørelengden", () => {
  assert.equal(averageCarCO2PerKm(), Math.round((3280 * 1000) / 35442.9));
  assert.equal(averageCarCO2PerKm(), PRIVATE_CAR_AVG_CO2);
});

test("en gjennomsnittlig personbil slipper ut om lag 1 042 kg i året", () => {
  assert.ok(Math.abs(averageCarKgPerYear() - (11205 * 93) / 1000) < 1);
});

test("sammenligningsåret er siste hele år, ellers inneværende år hittil", () => {
  assert.deepEqual(comparisonYear([2024, 2025, 2026], new Date(2026, 10, 2)), { year: 2025, fraction: 1 });
  const partial = comparisonYear([2026], new Date(2026, 6, 2));
  assert.equal(partial.year, 2026);
  assert.ok(Math.abs(partial.fraction - 0.5) < 0.01);
  assert.equal(comparisonYear([], new Date(2026, 10, 2)), null);
});

test("helt år sammenlignes med hele snittbilen", () => {
  const cmp = averageCarComparison(
    [trip("2025-05-01T10:00:00Z", 100, "Bensin"), trip("2025-06-01T10:00:00Z", 50, "Elektrisitet"),
      trip("2026-02-01T10:00:00Z", 30, "Bensin")],
    { now: new Date(2026, 10, 2) },
  );
  assert.equal(cmp.year, 2025);
  assert.equal(cmp.partial, false);
  assert.equal(cmp.userKm, 150);
  assert.equal(cmp.userCO2Kg, (100 * 120) / 1000);
  assert.equal(cmp.carKm, 11205);
  assert.equal(cmp.dataYear, 2024);
});

test("bare turer i år gir et delår mot et skalert snitt", () => {
  const cmp = averageCarComparison([trip("2026-03-01T10:00:00Z", 80, "Diesel")], { now: new Date(2026, 6, 2) });
  assert.equal(cmp.year, 2026);
  assert.equal(cmp.partial, true);
  // 2. juli er litt etter midten av året, så snittbilen har kjørt om lag halvparten.
  assert.ok(Math.abs(cmp.carKm - 5602.5) < 60, String(cmp.carKm));
});

test("uten kjørte km er det ingenting å sammenligne", () => {
  assert.equal(averageCarComparison([], { now: new Date(2026, 6, 2) }), null);
  assert.equal(averageCarComparison([trip("2026-03-01T10:00:00Z", 0, "Bensin")], { now: new Date(2026, 6, 2) }), null);
});
