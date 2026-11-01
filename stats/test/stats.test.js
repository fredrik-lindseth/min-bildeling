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

function bookedCar(leadHours, model, station) {
  return booked(leadHours, { car: { model }, location: { name: station } });
}

test("ytterpunktene peker på turen med lengst og kortest bookingtid", () => {
  const { extremes } = bookingPatterns([
    bookedCar(30, "Yaris", "Sentrum"),
    bookedCar(900, "ID.4", "Fjellet"),
    bookedCar(2.5, "Leaf", "Torget"),
  ]);
  assert.deepEqual(extremes.longest, {
    leadHours: 900, carModel: "ID.4", start: "2025-06-15T12:00:00.000Z", station: "Fjellet",
  });
  assert.equal(extremes.shortest.leadHours, 2.5);
  assert.equal(extremes.shortest.carModel, "Leaf");
  assert.equal(extremes.shortest.station, "Torget");
});

test("booking etter starttid er den mest spontane og vises som 0 timer", () => {
  const { extremes } = bookingPatterns([
    bookedCar(0.1, "Yaris", "Sentrum"),
    bookedCar(-3, "Leaf", "Torget"),
    bookedCar(48, "ID.4", "Fjellet"),
  ]);
  assert.equal(extremes.shortest.carModel, "Leaf");
  assert.equal(extremes.shortest.leadHours, 0);
});

test("ved likt vinner den første turen", () => {
  const { extremes } = bookingPatterns([
    bookedCar(10, "Først kort", "A"),
    bookedCar(50, "Først lang", "B"),
    bookedCar(10, "Sist kort", "C"),
    bookedCar(50, "Sist lang", "D"),
  ]);
  assert.equal(extremes.shortest.carModel, "Først kort");
  assert.equal(extremes.longest.carModel, "Først lang");
});

test("under to gyldige bookinger gir ingen ytterpunkter", () => {
  assert.equal(bookingPatterns([bookedCar(10, "Yaris", "Sentrum")]).extremes, null);
  const oneValid = bookingPatterns([
    bookedCar(10, "Yaris", "Sentrum"),
    booked(5, { canceled: "2025-06-01T10:00:00Z" }),
    booked(7, { created: null }),
  ]);
  assert.equal(oneValid.extremes, null);
});

test("snitt, median og fordeling klamper fortsatt til 0", () => {
  const { avgDays, medianDays, distribution } = bookingPatterns([booked(-24), booked(24), booked(72)]);
  assert.equal(avgDays, 96 / 3 / 24);
  assert.equal(medianDays, 1);
  assert.deepEqual(distribution.map((b) => b.count), [1, 1, 1, 0, 0, 0, 0]);
});
