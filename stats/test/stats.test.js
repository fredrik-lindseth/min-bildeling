import { test } from "node:test";
import assert from "node:assert/strict";

import {
  averagePerYear,
  bookingPatterns,
  costYears,
  describeYearToDate,
  keepSelectedYear,
  mostExpensiveYear,
  sortYearSummaries,
  yearSummaries,
  yearToDate,
} from "../lib/stats.js";

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

// Lokal tid, som resten av årsinndelingen.
function at(y, m, d, h = 12, min = 0) {
  return new Date(y, m, d, h, min).toISOString();
}

function paid(start, total, extra = {}) {
  return trip(start, { price: { total }, ...extra });
}

test("yearSummaries grupperer per år med turer, km, kostnad og snitt", () => {
  const rows = yearSummaries([
    paid(at(2024, 2, 1), 300, { drivenKm: 30 }),
    paid(at(2024, 5, 1), 100, { drivenKm: 10 }),
    paid(at(2025, 0, 10), 200, { drivenKm: 50 }),
  ]);
  assert.deepEqual(rows, [
    { year: 2024, trips: 2, km: 40, total: 400, avgPerTrip: 200, perKm: 10 },
    { year: 2025, trips: 1, km: 50, total: 200, avgPerTrip: 200, perKm: 4 },
  ]);
});

test("yearSummaries teller ikke avbestilte turer eller turer uten pris", () => {
  const rows = yearSummaries([
    paid(at(2024, 2, 1), 300),
    paid(at(2024, 3, 1), 500, { canceled: at(2024, 2, 30) }),
    trip(at(2024, 4, 1), { price: { total: null } }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trips, 1);
  assert.equal(rows[0].total, 300);
});

test("yearSummaries henter km bare fra kjørte turer med km over null", () => {
  const rows = yearSummaries([
    paid(at(2024, 2, 1), 300, { drivenKm: 20 }),
    paid(at(2024, 3, 1), 100, { noTrips: true, drivenKm: 99 }),
    paid(at(2024, 4, 1), 100, { drivenKm: 0 }),
  ]);
  assert.equal(rows[0].trips, 3);
  assert.equal(rows[0].km, 20);
  assert.equal(rows[0].total, 500);
});

test("yearSummaries gir kr/km null for år uten km", () => {
  const [row] = yearSummaries([paid(at(2024, 2, 1), 300)]);
  assert.equal(row.km, 0);
  assert.equal(row.perKm, null);
});

test("yearSummaries gir tom liste uten gyldige turer", () => {
  assert.deepEqual(yearSummaries([]), []);
  assert.deepEqual(yearSummaries([trip(at(2024, 1, 1), { canceled: at(2024, 0, 1) })]), []);
});

const NOW = new Date(2026, 10, 2, 12);

test("yearToDate tar med turer fram til nå og samme øyeblikk i fjor", () => {
  const ytd = yearToDate(
    [
      paid(at(2026, 10, 2, 11), 100),
      paid(at(2026, 10, 2, 13), 1000),
      paid(at(2025, 10, 2, 11), 50),
      paid(at(2025, 10, 2, 13), 1000),
    ],
    NOW
  );
  assert.equal(ytd.year, 2026);
  assert.equal(ytd.total, 100);
  assert.equal(ytd.trips, 1);
  assert.equal(ytd.lastYearTotal, 50);
  assert.equal(ytd.lastYearTrips, 1);
  assert.equal(ytd.change, 1);
});

test("yearToDate starter 1. januar ved midnatt lokal tid", () => {
  const ytd = yearToDate(
    [
      paid(at(2026, 0, 1, 0, 0), 200),
      paid(at(2025, 11, 31, 23, 59), 1000),
      paid(at(2025, 0, 1, 0, 0), 400),
      paid(at(2024, 11, 31, 23, 59), 1000),
    ],
    NOW
  );
  assert.equal(ytd.total, 200);
  assert.equal(ytd.lastYearTotal, 400);
  assert.equal(ytd.change, -0.5);
});

test("yearToDate gir change null når fjoråret var tomt", () => {
  const ytd = yearToDate([paid(at(2026, 4, 1), 200)], NOW);
  assert.equal(ytd.lastYearTrips, 0);
  assert.equal(ytd.change, null);
});

test("yearToDate gir null når begge vinduene er tomme", () => {
  assert.equal(yearToDate([], NOW), null);
  assert.equal(yearToDate([paid(at(2026, 11, 20), 200)], NOW), null);
});

test("yearToDate lar fjorgrensen for 29. februar bli 1. mars", () => {
  const now = new Date(2028, 1, 29, 12);
  const ytd = yearToDate(
    [paid(at(2027, 2, 1, 11), 100), paid(at(2027, 2, 1, 13), 1000)],
    now
  );
  assert.equal(ytd.lastYearTotal, 100);
});

test("describeYearToDate gir riktig tekst for hvert tilfelle", () => {
  const base = { year: 2026, total: 100, trips: 1, lastYearTotal: 100, lastYearTrips: 1 };
  assert.equal(describeYearToDate({ ...base, change: 0.25 }), "25 % mer enn samme tid i fjor");
  assert.equal(describeYearToDate({ ...base, change: -0.4 }), "40 % mindre enn samme tid i fjor");
  assert.equal(describeYearToDate({ ...base, change: 0 }), "Som samme tid i fjor");
  assert.equal(describeYearToDate({ ...base, change: 0.004 }), "Som samme tid i fjor");
  assert.equal(
    describeYearToDate({ ...base, lastYearTotal: 0, lastYearTrips: 0, change: null }),
    "Ingen turer samme tid i fjor"
  );
  assert.match(
    describeYearToDate({ ...base, lastYearTotal: 0, lastYearTrips: 2, change: null }),
    /^Samme tid i fjor: 0\skr\.$/
  );
  const text = describeYearToDate({ ...base, total: 0, trips: 0, lastYearTotal: 1500, change: -1 });
  assert.match(text, /^Ingen turer ennå i år\. Samme tid i fjor: 1\s500\skr\.$/);
});

test("averagePerYear deler summen på tiden siden første tur", () => {
  const now = new Date(2026, 0, 1, 12);
  const since = new Date(now.getTime() - 2 * 365.25 * 24 * 3600000).toISOString();
  const avg = averagePerYear([paid(since, 10000), paid(at(2025, 5, 1), 10000)], now);
  assert.equal(avg.since, since);
  assert.ok(Math.abs(avg.years - 2) < 1e-9);
  assert.ok(Math.abs(avg.perYear - 10000) < 1e-6);
});

test("averagePerYear regner fra første gyldige tur, ikke en avbestilt", () => {
  const now = new Date(2026, 0, 1, 12);
  const first = at(2024, 0, 1);
  const avg = averagePerYear(
    [paid(at(2020, 0, 1), 500, { canceled: at(2019, 11, 1) }), paid(first, 100)],
    now
  );
  assert.equal(avg.since, first);
});

test("averagePerYear gir null under ett år og uten turer", () => {
  const now = new Date(2026, 0, 1, 12);
  assert.equal(averagePerYear([paid(at(2025, 6, 1), 100)], now), null);
  assert.equal(averagePerYear([], now), null);
});

test("mostExpensiveYear velger høyeste sum og tidligste år ved likt", () => {
  assert.deepEqual(
    mostExpensiveYear([
      { year: 2022, total: 500 },
      { year: 2023, total: 900 },
      { year: 2024, total: 900 },
    ]),
    { year: 2023, total: 900 }
  );
  assert.equal(mostExpensiveYear([]), null);
});

test("sortYearSummaries sorterer på valgt kolonne og lar input være", () => {
  const rows = [
    { year: 2022, total: 300, perKm: 3 },
    { year: 2023, total: 100, perKm: null },
    { year: 2024, total: 300, perKm: 2 },
  ];
  const copy = structuredClone(rows);
  assert.deepEqual(sortYearSummaries(rows, "year").map((r) => r.year), [2022, 2023, 2024]);
  assert.deepEqual(sortYearSummaries(rows, "year", "desc").map((r) => r.year), [2024, 2023, 2022]);
  assert.deepEqual(sortYearSummaries(rows, "total", "desc").map((r) => r.year), [2022, 2024, 2023]);
  assert.deepEqual(sortYearSummaries(rows, "total", "asc").map((r) => r.year), [2023, 2022, 2024]);
  assert.deepEqual(rows, copy);
});

test("sortYearSummaries legger manglende kr/km sist i begge retninger", () => {
  const rows = [
    { year: 2022, perKm: 3 },
    { year: 2023, perKm: null },
    { year: 2024, perKm: 2 },
  ];
  assert.deepEqual(sortYearSummaries(rows, "perKm", "asc").map((r) => r.year), [2024, 2022, 2023]);
  assert.deepEqual(sortYearSummaries(rows, "perKm", "desc").map((r) => r.year), [2022, 2024, 2023]);
});
