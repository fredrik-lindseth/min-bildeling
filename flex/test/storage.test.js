import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePlaces, DEFAULT_PLACES } from "../lib/storage.js";

test("DEFAULT_PLACES er tom, ingen personlige steder i koden", () => {
  assert.deepEqual(DEFAULT_PLACES, []);
});

test("mergePlaces overstyrer default med lagret på samme id", () => {
  const saved = [{ id: "home", name: "Hjemme", point: { lng: 1, lat: 2 } }];
  const merged = mergePlaces([{ id: "home", name: "Standard", point: { lng: 0, lat: 0 } }], saved);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Hjemme");
});

test("mergePlaces beholder default som ikke er overstyrt", () => {
  const merged = mergePlaces([{ id: "a", name: "A", point: {} }], [{ id: "b", name: "B", point: {} }]);
  assert.deepEqual(merged.map((p) => p.id).sort(), ["a", "b"]);
});
