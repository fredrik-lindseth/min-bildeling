import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIES,
  DEFAULT_KEYWORDS,
  normalizeUserKeywords,
  parseKeywordInput,
  mergeKeywords,
  suggestCategory,
  matchKeyword,
  keywordPattern,
  keywordHits,
  autoSuggestAll,
  loadCategories,
  saveCategories,
  normalizeTripCategories,
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

// Oppdiktede notater slik folk skriver dem, med kategorien standardlisten
// skal gi. null betyr at notatet med vilje ikke skal treffe noe.
const CORPUS = [
  ["Storhandel på Coop", "handletur"],
  ["IKEA, ny kommode", "handletur"],
  ["Rema 1000 og Europris", "handletur"],
  ["Juleshopping", "handletur"],
  ["Loppemarked på skolen", "handletur"],
  ["Hente pakke på posten", "handletur"],
  ["Kjøpe maling", "handletur"],
  ["Tannlege", "helse"],
  ["Legevakt med sønnen", "helse"],
  ["Røntgen av kneet", "helse"],
  ["Til MR", "helse"],
  ["Koloskopi på sykehuset", "helse"],
  ["Katten til dyrelegen", "helse"],
  ["Optiker, nye briller", "helse"],
  ["Kjøre til flyplassen", "flyplass"],
  ["Hente på flyplassen", "flyplass"],
  ["Fly til Tromsø", "flyplass"],
  ["Hente barna i barnehagen", "skyss"],
  ["Skyss til fotballkamp", "skyss"],
  ["Julebord", "hoytid"],
  ["Julaften hos familien", "hoytid"],
  ["17. mai-frokost", "hoytid"],
  ["Konfirmasjon", "hoytid"],
  ["Bursdagsbesøk", "besok"],
  ["Middag hos venner", "besok"],
  ["Dugnad i borettslaget", "besok"],
  ["Opp på hytta", "hyttetur"],
  ["Fjelltur", "hyttetur"],
  ["Sommerferie langs kysten", "helgetur"],
  ["Helgetur til byen", "helgetur"],
  ["Overnatting på camping", "helgetur"],
  ["Flytting", "transport"],
  ["Flyttelass", "transport"],
  ["Hente sofa", "transport"],
  ["Miljøstasjon med hageavfall", "transport"],
  ["Levere til gjenbruk", "transport"],
  ["Skitur med ungene", "aktivitet"],
  ["Tur i skogen", "aktivitet"],
  ["Bade og fiske", "aktivitet"],
  ["Konsert", "aktivitet"],
  ["Lunsjbuldring", "aktivitet"],
  ["Langrenn", "aktivitet"],
  ["Kundemøte", "jobb"],
  ["Jobbintervju", "jobb"],
  ["Diverse ærender", "aerend"],
  ["Frisør", "aerend"],
  ["EU-kontroll", "aerend"],
  ["Litt av hvert", null],
  // Kjente feiltreff fra substring-matchingen.
  ["Skifer til terrassen", null],
  ["Montere kjøkken", null],
  ["Bygge terrasse", null],
  ["Kulturhuset", null],
  ["Boligvisning", null],
  ["Julaften", "hoytid"],
  ["Privilegert parkering", "aerend"],
  // Feiltreff fra «jul» og *-ord som traff hvor som helst i ordet.
  ["Ferie i juli", "helgetur"],
  ["Julie fyller år", null],
  ["Ekskursjon med klassen", null],
  ["Møte med bobestyrer etter konkursen", "jobb"],
  ["Diskusjon om diskurs", null],
  ["Kursiv skrift", null],
  ["Førstehjelpskurs", "jobb"],
  ["Kurset i Oslo", "jobb"],
  ["Foreldremøtet", "jobb"],
  ["Søndagsbesøket", "besok"],
  ["Dugnaden", "besok"],
];

test("testkorpuset får forventet kategori", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  for (const [notes, expected] of CORPUS) {
    assert.equal(suggestCategory(trip(1, notes), kw), expected, notes);
  }
});

test("kjente feiltreff er borte", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  const not = (notes, category) =>
    assert.notEqual(suggestCategory(trip(1, notes), kw), category, notes);
  not("Flytting", "flyplass");
  not("Flyttesker", "flyplass");
  not("Skifer", "aktivitet");
  not("Dumpling", "transport");
  not("Montere hylle", "handletur");
  not("Bygge garasje", "handletur");
  not("Kultur", "aktivitet");
  not("Visning", "jobb");
  not("Kollega", "helse");
});

test("ordstart, helt ord og sammensetning", () => {
  assert.ok(keywordPattern("lege").test("legevakt"));
  assert.ok(!keywordPattern("lege").test("privilegert"));
  assert.ok(keywordPattern("lege").test("time hos lege."));
  assert.ok(keywordPattern("fly ").test("fly"));
  assert.ok(keywordPattern("fly ").test("fly, tog"));
  assert.ok(!keywordPattern("fly ").test("flytting"));
  assert.ok(keywordPattern("*besøk").test("bursdagsbesøk"));
  assert.ok(keywordPattern("*besøk").test("besøkstid"));
  assert.ok(keywordPattern("*besøk").test("bursdagsbesøkene"));
  assert.ok(!keywordPattern("*kurs").test("ekskursjon"));
  assert.ok(!keywordPattern("*møte").test("kundemøterom"));
  assert.ok(keywordPattern("ærend").test("ærender"));
  assert.ok(!keywordPattern("ærend").test("tærende"));
  assert.ok(keywordPattern("17. mai").test("17. mai"));
  assert.ok(!keywordPattern("17. mai").test("17x mai"));
  assert.ok(keywordPattern("eu-kontroll").test("eu-kontroll"));
});

test("blandede notater: kategorien som står først i listen vinner", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  assert.equal(suggestCategory(trip(1, "Handle, så legevakt"), kw), "helse");
  assert.equal(suggestCategory(trip(2, "Lege og handle etterpå"), kw), "helse");
  assert.equal(suggestCategory(trip(3, "Hente på flyplassen"), kw), "flyplass");
  assert.equal(suggestCategory(trip(4, "Juleshopping"), kw), "handletur");
  assert.deepEqual(matchKeyword("Frisør og handle", kw), { category: "handletur", keyword: "handle" });
});

test("gamle kategorinøkler finnes fortsatt, så lagrede valg står", () => {
  const before = [
    "handletur", "helgetur", "hyttetur", "besok", "transport", "aktivitet",
    "helse", "hoytid", "jobb", "flyplass", "annet",
  ];
  for (const key of before) assert.ok(CATEGORIES[key], key);
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
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { annet: ["diverse"] });
  assert.deepEqual(Object.keys(kw).slice(-1), ["annet"]);
  assert.equal(suggestCategory(trip(1, "diverse"), kw), "annet");
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
  assert.deepEqual(keywordHits([trip(7, "Stoppested")], mergeKeywords({}, { annet: ["*sted"] })).matched, 1);
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

test("normalizeTripCategories tar eksportformatet og hopper over ukjente nøkler", () => {
  assert.deepEqual(
    normalizeTripCategories({ tripCategories: { a: "helse", b: "ukjent", c: 3, " ": "jobb" } }),
    { categories: { a: "helse" }, skipped: 3 },
  );
  assert.deepEqual(normalizeTripCategories({ a: "aerend" }), { categories: { a: "aerend" }, skipped: 0 });
  assert.deepEqual(normalizeTripCategories(null), { categories: {}, skipped: 0 });
  assert.deepEqual(normalizeTripCategories([1]), { categories: {}, skipped: 0 });
});

test("saveCategories legger til uten å slette andre valg", async () => {
  const storage = memoryStorage({ tripCategories: { a: "helse" } });
  await saveCategories(storage, { b: "jobb", a: "annet" });
  assert.deepEqual(await loadCategories(storage), { a: "annet", b: "jobb" });
});
