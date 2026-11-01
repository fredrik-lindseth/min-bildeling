import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLocalISO } from "../lib/format.js";
import { freeBlocks, fitCar, clippedSegments, solve, splitPairs } from "../lib/flex.js";

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/search-sample.json", import.meta.url)))
);

const seg = (start, end, state) => ({ start, end, state, stateLabel: state });

test("freeBlocks henter kun AVAILABLE og klipper til vinduet", () => {
  const availability = [
    seg("2026-07-07T07:00:00", "2026-07-07T09:00:00", "AVAILABLE"),
    seg("2026-07-07T09:00:00", "2026-07-11T18:00:00", "RESERVED"),
    seg("2026-07-11T18:00:00", "2026-07-12T09:00:00", "AVAILABLE"),
  ];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T08:00:00"),
    parseLocalISO("2026-07-12T00:00:00")
  );
  assert.equal(blocks.length, 2);
  // første blokk klippet til vindusstart 08:00, ikke 07:00
  assert.equal(blocks[0].start.getTime(), parseLocalISO("2026-07-07T08:00:00").getTime());
  assert.equal(blocks[0].end.getTime(), parseLocalISO("2026-07-07T09:00:00").getTime());
  // andre blokk klippet til vindusslutt 00:00, ikke 09:00
  assert.equal(blocks[1].end.getTime(), parseLocalISO("2026-07-12T00:00:00").getTime());
});

test("freeBlocks utelater segmenter uten overlapp med vinduet", () => {
  const availability = [seg("2026-07-01T00:00:00", "2026-07-02T00:00:00", "AVAILABLE")];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T00:00:00"),
    parseLocalISO("2026-07-08T00:00:00")
  );
  assert.equal(blocks.length, 0);
});

test("freeBlocks behandler UNAVAILABLE som ikke-ledig", () => {
  const availability = [seg("2026-07-07T00:00:00", "2026-07-08T00:00:00", "UNAVAILABLE")];
  const blocks = freeBlocks(
    availability,
    parseLocalISO("2026-07-07T00:00:00"),
    parseLocalISO("2026-07-08T00:00:00")
  );
  assert.equal(blocks.length, 0);
});

const car = (availability, extra = {}) => ({
  carId: "c1", carNumber: "948", model: "Toyota Yaris", carCategory: "Småbil",
  seats: 5, hourlyRate: 41, carProperties: [], location: { name: "Eksempelveien", distance: 166, id: "L" },
  availability, ...extra,
});

const wholeWindowWish = {
  earliestStart: parseLocalISO("2026-07-08T09:00:00"),
  latestEnd: parseLocalISO("2026-07-10T17:00:00"),
  durationMinutes: null,
  filters: {},
};

test("fitCar: fri hele vinduet -> fits + coversWholeWindow", () => {
  const f = fitCar(car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")]), wholeWindowWish);
  assert.equal(f.kind, "fits");
  assert.equal(f.coversWholeWindow, true);
  assert.equal(f.shiftMinutes, 0);
});

test("fitCar: opptatt i midten, hele-vinduet-modus -> short", () => {
  const f = fitCar(car([
    seg("2026-07-08T09:00:00", "2026-07-09T12:00:00", "AVAILABLE"),
    seg("2026-07-09T12:00:00", "2026-07-10T17:00:00", "RESERVED"),
  ]), wholeWindowWish);
  assert.equal(f.kind, "short");
  assert.equal(f.coversWholeWindow, false);
  assert.ok(f.shortfallMinutes > 0);
});

test("fitCar: varighetsmodus finner blokk >= varighet og skyver start", () => {
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-12T09:00:00"),
    durationMinutes: 24 * 60, // 1 døgn
    filters: {},
  };
  const f = fitCar(car([
    seg("2026-07-08T09:00:00", "2026-07-09T00:00:00", "RESERVED"),
    seg("2026-07-09T00:00:00", "2026-07-12T09:00:00", "AVAILABLE"),
  ]), wish);
  assert.equal(f.kind, "fits");
  assert.equal(f.coversWholeWindow, false);
  assert.equal(f.proposed.start.getTime(), parseLocalISO("2026-07-09T00:00:00").getTime());
  assert.equal(f.proposed.end.getTime(), parseLocalISO("2026-07-10T00:00:00").getTime());
  assert.ok(f.shiftMinutes > 0);
});

test("fitCar: ingen ledig tid -> none", () => {
  const f = fitCar(car([seg("2026-07-08T09:00:00", "2026-07-10T17:00:00", "RESERVED")]), wholeWindowWish);
  assert.equal(f.kind, "none");
  assert.equal(f.proposed, null);
});

test("fitCar returnerer segments (alle states) klippet til vinduet", () => {
  const f = fitCar(car([
    seg("2026-07-01T00:00:00", "2026-07-09T00:00:00", "AVAILABLE"),
    seg("2026-07-09T00:00:00", "2026-07-20T00:00:00", "RESERVED"),
  ]), wholeWindowWish);
  assert.equal(f.segments.length, 2);
  assert.equal(f.segments[0].state, "AVAILABLE");
  // klippet til vindusstart 09:00 08.07, ikke 01.07
  assert.equal(f.segments[0].start.getTime(), wholeWindowWish.earliestStart.getTime());
  assert.equal(f.segments[1].state, "RESERVED");
});

test("clippedSegments dropper segmenter uten overlapp", () => {
  const segs = clippedSegments(
    [seg("2026-07-01T00:00:00", "2026-07-02T00:00:00", "RESERVED")],
    parseLocalISO("2026-07-08T00:00:00"),
    parseLocalISO("2026-07-09T00:00:00")
  );
  assert.equal(segs.length, 0);
});

function result(cars) { return { cars }; }

test("solve deler i whole og adjusted", () => {
  const freeAll = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")], { carId: "free" });
  const partial = car([seg("2026-07-08T09:00:00", "2026-07-09T00:00:00", "AVAILABLE"),
                       seg("2026-07-09T00:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "part" });
  const out = solve(result([partial, freeAll]), wholeWindowWish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["free"]);
  assert.deepEqual(out.adjusted.map((f) => f.carId), ["part"]);
});

test("solve filtrerer på kategori og maks distanse", () => {
  const near = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                   { carId: "near", location: { name: "A", distance: 200, id: "A" } });
  const far = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                  { carId: "far", location: { name: "B", distance: 5000, id: "B" } });
  const suv = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                  { carId: "suv", carCategory: "SUV" });
  const wish = { ...wholeWindowWish, filters: { category: "Småbil", maxDistanceM: 1000 } };
  const out = solve(result([near, far, suv]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["near"]);
});

test("solve filtrerer på categories-array (biltype-brikker)", () => {
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const smaabil = car(avail(), { carId: "s", carCategory: "Småbil" });
  const kombi = car(avail(), { carId: "k", carCategory: "Kombi" });
  const suv = car(avail(), { carId: "u", carCategory: "SUV" });
  const wish = { ...wholeWindowWish, filters: { categories: ["Kombi", "SUV"] } };
  const out = solve(result([smaabil, kombi, suv]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId).sort(), ["k", "u"]);
});

const ORG_BERGEN = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";
const ORG_TRONDHEIM = "8dba8f19-c438-f278-ed7c-912ec6537cb9";

test("solve tar med biler fra alle bilkollektivene på dele.no", () => {
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const bdl = car(avail(), { carId: "bdl", organizationId: ORG_BERGEN });
  const trd = car(avail(), { carId: "trd", organizationId: ORG_TRONDHEIM });
  const out = solve(result([bdl, trd]), wholeWindowWish);
  assert.deepEqual(out.whole.map((f) => f.carId).sort(), ["bdl", "trd"]);
});

test("solve ignorerer organizationId fra eldre lagrede filtre", () => {
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const bdl = car(avail(), { carId: "bdl", organizationId: ORG_BERGEN });
  const trd = car(avail(), { carId: "trd", organizationId: ORG_TRONDHEIM });
  const wish = { ...wholeWindowWish, filters: { organizationId: ORG_BERGEN } };
  const out = solve(result([bdl, trd]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId).sort(), ["bdl", "trd"]);
});

test("avstandstaket regnes fra det valgte stedet, uansett by", () => {
  // Søket fra Trondheim: Trondheim-bilene er nær, Bergen og Tromsø langt unna.
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const trd = car(avail(), { carId: "trd", organizationId: ORG_TRONDHEIM, location: { id: "t", name: "T", distance: 3000 } });
  const bgo = car(avail(), { carId: "bgo", organizationId: ORG_BERGEN, location: { id: "b", name: "B", distance: 430000 } });
  const tos = car(avail(), { carId: "tos", organizationId: ORG_BERGEN, location: { id: "x", name: "X", distance: 790000 } });
  const wish = { ...wholeWindowWish, filters: { maxDistanceM: 100000 } };
  const out = solve(result([trd, bgo, tos]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["trd"]);
});

test("excludeCategories slipper gjennom biltyper finderen ikke kjenner", () => {
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const smaabil = car(avail(), { carId: "s", carCategory: "Småbil" });
  const kombi = car(avail(), { carId: "k", carCategory: "Kombi" });
  const ukjent = car(avail(), { carId: "u", carCategory: "Kompakt SUV" });
  const wish = { ...wholeWindowWish, filters: { excludeCategories: ["Småbil", "Varebil"] } };
  const out = solve(result([smaabil, kombi, ukjent]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId).sort(), ["k", "u"]);
});

test("solve filtrerer på fuels-array (drivstoff-brikker)", () => {
  const prop = (name) => [{ carPropertyName: name, carPropertyGroup: "Drivstoff" }];
  const avail = () => [seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")];
  const el = car(avail(), { carId: "el", carProperties: prop("Elektrisitet") });
  const bensin = car(avail(), { carId: "be", carProperties: prop("Bensin") });
  const wish = { ...wholeWindowWish, filters: { fuels: ["Elektrisitet"] } };
  const out = solve(result([el, bensin]), wish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["el"]);
});

test("solve rangerer whole nærmest først", () => {
  const a = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                { carId: "a", location: { name: "A", distance: 800, id: "A" } });
  const b = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                { carId: "b", location: { name: "B", distance: 150, id: "B" } });
  const out = solve(result([a, b]), wholeWindowWish);
  assert.deepEqual(out.whole.map((f) => f.carId), ["b", "a"]);
});

test("solve fyller siblings når målbilen er opptatt", () => {
  const target = car([seg("2026-07-08T09:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "target" });
  const sibling = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")],
                      { carId: "sib", location: { name: "Nær", distance: 300, id: "N" } });
  const wish = { ...wholeWindowWish, target: { carId: "target" } };
  const out = solve(result([target, sibling]), wish);
  assert.deepEqual(out.siblings.map((f) => f.carId), ["sib"]);
});

test("solve på realistisk fixture: free-1 er whole, part-1 er adjusted, far filtreres bort", () => {
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null,
    filters: { maxDistanceM: 2000 },
  };
  const out = solve(sample, wish);
  assert.ok(out.whole.some((f) => f.carId === "free-1"));
  assert.ok(out.adjusted.some((f) => f.carId === "part-1"));
  assert.ok(!out.whole.some((f) => f.carId === "far-1"));
  assert.ok(!out.adjusted.some((f) => f.carId === "far-1"));
});

test("splitPairs finner par med overlevering når ingen enkeltbil dekker", () => {
  const a = car([seg("2026-07-08T09:00:00", "2026-07-09T09:00:00", "AVAILABLE"),
                 seg("2026-07-09T09:00:00", "2026-07-10T17:00:00", "RESERVED")], { carId: "A" });
  const b = car([seg("2026-07-08T09:00:00", "2026-07-09T09:00:00", "RESERVED"),
                 seg("2026-07-09T09:00:00", "2026-07-10T17:00:00", "AVAILABLE")], { carId: "B" });
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null, filters: {},
  };
  const pairs = splitPairs({ cars: [a, b] }, wish);
  assert.ok(pairs.length >= 1);
  assert.equal(pairs[0].handover.getTime(), parseLocalISO("2026-07-09T09:00:00").getTime());
  assert.deepEqual([pairs[0].first.carId, pairs[0].second.carId], ["A", "B"]);
});

test("splitPairs gir ingen par når én bil dekker alt", () => {
  const full = car([seg("2026-07-01T00:00:00", "2026-07-20T00:00:00", "AVAILABLE")], { carId: "F" });
  const wish = {
    earliestStart: parseLocalISO("2026-07-08T09:00:00"),
    latestEnd: parseLocalISO("2026-07-10T17:00:00"),
    durationMinutes: null, filters: {},
  };
  // full dekker alt -> del-opp er unødvendig; splitPairs skal filtrere bort par der begge halvdeler er samme dekning
  const pairs = splitPairs({ cars: [full] }, wish);
  assert.equal(pairs.length, 0);
});
