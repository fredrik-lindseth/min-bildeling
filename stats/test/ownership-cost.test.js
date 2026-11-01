// Tallene her er regnet for hånd fra OFVs «Kostnader ved bilhold 2026»,
// kolonnen 10 000 km/år. Endres en forutsetning i ownership-cost.js, skal
// både kildekommentaren og forventningen her endres.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateOwnershipCost,
  estimateVolvoComparison,
  VOLVO_EX40,
  OWNERSHIP_METHOD,
  homeOrganizationId,
  regionForOrganization,
} from "../lib/ownership-cost.js";

const BILDELERINGEN = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";
const TRONDHEIM = "8dba8f19-c438-f278-ed7c-912ec6537cb9";
// Etter årsskiftet er 2026 et helt år, så faste kostnader telles fullt.
const DONE = { now: new Date(2027, 0, 1) };

function trip({ start, category = "Småbil", fuel = "Elektrisitet", km = 50, total = 500, org }) {
  return {
    start,
    organizationId: org,
    canceled: null,
    noTrips: false,
    drivenKm: km,
    price: { total },
    car: { category, properties: [{ groupKey: "FUEL_TYPE", name: fuel }] },
  };
}

test("Småbil-elbil regnes som OFVs elbil til 300 000 kr", () => {
  const r = [trip({ start: "2026-03-01T10:00:00Z" }), trip({ start: "2026-04-01T10:00:00Z" })];
  const own = estimateOwnershipCost(r, 2026, DONE);
  assert.deepEqual(own.breakdownOwnership, {
    depreciation: 40495,
    insurance: 2045 + 8322,
    tax: 3343,
    maintenance: 3958 + 3189 + 3366,
    parking: 582 * 12,
    // 100 km × 0,152 kWh/km × (0,8 × 1,05 + 0,2 × 5,47) kr/kWh
    fuel: Math.round(100 * 0.152 * (0.8 * 1.05 + 0.2 * 5.47)),
  });
  assert.equal(own.sharingCost, 1000);
  const fixed = 40495 + 10367 + 3343 + 10513 + 6984;
  assert.equal(own.ownershipCost, Math.round(fixed + 100 * 0.152 * 1.934));
  assert.equal(own.savings, own.ownershipCost - 1000);
});

test("bensinbil betaler lavere trafikkforsikringsavgift og bensinpris per km", () => {
  const r = [trip({ start: "2026-05-01T10:00:00Z", category: "SUV", fuel: "Bensin", km: 1000 })];
  const own = estimateOwnershipCost(r, 2026, DONE);
  assert.equal(own.breakdownOwnership.tax, 2380);
  assert.equal(own.breakdownOwnership.depreciation, 65741);
  assert.equal(own.breakdownOwnership.fuel, Math.round(1000 * 20.72 * 0.061));
});

test("Volvo EX40 interpoleres mellom OFVs 400 000- og 550 000-eksempel", () => {
  const t = (439900 - 400000) / 150000;
  assert.equal(VOLVO_EX40.name, "Volvo EX40");
  assert.equal(VOLVO_EX40.costs.depreciation, Math.round(49653 + t * (65741 - 49653)));
  assert.equal(VOLVO_EX40.costs.tax, 3343);
  const r = [trip({ start: "2026-06-01T10:00:00Z", km: 1000, total: 2000 })];
  const v = estimateVolvoComparison(r, 2026, DONE);
  assert.equal(v.carName, "Volvo EX40");
  assert.equal(v.sharingCost, 2000);
  assert.ok(v.ownershipCost > 90000 && v.ownershipCost < 95000, `${v.ownershipCost}`);
});

test("«Slik beregner vi» daterer hver kilde og navngir begge byene", () => {
  for (const source of OWNERSHIP_METHOD.sources) {
    assert.match(source.text, /\d{4}/, `kilden mangler år: ${source.text}`);
    if (source.url) assert.match(source.url, /^https:\/\//, source.text);
  }
  assert.match(OWNERSHIP_METHOD.note, /Bergen/);
  assert.match(OWNERSHIP_METHOD.note, /Trondheim/);
  assert.ok(OWNERSHIP_METHOD.sources.some((s) => /Trondheim kommune/.test(s.text)));
  assert.doesNotMatch(OWNERSHIP_METHOD.note, /EX C40/);
});

test("teksten bruker tallene fra beregningen", () => {
  const nb = (n) => new Intl.NumberFormat("nb-NO").format(n);
  const monthly = (org) =>
    estimateVolvoComparison([trip({ start: "2026-06-01T10:00:00Z", org })], 2026, DONE)
      .breakdownOwnership.parking / 12;
  assert.ok(OWNERSHIP_METHOD.note.includes(`${nb(VOLVO_EX40.price)} kr`));
  assert.ok(OWNERSHIP_METHOD.note.includes(`${nb(monthly(BILDELERINGEN))} kr i måneden i Bergen`));
  assert.ok(OWNERSHIP_METHOD.note.includes(`${nb(monthly(TRONDHEIM))} kr i måneden i Trondheim`));
});

test("parkeringen følger organisasjonen i reservasjonene", () => {
  const bergen = estimateOwnershipCost([trip({ start: "2026-03-01T10:00:00Z", org: BILDELERINGEN })], 2026, DONE);
  assert.equal(bergen.breakdownOwnership.parking, 582 * 12);
  assert.equal(bergen.parkingCity, "Bergen");

  const trondheim = estimateOwnershipCost([trip({ start: "2026-03-01T10:00:00Z", org: TRONDHEIM })], 2026, DONE);
  assert.equal(trondheim.breakdownOwnership.parking, 785 * 12);
  assert.equal(trondheim.parkingCity, "Trondheim");
  assert.equal(trondheim.ownershipCost - bergen.ownershipCost, (785 - 582) * 12);
});

test("organizationId fra medlemskapet overstyrer reservasjonene", () => {
  const r = [trip({ start: "2026-03-01T10:00:00Z", org: BILDELERINGEN })];
  const own = estimateOwnershipCost(r, 2026, { ...DONE, organizationId: TRONDHEIM });
  assert.equal(own.breakdownOwnership.parking, 785 * 12);
  const v = estimateVolvoComparison(r, 2026, { ...DONE, organizationId: TRONDHEIM });
  assert.equal(v.breakdownOwnership.parking, 785 * 12);
  assert.equal(v.parkingCity, "Trondheim");
});

test("ukjent organisasjon regnes som Bergen", () => {
  const own = estimateOwnershipCost([trip({ start: "2026-03-01T10:00:00Z", org: "ukjent" })], 2026, DONE);
  assert.equal(own.parkingCity, "Bergen");
  assert.equal(regionForOrganization("ukjent"), null);
  assert.equal(regionForOrganization(TRONDHEIM), "trondheim");
});

test("hjemmeorganisasjonen er den flest reservasjoner hører til", () => {
  const r = [
    trip({ start: "2026-03-01T10:00:00Z", org: TRONDHEIM }),
    trip({ start: "2026-03-02T10:00:00Z", org: TRONDHEIM }),
    trip({ start: "2026-03-03T10:00:00Z", org: BILDELERINGEN }),
  ];
  assert.equal(homeOrganizationId(r), TRONDHEIM);
  assert.equal(homeOrganizationId([trip({ start: "2026-03-01T10:00:00Z" })]), null);
});

test("«spart i år» tar eierkostnaden for samme del av året som turene", () => {
  // Typisk medlem per 1. november: stasjonsvogn på bensin, 20 turer à 100 km
  // og 835 kr fra januar til oktober, ca. 20 000 kr i året.
  const r = [];
  for (let i = 0; i < 20; i++) {
    const month = String(1 + Math.floor(i / 2)).padStart(2, "0");
    r.push(trip({
      start: `2026-${month}-1${i % 2}T10:00:00Z`,
      category: "Stasjonsvogn", fuel: "Bensin", km: 100, total: 835, org: BILDELERINGEN,
    }));
  }
  const now = new Date(2026, 10, 1);
  const own = estimateOwnershipCost(r, 2026, { now });

  const fullYearFixed = 65741 + (3228 + 11720) + 2380 + (7687 + 5019 + 3694) + 582 * 12;
  const fraction = (now - new Date(2026, 0, 1)) / (new Date(2027, 0, 1) - new Date(2026, 0, 1));
  const fuel = 2000 * 20.72 * 0.061;
  assert.equal(own.sharingCost, 16700);
  assert.equal(own.ownershipCost, Math.round(fullYearFixed * fraction + fuel));
  assert.ok(own.yearFraction > 0.83 && own.yearFraction < 0.84, `${own.yearFraction}`);
  // Hele årets faste kostnader mot ti måneders bildeling ga ca. 92 000 kr spart.
  assert.ok(own.savings < 76000, `${own.savings}`);

  const done = estimateOwnershipCost(r, 2026, DONE);
  assert.equal(done.yearFraction, 1);
  assert.equal(done.ownershipCost, Math.round(fullYearFixed + fuel));
});
