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
} from "../lib/ownership-cost.js";

function trip({ start, category = "Småbil", fuel = "Elektrisitet", km = 50, total = 500 }) {
  return {
    start,
    canceled: null,
    noTrips: false,
    drivenKm: km,
    price: { total },
    car: { category, properties: [{ groupKey: "FUEL_TYPE", name: fuel }] },
  };
}

test("Småbil-elbil regnes som OFVs elbil til 300 000 kr", () => {
  const r = [trip({ start: "2026-03-01T10:00:00Z" }), trip({ start: "2026-04-01T10:00:00Z" })];
  const own = estimateOwnershipCost(r, 2026);
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
  const own = estimateOwnershipCost(r, 2026);
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
  const v = estimateVolvoComparison(r, 2026);
  assert.equal(v.carName, "Volvo EX40");
  assert.equal(v.sharingCost, 2000);
  assert.ok(v.ownershipCost > 90000 && v.ownershipCost < 95000, `${v.ownershipCost}`);
});

test("«Slik beregner vi» daterer hver kilde og navngir Bergen-forutsetningen", () => {
  for (const source of OWNERSHIP_METHOD.sources) {
    assert.match(source, /\d{4}/, `kilden mangler år: ${source}`);
  }
  assert.match(OWNERSHIP_METHOD.note, /Bergen/);
  assert.doesNotMatch(OWNERSHIP_METHOD.note, /EX C40/);
});
