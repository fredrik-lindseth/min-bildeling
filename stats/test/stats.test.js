import { test } from "node:test";
import assert from "node:assert/strict";

import { costYears, keepSelectedYear } from "../lib/stats.js";

function trip(start, extra = {}) {
  return { start, canceled: null, noTrips: false, price: { total: 100 }, ...extra };
}

test("costYears gir årene med gyldige turer, stigende og uten dubletter", () => {
  const reservations = [
    trip("2025-03-01T10:00:00Z"),
    trip("2023-06-01T10:00:00Z"),
    trip("2025-07-01T10:00:00Z"),
    trip("2022-01-10T10:00:00Z", { canceled: "2022-01-09T10:00:00Z" }),
    trip("2021-01-10T10:00:00Z", { price: { total: null } }),
  ];
  assert.deepEqual(costYears(reservations), [2023, 2025]);
});

test("keepSelectedYear beholder et år som fortsatt finnes", () => {
  assert.equal(keepSelectedYear("2024", [2023, 2024, 2025]), "2024");
});

test("keepSelectedYear beholder «Alle år»", () => {
  assert.equal(keepSelectedYear("all", [2024]), "all");
  assert.equal(keepSelectedYear("all", []), "all");
});

test("keepSelectedYear faller tilbake til «Alle år» når året er borte", () => {
  assert.equal(keepSelectedYear("2019", [2024, 2025]), "all");
});

test("keepSelectedYear står fast gjennom gjentatte opptegninger mens nye år kommer til", () => {
  let selected = "2024";
  for (const years of [[2024], [2024, 2025], [2023, 2024, 2025]]) {
    selected = keepSelectedYear(selected, years);
  }
  assert.equal(selected, "2024");
});
