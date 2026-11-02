// Tallene her er regnet for hånd fra OFVs «Kostnader ved bilhold 2026»,
// elbil eksempel 3 og 4, kolonnen 10 000 km/år. Endres en forutsetning i
// referansebil.js, skal forventningen her endres med.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateOwnershipCost,
  COMPARISON_CAR,
  OWNERSHIP_METHOD,
  homeOrganizationId,
  regionForOrganization,
} from "../lib/ownership-cost.js";
import { REFERENCE_CAR, SOURCES } from "../lib/referansebil.js";

const BILDELERINGEN = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";
const TRONDHEIM = "8dba8f19-c438-f278-ed7c-912ec6537cb9";
// Etter årsskiftet er 2026 et helt år, så faste kostnader telles fullt.
const DONE = { now: new Date(2027, 0, 1) };

// Volvo EX40 til 600 000 kr ligger 0,25 av veien fra OFVs elbileksempel
// til 550 000 kr mot eksempelet til 750 000 kr.
const T = (600000 - 550000) / (750000 - 550000);
const ofv = (lo, hi) => lo + T * (hi - lo);
const DEPRECIATION = Math.round(ofv(65741, 94002));
const INSURANCE = Math.round(ofv(3228, 3051)) + Math.round(ofv(11720, 13518));
const MAINTENANCE = Math.round(ofv(7687, 7687)) + Math.round(ofv(3694, 4108));
const TAX = 3343;
const FIXED_WITHOUT_PARKING = DEPRECIATION + INSURANCE + TAX + MAINTENANCE;
// Dekk og strøm per km: OFV post 8, og forbruk i kWh/mil delt på 10 ganger
// 80 % hjemmelading til 1,05 kr og 20 % hurtiglading til 5,47 kr.
const TYRES_PER_KM = 0.53;
const ENERGY_PER_KM = 0.172 * (0.8 * 1.05 + 0.2 * 5.47);

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

test("referansebilen er interpolert mellom OFVs elbileksempler", () => {
  assert.equal(Math.round(ofv(5019, 6147)) / 10000, 0.5301);
  assert.equal(Math.round(ofv(0.168, 0.183) * 1000) / 1000, 0.172);
  assert.deepEqual(COMPARISON_CAR.costs, {
    depreciation: DEPRECIATION,
    insurance: INSURANCE,
    tax: TAX,
    maintenance: MAINTENANCE,
  });
  assert.equal(COMPARISON_CAR.name, "Volvo EX40");
  assert.equal(COMPARISON_CAR.price, 600000);
  assert.equal(COMPARISON_CAR.tyresPerKm, TYRES_PER_KM);
  assert.ok(Math.abs(COMPARISON_CAR.energyPerKm - ENERGY_PER_KM) < 1e-9);
});

test("hver forutsetning har kilde og dato", () => {
  const values = Object.entries(REFERENCE_CAR).filter(([, v]) => v && typeof v === "object" && "value" in v);
  assert.ok(values.length >= 12, `${values.length}`);
  const entries = [...values, ...Object.entries(REFERENCE_CAR.parking)];
  for (const [key, v] of entries) {
    assert.ok(SOURCES[v.source], `${key} mangler kilde`);
    assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/, `${key} mangler dato`);
  }
  for (const source of Object.values(SOURCES)) {
    assert.match(source.date, /^\d{4}-\d{2}-\d{2}$/, `kilden mangler dato: ${source.name}`);
    assert.match(source.url, /^https:\/\//, source.name);
  }
});

test("bilkategori og drivstoff på turene endrer ikke sammenligningen", () => {
  const small = estimateOwnershipCost([trip({ start: "2026-03-01T10:00:00Z", km: 500 })], 2026, DONE);
  const suv = estimateOwnershipCost(
    [trip({ start: "2026-03-01T10:00:00Z", km: 500, category: "SUV", fuel: "Diesel" })], 2026, DONE);
  assert.equal(small.ownershipCost, suv.ownershipCost);
  assert.equal(suv.carName, "Volvo EX40");
  assert.equal(suv.breakdownOwnership.tax, 3343);
});

test("faste kostnader for et helt år, dekk og strøm per kjørte km", () => {
  const r = [trip({ start: "2026-03-01T10:00:00Z", km: 60 }), trip({ start: "2026-04-01T10:00:00Z", km: 40 })];
  const own = estimateOwnershipCost(r, 2026, DONE);
  assert.deepEqual(own.breakdownOwnership, {
    depreciation: DEPRECIATION,
    insurance: INSURANCE,
    tax: TAX,
    maintenance: MAINTENANCE,
    parking: 582 * 12,
    tyres: Math.round(100 * TYRES_PER_KM),
    energy: Math.round(100 * ENERGY_PER_KM),
  });
  assert.equal(own.sharingCost, 1000);
  assert.equal(own.totalKm, 100);
  assert.equal(own.ownershipCost,
    Math.round(FIXED_WITHOUT_PARKING + 582 * 12 + 100 * (TYRES_PER_KM + ENERGY_PER_KM)));
});

test("«spart i år» for et realistisk medlem per 1. november", () => {
  // Stasjonsvogn på bensin, 20 turer à 100 km og 835 kr fra januar til
  // oktober: 2 000 km og 16 700 kr. Bilen på turene spiller ingen rolle.
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

  const fullYearFixed = FIXED_WITHOUT_PARKING + 582 * 12;
  const fraction = (now - new Date(2026, 0, 1)) / (new Date(2027, 0, 1) - new Date(2026, 0, 1));
  const variable = 2000 * (TYRES_PER_KM + ENERGY_PER_KM);
  assert.equal(own.sharingCost, 16700);
  assert.equal(own.totalKm, 2000);
  assert.ok(own.yearFraction > 0.83 && own.yearFraction < 0.84, `${own.yearFraction}`);
  assert.equal(own.ownershipCost, Math.round(fullYearFixed * fraction + variable));
  assert.equal(own.ownershipCost, 93318);
  assert.equal(own.savings, 76618);

  const done = estimateOwnershipCost(r, 2026, DONE);
  assert.equal(done.yearFraction, 1);
  assert.equal(done.ownershipCost, Math.round(fullYearFixed + variable));
});

test("uten år regnes kilometer og bildeling om til ett år", () => {
  const r = [
    trip({ start: "2025-01-01T00:00:00Z", km: 1000, total: 5000 }),
    trip({ start: "2027-01-01T00:00:00Z", km: 1000, total: 5000 }),
  ];
  const own = estimateOwnershipCost(r, null);
  // To år mellom første og siste tur: 1 000 km og 5 000 kr per år.
  assert.ok(Math.abs(own.totalKm - 1000) <= 1, `${own.totalKm}`);
  assert.ok(Math.abs(own.sharingCost - 5000) <= 5, `${own.sharingCost}`);
  assert.equal(own.breakdownOwnership.depreciation, DEPRECIATION);
});

test("«Slik beregnes det» navngir bilen, OFVs 10 000 km og begge byene", () => {
  const { intro, factors, sources } = OWNERSHIP_METHOD;
  assert.ok(intro.includes("en ny Volvo EX40, "));
  const value = (label) => factors.find((f) => f.label.startsWith(label))?.value;
  assert.equal(value("Pris"), 600000);
  assert.equal(value("Kjørelengde"), 10000);
  assert.equal(value("Boligsoneparkering i Bergen"), 582);
  assert.equal(value("Boligsoneparkering i Trondheim"), 785);
  assert.ok(sources.ofv.name.startsWith("OFV"));
  assert.ok(sources.trondheim.name.startsWith("Trondheim kommune"));
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
  assert.equal(own.parkingCity, "Trondheim");
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

test("ingen kjørte turer i året gir null", () => {
  assert.equal(estimateOwnershipCost([trip({ start: "2025-03-01T10:00:00Z" })], 2026, DONE), null);
  assert.equal(estimateOwnershipCost([], null), null);
});
