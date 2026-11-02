// Forutsetningene for CO₂ og transport skal gjelde alle medlemmene i
// Bilparaplyen, ikke bare Bergen.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPORT_MODES,
  TRANSPORT_METHOD,
  TAXI_CO2_BEFORE_REQUIREMENT,
  taxiCO2PerKm,
  taxiZeroEmissionFrom,
  TAXI_ZERO_EMISSION_FROM,
  transportSummary,
  hasTransportEntries,
} from "../lib/transport.js";
import { CO2_METHOD } from "../lib/co2.js";
import { methodText } from "../lib/method-panel.js";
import { REFERENCE_CAR as CAR } from "../lib/referansebil.js";

const BILDELERINGEN = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";
const TRONDHEIM = "8dba8f19-c438-f278-ed7c-912ec6537cb9";

test("taxi teller 0 g/km etter nullutslippskravet, med begge fylkene som kilde", () => {
  assert.equal(TRANSPORT_MODES.taxi.co2PerKm, null, "faktoren følger året");
  const { factors, sources, notes } = TRANSPORT_METHOD;
  const zero = factors.filter((f) => f.value === 0 && f.label.startsWith("Taxi"));
  assert.deepEqual(zero.map((f) => f.label), ["Taxi i gamle Hordaland fra 1. april 2024", "Taxi i Trøndelag fra 1. juli 2025"]);
  assert.match(sources[zero[0].source].name, /Vestland/);
  assert.match(sources[zero[1].source].name, /Trøndelag/);
  // Bare eksos er med, så teksten skal si det framfor å love nullutslipp.
  assert.ok(notes.some((n) => /eksos/.test(n)));
  const s = transportSummary({ taxi: { trips: 4, totalKm: 40, totalCost: 1200 } }, null, { year: 2026 });
  assert.equal(s.modes.taxi.co2Kg, 0);
});

test("taxi før kravet bruker det gamle drosjesnittet, vektet året kravet kom", () => {
  assert.equal(TAXI_CO2_BEFORE_REQUIREMENT, 229);
  const before = TRANSPORT_METHOD.factors.find((f) => f.value === 229);
  assert.match(before.note, /Hordaland-tallet brukes også for Trøndelag/);
  assert.match(TRANSPORT_METHOD.sources[before.source].name, /^Vestland fylkeskommune/);
  assert.match(TRANSPORT_METHOD.sources[before.source].date, /^2021/);

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

test("taxi i en by uten eget krav i tabellen regnes som Bergen, ikke NaN", () => {
  assert.equal(taxiZeroEmissionFrom("oslo"), TAXI_ZERO_EMISSION_FROM.bergen);
  assert.equal(taxiZeroEmissionFrom(null), TAXI_ZERO_EMISSION_FROM.bergen);
  // Hver by i bilregnestykket skal ha sin egen dato, så fallbacken ikke skjuler en ny by.
  for (const { city } of Object.values(CAR.parking)) {
    assert.ok(city.toLowerCase() in TAXI_ZERO_EMISSION_FROM, `mangler drosjekrav for ${city}`);
  }
  for (const year of [2023, 2024, 2025, 2026]) {
    assert.ok(Number.isFinite(taxiCO2PerKm(year, "ukjent")));
  }
});

test("buss bruker SSBs nasjonale tall", () => {
  assert.equal(TRANSPORT_MODES.buss.co2PerKm, 59);
  const bus = TRANSPORT_METHOD.factors.find((f) => f.label.startsWith(TRANSPORT_MODES.buss.label));
  assert.equal(bus.value, 59);
  assert.match(TRANSPORT_METHOD.sources[bus.source].name, /^SSB/);
  const s = transportSummary({ buss: { trips: 10, totalKm: 100, totalCost: 400 } }, null);
  assert.equal(s.modes.buss.co2Kg, 5.9);
});

test("forutsetningene for CO₂ og transport nevner ingen enkeltby", () => {
  const text = [
    methodText(TRANSPORT_METHOD),
    methodText(CO2_METHOD),
    ...Object.values(TRANSPORT_MODES).map((m) => m.label),
  ].join("\n");
  assert.doesNotMatch(text, /\b(Bergen|Skyss|bybane|Trondheim|AtB)\b/i);
});

test("et år har transporttall bare når et tallfelt er over null", () => {
  assert.equal(hasTransportEntries({}), false);
  assert.equal(hasTransportEntries(undefined), false);
  assert.equal(hasTransportEntries({ buss: { trips: 0 } }), false);
  assert.equal(hasTransportEntries({ buss: { trips: 3 } }), true);
  assert.equal(hasTransportEntries({ egenbil: { fuelType: "elbil" } }), false);
  const s = transportSummary({ buss: { trips: 0 }, egenbil: { fuelType: "elbil" }, fly: { trips: 2 } }, null);
  assert.deepEqual(Object.keys(s.modes), ["fly"]);
});
