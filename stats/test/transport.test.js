// Forutsetningene for CO₂ og transport skal gjelde alle medlemmene i
// Bilparaplyen, ikke bare Bergen.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPORT_MODES,
  TRANSPORT_METHOD,
  TAXI_CO2_BEFORE_REQUIREMENT,
  taxiCO2PerKm,
  transportSummary,
} from "../lib/transport.js";
import { CO2_METHOD } from "../lib/co2.js";

const BILDELERINGEN = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";
const TRONDHEIM = "8dba8f19-c438-f278-ed7c-912ec6537cb9";

test("taxi teller 0 g/km etter nullutslippskravet, med begge fylkene som kilde", () => {
  assert.equal(TRANSPORT_MODES.taxi.co2PerKm, null, "faktoren følger året");
  const sources = TRANSPORT_METHOD.sources.join("\n");
  assert.match(sources, /Vestland.*2024/);
  assert.match(sources, /Trøndelag.*2025/);
  // Bare eksos er med, så teksten skal si det framfor å love nullutslipp.
  assert.match(TRANSPORT_METHOD.note, /eksos/);
  const s = transportSummary({ taxi: { trips: 4, totalKm: 40, totalCost: 1200 } }, null, { year: 2026 });
  assert.equal(s.modes.taxi.co2Kg, 0);
});

test("taxi før kravet bruker det gamle drosjesnittet, vektet året kravet kom", () => {
  assert.equal(TAXI_CO2_BEFORE_REQUIREMENT, 229);
  assert.match(TRANSPORT_METHOD.note, /229 g\/km/);
  assert.ok(TRANSPORT_METHOD.sources.some((s) => /Vestland fylkeskommune.*2021/.test(s)));

  // Bildeleringen og ukjent organisasjon: gamle Hordaland, krav fra 1. april 2024.
  assert.equal(taxiCO2PerKm(2023, BILDELERINGEN), 229);
  assert.ok(Math.abs(taxiCO2PerKm(2024, BILDELERINGEN) - 229 * 91 / 366) < 1e-9);
  assert.equal(taxiCO2PerKm(2025, BILDELERINGEN), 0);
  assert.equal(taxiCO2PerKm(2023, "ukjent"), 229);

  // Trondheim Bilkollektiv: Trøndelag, krav fra 1. juli 2025.
  assert.equal(taxiCO2PerKm(2024, TRONDHEIM), 229);
  assert.ok(Math.abs(taxiCO2PerKm(2025, TRONDHEIM) - 229 * 181 / 365) < 1e-9);
  assert.equal(taxiCO2PerKm(2026, TRONDHEIM), 0);

  const old = transportSummary({ taxi: { trips: 4, totalKm: 100, totalCost: 1200 } }, null,
    { year: "2023", organizationId: BILDELERINGEN });
  assert.equal(old.modes.taxi.co2Kg, 22.9);
});

test("buss bruker SSBs nasjonale tall", () => {
  assert.equal(TRANSPORT_MODES.buss.co2PerKm, 59);
  assert.ok(TRANSPORT_METHOD.sources.some((s) => /^SSB.*\d{4}/.test(s)));
  const s = transportSummary({ buss: { trips: 10, totalKm: 100, totalCost: 400 } }, null);
  assert.equal(s.modes.buss.co2Kg, 5.9);
});

test("forutsetningene for CO₂ og transport nevner ingen enkeltby", () => {
  const text = [
    TRANSPORT_METHOD.note,
    ...TRANSPORT_METHOD.sources,
    CO2_METHOD.note,
    CO2_METHOD.comparison,
    ...CO2_METHOD.sources,
    ...Object.values(TRANSPORT_MODES).map((m) => m.label),
  ].join("\n");
  assert.doesNotMatch(text, /\b(Bergen|Skyss|bybane|Trondheim|AtB)\b/i);
});
