import { test } from "node:test";
import assert from "node:assert/strict";
import { representativePoint, stationPlaces } from "../lib/places.js";

test("representativePoint: Point gir punktet selv", () => {
  assert.deepEqual(representativePoint({ type: "Point", coordinates: [10, 20] }), { lng: 10, lat: 20 });
});

test("representativePoint: LineString gir gjennomsnittet", () => {
  assert.deepEqual(
    representativePoint({ type: "LineString", coordinates: [[0, 0], [2, 4]] }),
    { lng: 1, lat: 2 },
  );
});

test("representativePoint: Polygon teller ikke lukkepunktet dobbelt", () => {
  const ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  assert.deepEqual(representativePoint({ type: "Polygon", coordinates: [ring] }), { lng: 2, lat: 2 });
});

test("representativePoint: tåler geojson som streng og ukjent type", () => {
  assert.deepEqual(representativePoint('{"type":"Point","coordinates":[1,2]}'), { lng: 1, lat: 2 });
  assert.equal(representativePoint({ type: "MultiPoint", coordinates: [] }), null);
  assert.equal(representativePoint(null), null);
  assert.equal(representativePoint("ikke json"), null);
});

test("stationPlaces: prefiksert id, alfabetisk, uten geometriløse", () => {
  const places = stationPlaces([
    { id: "b", name: "Øvre gate", geojson: { type: "Point", coordinates: [1, 1] } },
    { id: "a", name: "Asylplassen", geojson: { type: "Point", coordinates: [2, 2] } },
    { id: "c", name: "Uten geometri", geojson: null },
  ]);
  assert.deepEqual(places.map((p) => p.id), ["station:a", "station:b"]);
});

test("stationPlaces: godtar side-objekt med content", () => {
  const places = stationPlaces({ content: [{ id: "x", name: "X", geojson: { type: "Point", coordinates: [0, 0] } }] });
  assert.equal(places.length, 1);
});
