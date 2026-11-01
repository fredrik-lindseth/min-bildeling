import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHits, reconcile } from "../lib/watch.js";

function parseEnd(s) {
  const [d, t] = s.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, se] = t.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, se || 0);
}
function hit(carId, endLocalISO) {
  return { carId, carNumber: "#1", model: "Yaris", category: "Småbil",
           location: { name: "L", distance: 10 },
           blockStart: new Date(2026, 6, 20, 9),
           blockEnd: parseEnd(endLocalISO),
           blockHours: 100 };
}

function car(over = {}) {
  return {
    carId: "c1", carNumber: "#948", model: "Yaris", carCategory: "Småbil",
    organizationId: "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0", seats: 5, carProperties: [],
    location: { id: "loc1", name: "Eksempelveien", distance: 166 },
    availability: [{ start: "2026-07-20T09:00:00", end: "2026-07-24T17:00:00", state: "AVAILABLE" }],
    ...over,
  };
}
const WIN = { start: new Date(2026, 6, 20, 9), end: new Date(2026, 6, 24, 17) };
const watch = (over = {}) => ({ minHours: 24, filters: {}, ...over });

test("detectHits gir treff for blokk over terskel", () => {
  const hits = detectHits({ cars: [car()] }, watch(), WIN);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].carId, "c1");
  assert.equal(hits[0].model, "Yaris");
  assert.ok(hits[0].blockHours >= 24);
});

test("detectHits dropper blokk under terskel", () => {
  const kort = car({ availability: [{ start: "2026-07-20T09:00:00", end: "2026-07-20T15:00:00", state: "AVAILABLE" }] });
  assert.equal(detectHits({ cars: [kort] }, watch({ minHours: 24 }), WIN).length, 0);
});

test("detectHits gir treff fra andre bilkollektiv, også med gammelt organisasjonsfilter", () => {
  const annen = car({ carId: "c2", organizationId: "8dba8f19-c438-f278-ed7c-912ec6537cb9" });
  const gammel = watch({ filters: { organizationId: "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0" } });
  const hits = detectHits({ cars: [annen] }, gammel, WIN);
  assert.equal(hits.length, 1);
});

test("detectHits gir ett treff per ledig blokk", () => {
  const toblokk = car({ availability: [
    { start: "2026-07-20T09:00:00", end: "2026-07-22T09:00:00", state: "AVAILABLE" },
    { start: "2026-07-22T09:00:00", end: "2026-07-23T09:00:00", state: "RESERVED" },
    { start: "2026-07-23T09:00:00", end: "2026-07-24T17:00:00", state: "AVAILABLE" },
  ]});
  const hits = detectHits({ cars: [toblokk] }, watch({ minHours: 24 }), WIN);
  assert.equal(hits.length, 2);
});

test("reconcile: nytt treff gir browserHit + relayHit + oppføring", () => {
  const h = hit("c1", "2026-07-24T17:00:00");
  const r = reconcile([h], {}, new Date(2026, 6, 20, 10));
  assert.equal(r.browserHits.length, 1);
  assert.equal(r.relayHits.length, 1);
  assert.equal(r.notified["c1|2026-07-24T17:00:00"].relayed, false);
});

test("reconcile: samme blokk over to polls (etter vindusstart) gir ETT browser-varsel", () => {
  const h = hit("c1", "2026-07-24T17:00:00");
  const r1 = reconcile([h], {}, new Date(2026, 6, 20, 10));
  r1.notified["c1|2026-07-24T17:00:00"].relayed = true; // som om POST lyktes
  const r2 = reconcile([h], r1.notified, new Date(2026, 6, 20, 10, 15));
  assert.equal(r2.browserHits.length, 0);
  assert.equal(r2.relayHits.length, 0);
});

test("reconcile: relayed=false gir relayHit men ikke browserHit neste runde", () => {
  const h = hit("c1", "2026-07-24T17:00:00");
  const r1 = reconcile([h], {}, new Date(2026, 6, 20, 10));
  const r2 = reconcile([h], r1.notified, new Date(2026, 6, 20, 10, 15)); // POST feilet: relayed står false
  assert.equal(r2.browserHits.length, 0);
  assert.equal(r2.relayHits.length, 1);
});

test("reconcile: passert blokkslutt ryddes bort", () => {
  const notified = { "c1|2026-07-20T09:00:00": { notifiedAt: "x", relayed: true } };
  const r = reconcile([], notified, new Date(2026, 6, 20, 10));
  assert.deepEqual(r.notified, {});
});

test("reconcile: forlenget blokk (senere slutt) gir nytt varsel", () => {
  const notified = { "c1|2026-07-24T17:00:00": { notifiedAt: "x", relayed: true } };
  const lengre = hit("c1", "2026-07-26T17:00:00");
  const r = reconcile([lengre], notified, new Date(2026, 6, 20, 10));
  assert.equal(r.browserHits.length, 1);
  assert.ok(r.notified["c1|2026-07-26T17:00:00"]);
});
