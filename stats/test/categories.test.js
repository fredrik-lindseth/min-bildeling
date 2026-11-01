import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIES,
  DEFAULT_KEYWORDS,
  normalizeUserKeywords,
  parseKeywordInput,
  mergeKeywords,
  suggestCategory,
  keywordHits,
  autoSuggestAll,
  loadUserKeywords,
  saveUserKeywords,
} from "../lib/categories.js";

function trip(id, notes, extra = {}) {
  return { id, notes, canceled: null, noTrips: false, price: { total: 100 }, ...extra };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) { return key in data ? { [key]: data[key] } : {}; },
    async set(items) { Object.assign(data, items); },
  };
}

test("standardlisten bruker bare kjente kategorier", () => {
  for (const key of Object.keys(DEFAULT_KEYWORDS)) {
    assert.ok(CATEGORIES[key], `ukjent kategori ${key}`);
  }
});

test("første kategori som treffer vinner: juleshopping er handletur", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  assert.equal(suggestCategory(trip(1, "Juleshopping"), kw), "handletur");
  assert.equal(suggestCategory(trip(2, "Julebord"), kw), "hoytid");
});

test("ingen notat eller ingen treff gir null", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  assert.equal(suggestCategory(trip(1, null), kw), null);
  assert.equal(suggestCategory(trip(2, "xyz"), kw), null);
});

test("egne nøkkelord treffer og bevarer kategorirekkefølgen", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { besok: ["Bestemor"], hoytid: ["jul"] });
  assert.equal(suggestCategory(trip(1, "Til bestemor"), kw), "besok");
  assert.deepEqual(Object.keys(kw), Object.keys(DEFAULT_KEYWORDS));
  assert.equal(kw.besok[0], "bestemor");
  assert.equal(kw.hoytid.filter((w) => w === "jul").length, 1);
});

test("kategorier uten standardord kommer sist", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { helgetur: ["helg"], annet: ["diverse"] });
  const keys = Object.keys(kw);
  assert.deepEqual(keys.slice(-2), ["helgetur", "annet"]);
  assert.equal(suggestCategory(trip(1, "helg i byen"), kw), "helgetur");
});

test("normalizeUserKeywords rydder bort søppel og beholder kantmellomrom", () => {
  const result = normalizeUserKeywords({
    besok: ["A", "a", "", "  ", 3, "tur "],
    ukjent: ["x"],
    jobb: "ikke en liste",
  });
  assert.deepEqual(result, { besok: ["a", "tur "] });
  assert.deepEqual(normalizeUserKeywords(null), {});
  assert.deepEqual(normalizeUserKeywords(["a"]), {});
});

test("parseKeywordInput deler på komma og trimmer", () => {
  assert.deepEqual(parseKeywordInput(" a, b ,,c "), ["a", "b", "c"]);
  assert.deepEqual(parseKeywordInput(""), []);
});

test("keywordHits teller kjørte turer med notat etter første treff", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  const trips = [
    trip(1, "IKEA"),
    trip(2, "Lege"),
    trip(3, "ukjent sted"),
    trip(4, ""),
    trip(5, "IKEA", { noTrips: true }),
    trip(6, "IKEA", { canceled: "2025-01-01T00:00:00Z" }),
  ];
  assert.deepEqual(keywordHits(trips, kw), {
    total: 3,
    matched: 2,
    perCategory: { handletur: 1, helse: 1 },
  });
});

test("autoSuggestAll hopper over turer som alt er kategorisert", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  const result = autoSuggestAll([trip(1, "IKEA"), trip(2, "Lege")], { 1: "annet" }, kw);
  assert.deepEqual(result, { 2: "helse" });
});

test("userKeywords lagres normalisert og leses tilbake", async () => {
  const storage = memoryStorage({ reservations: [1] });
  await saveUserKeywords(storage, { besok: ["Bestemor"], ukjent: ["x"] });
  assert.deepEqual(storage.data.userKeywords, { besok: ["bestemor"] });
  assert.deepEqual(storage.data.reservations, [1]);
  assert.deepEqual(await loadUserKeywords(storage), { besok: ["bestemor"] });
  assert.deepEqual(await loadUserKeywords(memoryStorage()), {});
});
