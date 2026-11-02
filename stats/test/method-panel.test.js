// «Slik beregnes det»: tabellene skal vise de samme tallene som regnestykkene
// bruker, og alle panelene skal ha samme oppbygning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { methodModel, methodText, formatFactorValue, formatSourceDate } from "../lib/method-panel.js";
import { CO2_METHOD, CO2_PER_KM, PRIVATE_CAR_AVG_CO2, co2Comparison } from "../lib/co2.js";
import { AVERAGE_CAR, SOURCES as AVERAGE_CAR_SOURCES } from "../lib/snittbil.js";
import {
  TRANSPORT_METHOD,
  TRANSPORT_MODES,
  EGENBIL_CO2,
  TAXI_CO2_BEFORE_REQUIREMENT,
} from "../lib/transport.js";
import { OWNERSHIP_METHOD } from "../lib/ownership-cost.js";
import { REFERENCE_CAR as CAR } from "../lib/referansebil.js";
import { BOOKING_METHOD } from "../lib/stats.js";

const METHODS = { CO2_METHOD, TRANSPORT_METHOD, OWNERSHIP_METHOD, BOOKING_METHOD };
const valueOf = (method, label) => {
  const f = method.factors.find((x) => x.label === label);
  assert.ok(f, `mangler raden «${label}»`);
  return f.value;
};

test("alle panelene har én setning som innledning og ingen «vi»", () => {
  for (const [name, method] of Object.entries(METHODS)) {
    const sentences = method.intro.match(/[.!?](\s|$)/g) ?? [];
    assert.equal(sentences.length, 1, `${name}: ${method.intro}`);
    assert.doesNotMatch(methodText(method), /\bvi\b/i, name);
  }
});

test("hver faktor har navn, verdi, enhet og en kilde som finnes", () => {
  for (const [name, method] of Object.entries(METHODS)) {
    for (const f of method.factors ?? []) {
      assert.ok(f.label, name);
      const values = [].concat(f.value);
      assert.ok(values.every(Number.isFinite), `${name}: ${f.label}`);
      assert.ok(f.unit, `${name}: ${f.label} mangler enhet`);
    }
    // methodModel kaster på en ukjent kilde.
    const model = methodModel(method);
    // Ingen kilde i listen uten en rad som viser til den.
    assert.equal(model.sources.length, Object.keys(method.sources ?? {}).length, `${name}: kilde uten rad`);
    for (const s of model.sources) {
      assert.ok(s.name, name);
      if (s.url) assert.match(s.url, /^https:\/\//, s.name);
    }
    for (const s of Object.values(method.sources ?? {})) {
      if (s.date) assert.match(s.date, /^\d{4}-\d{2}(-\d{2})?$/, s.name);
    }
  }
});

test("CO₂-tabellen viser faktorene regnestykket bruker", () => {
  const range = (fuel) => {
    const v = Object.values(CO2_PER_KM[fuel]);
    return [Math.min(...v), Math.max(...v)];
  };
  assert.deepEqual(valueOf(CO2_METHOD, "Bensinbil"), range("Bensin"));
  assert.deepEqual(valueOf(CO2_METHOD, "Dieselbil"), range("Diesel"));
  assert.deepEqual(valueOf(CO2_METHOD, "Elbil"), range("Elektrisitet"));
  assert.equal(valueOf(CO2_METHOD, "Snitt for norske personbiler"), PRIVATE_CAR_AVG_CO2);
  assert.equal(valueOf(CO2_METHOD, "Kjørelengde per personbil"), AVERAGE_CAR.kmPerCar.value);
  assert.equal(CO2_METHOD.factors.length, Object.keys(CO2_PER_KM).length + 2, "et nytt drivstoff mangler i tabellen");

  // Begge SSB-tabellene står som kilder med lenke og dato.
  const sources = methodModel(CO2_METHOD).sources;
  for (const s of Object.values(AVERAGE_CAR_SOURCES)) {
    const shown = sources.find((x) => x.name === s.name);
    assert.ok(shown, s.name);
    assert.ok(shown.url, `${s.name} mangler lenke`);
    assert.notEqual(shown.date, "udatert", `${s.name} mangler dato`);
  }

  // Sammenligningen regner faktisk med snittet i tabellen.
  const trip = { start: "2026-03-01T10:00:00Z", price: { total: 100 }, drivenKm: 100, canceled: null, noTrips: false,
    car: { category: "Småbil", properties: [{ groupKey: "FUEL_TYPE", name: "Elektrisitet" }] } };
  assert.equal(co2Comparison([trip]).privateCO2Kg, (100 * PRIVATE_CAR_AVG_CO2) / 1000);
});

test("transporttabellen viser faktorene og navnene fra TRANSPORT_MODES", () => {
  for (const [key, mode] of Object.entries(TRANSPORT_MODES)) {
    if (typeof mode.co2PerKm !== "number") continue;
    const row = TRANSPORT_METHOD.factors.find((f) => f.label.startsWith(mode.label));
    assert.ok(row, `mangler rad for ${key}`);
    assert.equal(row.value, mode.co2PerKm, key);
  }
  for (const [fuel, value] of Object.entries(EGENBIL_CO2)) {
    assert.equal(valueOf(TRANSPORT_METHOD, `Egen bil, ${fuel}`), value);
  }
  assert.equal(valueOf(TRANSPORT_METHOD, "Taxi før nullutslippskravet"), TAXI_CO2_BEFORE_REQUIREMENT);
  assert.match(methodText(TRANSPORT_METHOD), /Hordaland-tallet brukes også for Trøndelag/);
});

test("eierkostnadstabellen viser forutsetningene fra referansebil.js", () => {
  const rows = [
    ["Pris, ny bil", CAR.price],
    ["Verditap over tre år", CAR.depreciation],
    ["Forsikring med 75 % bonus", CAR.insurance],
    ["Trafikkforsikringsavgift", CAR.trafficInsuranceTax],
    ["Vedlikehold og service", CAR.maintenance],
    ["Dekk", CAR.tyresPerKm],
    ["Strømforbruk", CAR.kWhPerKm],
    ["Hjemmelading, 80 % av ladingen", CAR.homeChargingKrPerKWh],
    ["Hurtiglading, 20 % av ladingen", CAR.fastChargingKrPerKWh],
    ["Kjørelengde i OFV-tallene", CAR.ofvKmPerYear],
  ];
  for (const [label, entry] of rows) {
    const f = OWNERSHIP_METHOD.factors.find((x) => x.label === label);
    assert.ok(f, `mangler raden «${label}»`);
    assert.equal(f.value, entry.value, label);
    assert.ok([].concat(f.source).includes(entry.source), `${label}: feil kilde`);
  }
  assert.equal(CAR.fastChargingShare.value, 0.2, "andelene i etikettene over må følge med");
  for (const p of Object.values(CAR.parking)) {
    const f = OWNERSHIP_METHOD.factors.find((x) => x.label.startsWith(`Boligsoneparkering i ${p.city}`));
    assert.ok(f, p.city);
    assert.equal(f.value, p.perMonth);
    assert.equal(f.source, p.source);
  }
  assert.equal(OWNERSHIP_METHOD.factors.length, rows.length + Object.keys(CAR.parking).length);
});

test("modellen nummererer kildene og gir like merknader samme bokstav", () => {
  const model = methodModel({
    intro: "Én setning.",
    factors: [
      { label: "A", value: 1.5, unit: "kr", note: "Felles.", source: "b" },
      { label: "B", value: [95, 170], unit: "g/km", note: "Felles.", source: ["a", "b"] },
      { label: "C", value: 0, unit: "g/km" },
    ],
    notes: ["Generelt."],
    sources: { a: { name: "Kilde A", url: "https://a.example", date: "2021-03" }, b: { name: "Kilde B", date: "2026-11-01", dateLabel: "lest" } },
  });
  // En kilde uten dato sier det, framfor å stå som om den var ny.
  const undated = methodModel({ intro: "x.", factors: [{ label: "X", value: 1, unit: "kr", source: "u" }], sources: { u: { name: "Uten dato" } } });
  assert.equal(undated.sources[0].date, "udatert");
  assert.deepEqual(model.rows.map((r) => [r.value, r.noteMark, r.sources]), [
    ["1,5 kr", "a", [1]],
    ["95–170 g/km", "a", [2, 1]],
    ["0 g/km", null, []],
  ]);
  assert.deepEqual(model.notes, [{ mark: "a", text: "Felles." }, { mark: null, text: "Generelt." }]);
  assert.deepEqual(model.sources.map((s) => [s.number, s.name, s.date]), [[1, "Kilde B", "lest 01.11.2026"], [2, "Kilde A", "mars 2021"]]);
  assert.throws(() => methodModel({ intro: "x.", factors: [{ label: "X", value: 1, unit: "kr", source: "mangler" }], sources: {} }), /mangler/);
});

test("verdier og datoer formateres på norsk", () => {
  assert.equal(formatFactorValue(439900, "kr"), "439 900 kr");
  assert.equal(formatFactorValue(0.433, "kr/km"), "0,433 kr/km");
  assert.equal(formatFactorValue([0, 0], "g/km"), "0 g/km");
  assert.equal(formatSourceDate("2026-06-16"), "16.06.2026");
  assert.equal(formatSourceDate(undefined), "");
});
