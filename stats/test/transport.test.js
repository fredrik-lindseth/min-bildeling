// Forutsetningene for CO₂ og transport skal gjelde alle medlemmene i
// Bilparaplyen, ikke bare Bergen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSPORT_MODES, TRANSPORT_METHOD, transportSummary } from "../lib/transport.js";
import { CO2_METHOD } from "../lib/co2.js";

test("taxi teller 0 g/km, med nullutslippskravet i begge fylkene som kilde", () => {
  assert.equal(TRANSPORT_MODES.taxi.co2PerKm, 0);
  const sources = TRANSPORT_METHOD.sources.join("\n");
  assert.match(sources, /Vestland.*2024/);
  assert.match(sources, /Trøndelag.*2025/);
  const s = transportSummary({ taxi: { trips: 4, totalKm: 40, totalCost: 1200 } }, null);
  assert.equal(s.modes.taxi.co2Kg, 0);
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
