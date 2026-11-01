import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingPatterns, costYears, keepSelectedYear } from "../lib/stats.js";

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

const START = Date.parse("2025-06-15T12:00:00Z");
const HOUR = 3600000;

function booked(leadHours, extra = {}) {
  return trip(new Date(START).toISOString(), {
    created: new Date(START - leadHours * HOUR).toISOString(),
    ...extra,
  });
}

function bucketFor(leadHours) {
  const { distribution } = bookingPatterns([booked(leadHours)]);
  return distribution.find((b) => b.count === 1).label;
}

test("bookingtiden havner i bøtta etikettene lover, på begge sider av hver grense", () => {
  const cases = [
    [0, "<24 t"],
    [23.99, "<24 t"],
    [24, "1 dag"],
    [47.99, "1 dag"],
    [48, "2–3 dager"],
    [3 * 24 + 23.99, "2–3 dager"],
    [4 * 24, "4–7 dager"],
    [7 * 24 + 23.99, "4–7 dager"],
    [8 * 24, "8–14 dager"],
    [14 * 24 + 23.99, "8–14 dager"],
    [15 * 24, "15–30 dager"],
    [30 * 24 + 23.99, "15–30 dager"],
    [31 * 24, "31+ dager"],
    [400 * 24, "31+ dager"],
  ];
  for (const [hours, label] of cases) {
    assert.equal(bucketFor(hours), label, `${hours} t`);
  }
});

test("booking etter starttid teller som under ett døgn", () => {
  assert.equal(bucketFor(-5), "<24 t");
});

test("bøttene dekker hver bookingtid nøyaktig én gang", () => {
  const leads = [0, 12, 24, 30, 50, 100, 200, 340, 359, 360, 720, 743, 744, 2000];
  const { distribution } = bookingPatterns(leads.map((h) => booked(h)));
  assert.equal(distribution.reduce((sum, b) => sum + b.count, 0), leads.length);
});
