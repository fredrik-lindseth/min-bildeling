import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATEGORIES,
  DEFAULT_ORDER,
  LEGACY_CATEGORIES,
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
  normalizeCategorySettings,
  customCategoryKey,
  resolveCategoryOrder,
  resolveCategories,
  knownTripCategories,
  addCustomCategory,
  renameCustomCategory,
  removeCustomCategory,
  addKeyword,
  removeKeyword,
  resetCategory,
  moveCategory,
  categoryChanges,
  categoryStats,
  loadCategorySettings,
  saveCategorySettings,
  migrateLegacyCategories,
} from "../lib/categories.js";

function trip(id, notes, extra = {}) {
  return { id, notes, canceled: null, noTrips: false, price: { total: 100 }, ...extra };
}

// Som storage.local: get tar én nøkkel eller en liste.
function memoryStorage(initial = {}) {
  const data = structuredClone(initial);
  const writes = [];
  return {
    data,
    writes,
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in data) result[key] = structuredClone(data[key]);
      }
      return result;
    },
    async set(items) {
      writes.push(Object.keys(items));
      Object.assign(data, structuredClone(items));
    },
  };
}

test("standardlisten bruker bare kjente kategorier", () => {
  for (const key of Object.keys(DEFAULT_KEYWORDS)) {
    assert.ok(DEFAULT_CATEGORIES[key], `ukjent kategori ${key}`);
  }
  assert.deepEqual([...DEFAULT_ORDER].sort(), Object.keys(DEFAULT_CATEGORIES).sort());
  for (const target of Object.values(LEGACY_CATEGORIES)) assert.ok(DEFAULT_CATEGORIES[target]);
  for (const old of Object.keys(LEGACY_CATEGORIES)) assert.ok(!DEFAULT_CATEGORIES[old]);
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
  ["Kjøre til flyplassen", "transport"],
  ["Hente på flyplassen", "transport"],
  ["Fly til Tromsø", "transport"],
  ["Flytoget", "transport"],
  ["Hente barna i barnehagen", "transport"],
  ["Levere barn i barnehagen", "transport"],
  ["Skyss til fotballkamp", "transport"],
  ["Hente ved til hytta", "transport"],
  ["Søppelsekker", "transport"],
  ["Julebord", "hoytid"],
  ["Julaften hos familien", "hoytid"],
  ["17. mai-frokost", "hoytid"],
  ["Konfirmasjon", "hoytid"],
  ["Bursdagsbesøk", "besok"],
  ["Middag hos venner", "besok"],
  ["Dugnad i borettslaget", "besok"],
  ["Opp på hytta", "aktivitet"],
  ["Fjelltur", "aktivitet"],
  ["Fjellhelg", "aktivitet"],
  ["Hyttehelg", "aktivitet"],
  ["Helg på hytta", "helgetur"],
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
  // Flyplassordene står i transport sammen med «flytt», så kategorien sier
  // ikke hvilket ord som traff. Ordet må være «flytt», aldri «fly ».
  for (const notes of ["Flytting", "Flyttesker"]) {
    assert.deepEqual(matchKeyword(notes, kw), { category: "transport", keyword: "flytt" }, notes);
  }
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
  assert.equal(suggestCategory(trip(3, "Hente på flyplassen"), kw), "transport");
  assert.equal(suggestCategory(trip(4, "Juleshopping"), kw), "handletur");
  assert.deepEqual(matchKeyword("Frisør og handle", kw), { category: "handletur", keyword: "handle" });
});

test("ingen notat eller ingen treff gir null", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, {});
  assert.equal(suggestCategory(trip(1, null), kw), null);
  assert.equal(suggestCategory(trip(2, "xyz"), kw), null);
});

test("egne nøkkelord treffer og bevarer kategorirekkefølgen", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { besok: ["Bestemor"], hoytid: ["jul"] });
  assert.equal(suggestCategory(trip(1, "Til bestemor"), kw), "besok");
  assert.deepEqual(Object.keys(kw), DEFAULT_ORDER);
  assert.equal(kw.besok[0], "bestemor");
  assert.equal(kw.hoytid.filter((w) => w === "jul").length, 1);
});

test("kategorier uten standardord kommer sist", () => {
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { annet: ["diverse"] });
  assert.deepEqual(Object.keys(kw).slice(-1), ["annet"]);
  assert.equal(suggestCategory(trip(1, "diverse"), kw), "annet");
  assert.deepEqual(mergeKeywords(DEFAULT_KEYWORDS, {}).annet, []);
});

test("mergeKeywords tar bort fjernede standardord og følger lagret rekkefølge", () => {
  const settings = {
    custom: { "egen-katt": { label: "Katt" } },
    removed: { hoytid: ["jul"] },
    order: ["egen-katt", ...DEFAULT_ORDER],
  };
  const kw = mergeKeywords(DEFAULT_KEYWORDS, { "egen-katt": ["katt"], hoytid: ["jul"] }, settings);
  assert.equal(Object.keys(kw)[0], "egen-katt");
  // Brukerens eget «jul» står, standardordet er fjernet: ordet finnes én gang.
  assert.equal(kw.hoytid.filter((w) => w === "jul").length, 1);
  assert.ok(!mergeKeywords(DEFAULT_KEYWORDS, {}, settings).hoytid.includes("jul"));
  // Kategorien øverst vinner, også over Helse.
  assert.equal(suggestCategory(trip(1, "Katten til dyrlegen"), kw), "egen-katt");
  // Uten egen kategori i innstillingene blir egne ord borte.
  assert.ok(!("egen-katt" in mergeKeywords(DEFAULT_KEYWORDS, { "egen-katt": ["katt"] })));
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

test("normalizeUserKeywords flytter gamle nøkler inn i målet etter målets egne ord", () => {
  assert.deepEqual(
    normalizeUserKeywords({ flyplass: ["gardermoen", "hente"], transport: ["hente", "sofa"], skyss: ["sfo"], hyttetur: ["Hytta"] }),
    { transport: ["hente", "sofa", "gardermoen", "sfo"], aktivitet: ["hytta"] },
  );
  const categories = resolveCategories({ custom: { "egen-katt": { label: "Katt" } } });
  assert.deepEqual(normalizeUserKeywords({ "egen-katt": ["Katt"], "egen-hund": ["x"] }, categories), { "egen-katt": ["katt"] });
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
    trip(8, "Ikea igjen"),
  ];
  assert.deepEqual(keywordHits(trips, kw), {
    total: 4,
    matched: 3,
    perCategory: { handletur: 2, helse: 1 },
    perKeyword: { handletur: { ikea: 2 }, helse: { lege: 1 } },
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

test("egne ord for egne kategorier lagres bare når kategorien finnes", async () => {
  const storage = memoryStorage({ categorySettings: { custom: { "egen-katt": { label: "Katt" } } } });
  await saveUserKeywords(storage, { "egen-katt": ["katt"], "egen-hund": ["hund"] });
  assert.deepEqual(storage.data.userKeywords, { "egen-katt": ["katt"] });
  assert.deepEqual(await loadUserKeywords(storage), { "egen-katt": ["katt"] });
});

test("normalizeTripCategories tar eksportformatet og hopper over ukjente nøkler", () => {
  assert.deepEqual(
    normalizeTripCategories({ tripCategories: { a: "helse", b: "ukjent", c: 3, " ": "jobb" } }),
    { categories: { a: "helse" }, skipped: 3, migrated: 0 },
  );
  assert.deepEqual(normalizeTripCategories({ a: "aerend" }), { categories: { a: "aerend" }, skipped: 0, migrated: 0 });
  assert.deepEqual(normalizeTripCategories(null), { categories: {}, skipped: 0, migrated: 0 });
  assert.deepEqual(normalizeTripCategories([1]), { categories: {}, skipped: 0, migrated: 0 });
});

test("normalizeTripCategories migrerer gamle nøkler", () => {
  assert.deepEqual(
    normalizeTripCategories({ a: "flyplass", b: "hyttetur", c: "skyss" }),
    { categories: { a: "transport", b: "aktivitet", c: "transport" }, skipped: 0, migrated: 3 },
  );
});

test("normalizeTripCategories godtar egne nøkler bare når kategorien finnes", () => {
  const categories = resolveCategories({ custom: { "egen-katt": { label: "Katt" } } });
  assert.deepEqual(
    normalizeTripCategories({ a: "egen-katt", b: "egen-hund" }, categories),
    { categories: { a: "egen-katt" }, skipped: 1, migrated: 0 },
  );
  assert.equal(normalizeTripCategories({ a: "egen-katt" }).skipped, 1);
});

test("knownTripCategories dropper valg for slettede kategorier og migrerer gamle", () => {
  const categories = resolveCategories({});
  assert.deepEqual(
    knownTripCategories({ a: "helse", b: "egen-katt", c: "flyplass", d: 4 }, categories),
    { a: "helse", c: "transport" },
  );
  assert.deepEqual(knownTripCategories(null, categories), {});
});

test("saveCategories legger til uten å slette andre valg", async () => {
  const storage = memoryStorage({ tripCategories: { a: "helse" } });
  await saveCategories(storage, { b: "jobb", a: "annet" });
  assert.deepEqual(await loadCategories(storage), { a: "annet", b: "jobb" });
});

test("loadCategories leser gamle nøkler som målet", async () => {
  const storage = memoryStorage({ tripCategories: { a: "hyttetur", b: "egen-katt" } });
  assert.deepEqual(await loadCategories(storage), { a: "aktivitet", b: "egen-katt" });
});

// ---------- Innstillinger og egne kategorier ----------

test("normalizeCategorySettings tar ut fjernede ord brukeren har som egne ord", () => {
  const raw = { removed: { hoytid: ["jul", "påske"], helse: ["lege"] } };
  assert.deepEqual(normalizeCategorySettings(raw, { hoytid: ["jul"], helse: ["lege"] }).removed, { hoytid: ["påske"] });
  // Et eget ord i en annen kategori gjelder ikke.
  assert.deepEqual(normalizeCategorySettings(raw, { jobb: ["jul"] }).removed, raw.removed);
});

test("normalizeCategorySettings rydder søppel", () => {
  const empty = { custom: {}, removed: {}, order: null };
  assert.deepEqual(normalizeCategorySettings(null), empty);
  assert.deepEqual(normalizeCategorySettings("tull"), empty);
  assert.deepEqual(normalizeCategorySettings({ custom: [], removed: 3, order: "x" }), empty);
  assert.deepEqual(
    normalizeCategorySettings({
      custom: {
        "egen-katt": { label: "  Katt " },
        "egen-tom": { label: "   " },
        helse: { label: "Ny helse" },
        "egen-tall": { label: 3 },
      },
      removed: {
        hoytid: ["Jul", "jul", "", 4, "påske"],
        flyplass: ["Fly "],
        "egen-katt": ["katt"],
        ukjent: ["x"],
        jobb: "kontor",
      },
      order: ["egen-katt", "helse", "helse", "hyttetur", "ukjent", 7, "egen-tom"],
    }),
    {
      custom: { "egen-katt": { label: "Katt" } },
      removed: { hoytid: ["jul", "påske"], transport: ["fly "] },
      order: ["egen-katt", "helse", "aktivitet"],
    },
  );
  assert.equal(normalizeCategorySettings({ order: ["ukjent"] }).order, null);
});

test("customCategoryKey lager stabile nøkler", () => {
  assert.equal(customCategoryKey("Katt", []), "egen-katt");
  assert.equal(customCategoryKey("Skole & SFO", []), "egen-skole-sfo");
  assert.equal(customCategoryKey("Ærend øst", []), "egen-aerend-oest");
  assert.equal(customCategoryKey("Kåre", []), "egen-kaare");
  assert.equal(customCategoryKey("  --Hei!!  ", []), "egen-hei");
  assert.equal(customCategoryKey("Katt", ["egen-katt"]), "egen-katt-2");
  assert.equal(customCategoryKey("Katt", ["egen-katt", "egen-katt-2"]), "egen-katt-3");
  assert.equal(customCategoryKey("", []), "egen-kategori");
  assert.equal(customCategoryKey("!!!", []), "egen-kategori");
});

test("resolveCategoryOrder: egne først uten lagret rekkefølge", () => {
  assert.deepEqual(resolveCategoryOrder({}), DEFAULT_ORDER);
  assert.deepEqual(
    resolveCategoryOrder({ custom: { "egen-a": { label: "A" }, "egen-b": { label: "B" } } }),
    ["egen-a", "egen-b", ...DEFAULT_ORDER],
  );
});

test("resolveCategoryOrder: ny standardkategori fra en oppdatering lander etter forgjengeren", () => {
  // En rekkefølge lagret før jobb fantes, med aktivitet flyttet øverst.
  const saved = DEFAULT_ORDER.filter((k) => k !== "jobb" && k !== "aktivitet");
  const order = resolveCategoryOrder({ order: ["aktivitet", ...saved] });
  assert.equal(order.indexOf("jobb"), order.indexOf("aktivitet") + 1);
  assert.equal(order.length, DEFAULT_ORDER.length);
  // Uten forgjenger lander den først.
  const noHelse = resolveCategoryOrder({ order: DEFAULT_ORDER.filter((k) => k !== "helse") });
  assert.equal(noHelse[0], "helse");
  // En egen kategori som mangler i rekkefølgen, kommer sist.
  const custom = resolveCategoryOrder({ custom: { "egen-a": { label: "A" } }, order: DEFAULT_ORDER });
  assert.equal(custom.at(-1), "egen-a");
});

test("resolveCategories gir etikett og om kategorien er egen", () => {
  const categories = resolveCategories({ custom: { "egen-katt": { label: "Katt" } } });
  assert.deepEqual(categories["egen-katt"], { label: "Katt", custom: true });
  assert.deepEqual(categories.helse, { label: "Helse", custom: false });
  assert.deepEqual(Object.keys(categories), ["egen-katt", ...DEFAULT_ORDER]);
});

test("addCustomCategory legger kategorien øverst og avviser tomme og brukte navn", () => {
  const { settings, key } = addCustomCategory({}, "  Katt ");
  assert.equal(key, "egen-katt");
  assert.deepEqual(settings.custom, { "egen-katt": { label: "Katt" } });
  assert.deepEqual(settings.order, ["egen-katt", ...DEFAULT_ORDER]);

  const second = addCustomCategory(settings, "Hund");
  assert.deepEqual(second.settings.order.slice(0, 2), ["egen-hund", "egen-katt"]);

  assert.deepEqual(addCustomCategory(settings, "  "), { error: "Skriv et navn." });
  assert.deepEqual(addCustomCategory(settings, "katt"), { error: "Navnet er alt i bruk." });
  assert.deepEqual(addCustomCategory(settings, "HELSE"), { error: "Navnet er alt i bruk." });
  // Ny kategori med en slug som er tatt, får -2.
  assert.equal(addCustomCategory(settings, "Katt!").key, "egen-katt-2");
});

test("renameCustomCategory beholder nøkkelen", () => {
  const { settings } = addCustomCategory({}, "Katt");
  const renamed = renameCustomCategory(settings, "egen-katt", "Kattepass");
  assert.deepEqual(renamed.settings.custom, { "egen-katt": { label: "Kattepass" } });
  assert.deepEqual(renameCustomCategory(settings, "egen-katt", "katt").settings.custom["egen-katt"], { label: "katt" });
  assert.deepEqual(renameCustomCategory(settings, "egen-katt", ""), { error: "Skriv et navn." });
  assert.deepEqual(renameCustomCategory(settings, "egen-katt", "Jobb"), { error: "Navnet er alt i bruk." });
  assert.ok(renameCustomCategory(settings, "helse", "Lege").error);
});

test("removeCustomCategory tar med ord og turvalg", () => {
  const { settings } = addCustomCategory({}, "Katt");
  const result = removeCustomCategory({
    settings,
    userKeywords: { "egen-katt": ["katt"], helse: ["x"] },
    tripCategories: { a: "egen-katt", b: "helse", c: "egen-katt" },
  }, "egen-katt");
  assert.equal(result.trips, 2);
  assert.deepEqual(result.tripCategories, { b: "helse" });
  assert.deepEqual(result.userKeywords, { helse: ["x"] });
  assert.deepEqual(result.settings.custom, {});
  assert.ok(!result.settings.order.includes("egen-katt"));
});

test("addKeyword legger til, tar tilbake fjernede og sier fra om ordet finnes", () => {
  const added = addKeyword({ userKeywords: {}, settings: {} }, "hoytid", "Lucia");
  assert.equal(added.changed, true);
  assert.deepEqual(added.userKeywords, { hoytid: ["lucia"] });

  const whole = addKeyword({ userKeywords: {}, settings: {} }, "transport", "tog ");
  assert.deepEqual(whole.userKeywords, { transport: ["tog "] });

  const exists = addKeyword({ userKeywords: {}, settings: {} }, "hoytid", "jul");
  assert.equal(exists.changed, false);
  assert.equal(exists.exists, true);

  const settings = { removed: { hoytid: ["jul"] } };
  const back = addKeyword({ userKeywords: {}, settings }, "hoytid", "jul");
  assert.equal(back.changed, true);
  assert.deepEqual(back.userKeywords, {});
  assert.deepEqual(back.settings.removed, {});

  assert.equal(addKeyword({ userKeywords: {}, settings: {} }, "hoytid", "  ").changed, false);
  assert.equal(addKeyword({ userKeywords: {}, settings: {} }, "hoytid", "*").changed, false);
  assert.equal(addKeyword({ userKeywords: {}, settings: {} }, "egen-finnesikke", "x").changed, false);
});

test("removeKeyword sletter egne ord og husker fjernede standardord", () => {
  const own = removeKeyword({ userKeywords: { hoytid: ["lucia"] }, settings: {} }, "hoytid", "lucia");
  assert.equal(own.changed, true);
  assert.deepEqual(own.userKeywords, {});
  assert.deepEqual(own.settings.removed, {});

  const def = removeKeyword({ userKeywords: {}, settings: {} }, "hoytid", "jul");
  assert.deepEqual(def.settings.removed, { hoytid: ["jul"] });
  assert.ok(!mergeKeywords(DEFAULT_KEYWORDS, def.userKeywords, def.settings).hoytid.includes("jul"));

  assert.equal(removeKeyword({ userKeywords: {}, settings: def.settings }, "hoytid", "jul").changed, false);
  assert.equal(removeKeyword({ userKeywords: {}, settings: {} }, "hoytid", "finnesikke").changed, false);
});

test("resetCategory og categoryChanges", () => {
  const userKeywords = { hoytid: ["lucia", "jul"], helse: ["x"] };
  const settings = { removed: { hoytid: ["påske"] } };
  assert.deepEqual(categoryChanges("hoytid", userKeywords, settings), { added: ["lucia"], removed: ["påske"] });
  assert.deepEqual(categoryChanges("jobb", userKeywords, settings), { added: [], removed: [] });

  const reset = resetCategory({ userKeywords, settings }, "hoytid");
  assert.equal(reset.changed, true);
  assert.deepEqual(reset.userKeywords, { helse: ["x"] });
  assert.deepEqual(reset.settings.removed, {});
  assert.equal(resetCategory({ userKeywords: {}, settings: {} }, "hoytid").changed, false);
});

test("moveCategory flytter ett steg og står stille i kanten", () => {
  const down = moveCategory({}, "helse", 1);
  assert.equal(down.changed, true);
  assert.deepEqual(down.settings.order.slice(0, 2), ["handletur", "helse"]);
  assert.equal(moveCategory({}, "helse", -1).changed, false);
  assert.equal(moveCategory({}, "annet", 1).changed, false);
  assert.equal(moveCategory({}, "finnesikke", 1).changed, false);

  // «katt» vinner over Helse til Katt er flyttet ned under den.
  const { settings } = addCustomCategory({}, "Katt");
  const userKeywords = { "egen-katt": ["katt"] };
  const note = trip(1, "Katten til dyrlegen");
  assert.equal(suggestCategory(note, mergeKeywords(DEFAULT_KEYWORDS, userKeywords, settings)), "egen-katt");
  const moved = moveCategory(settings, "egen-katt", 1).settings;
  assert.equal(suggestCategory(note, mergeKeywords(DEFAULT_KEYWORDS, userKeywords, moved)), "helse");
});

test("«Bare som helt ord» med «fly» treffer ikke «Flytting»", () => {
  const { settings } = addCustomCategory({}, "Reise");
  const { userKeywords } = addKeyword({ userKeywords: {}, settings }, "egen-reise", "fly ");
  const kw = mergeKeywords(DEFAULT_KEYWORDS, userKeywords, settings);
  assert.equal(suggestCategory(trip(1, "Fly til Bergen"), kw), "egen-reise");
  assert.equal(suggestCategory(trip(2, "Flytting"), kw), "transport");
});

test("categoryStats teller ukjente og slettede kategorier som ukategorisert", () => {
  const categories = resolveCategories({ custom: { "egen-katt": { label: "Katt" } } });
  const trips = [trip(1, ""), trip(2, ""), trip(3, ""), trip(4, "")];
  const stats = categoryStats(trips, { 1: "egen-katt", 2: "egen-hund", 3: "helse" }, categories);
  assert.equal(stats["egen-katt"].label, "Katt");
  assert.equal(stats.helse.label, "Helse");
  assert.equal(stats.uncategorized.label, "Ukategorisert");
  assert.equal(stats.uncategorized.count, 2);
  assert.ok(!("egen-hund" in stats));
});

test("categorySettings lagres normalisert og leses tilbake", async () => {
  const storage = memoryStorage();
  assert.deepEqual(await loadCategorySettings(storage), { custom: {}, removed: {}, order: null });
  await saveCategorySettings(storage, { custom: { "egen-katt": { label: "Katt" } }, removed: { hyttetur: ["Hytta"] } });
  assert.deepEqual(storage.data.categorySettings, {
    custom: { "egen-katt": { label: "Katt" } },
    removed: { aktivitet: ["hytta"] },
    order: null,
  });
});

// ---------- Migrering ----------

test("migrateLegacyCategories flytter valg, ord og innstillinger til målet", async () => {
  const storage = memoryStorage({
    tripCategories: { a: "flyplass", b: "hyttetur", c: "skyss", d: "helse" },
    userKeywords: { flyplass: ["gardermoen"], transport: ["tilhenger", "gardermoen"], hyttetur: ["Hytta på fjellet"] },
    categorySettings: { custom: {}, removed: { hyttetur: ["naust"] }, order: null },
    reservations: [1],
  });
  assert.deepEqual(await migrateLegacyCategories(storage), { changed: true });
  assert.deepEqual(storage.data.tripCategories, { a: "transport", b: "aktivitet", c: "transport", d: "helse" });
  assert.deepEqual(storage.data.userKeywords, {
    transport: ["tilhenger", "gardermoen"],
    aktivitet: ["hytta på fjellet"],
  });
  assert.deepEqual(storage.data.categorySettings.removed, { aktivitet: ["naust"] });
  assert.deepEqual(storage.data.reservations, [1]);

  // Andre gang er det ingenting å gjøre, og ingenting skrives.
  const writes = storage.writes.length;
  assert.deepEqual(await migrateLegacyCategories(storage), { changed: false });
  assert.equal(storage.writes.length, writes);
});

test("migrateLegacyCategories skriver ingenting når alt er nytt", async () => {
  const storage = memoryStorage({
    tripCategories: { a: "helse", b: "egen-katt" },
    userKeywords: { "egen-katt": ["katt"] },
    categorySettings: { custom: { "egen-katt": { label: "Katt" } }, removed: {}, order: null },
  });
  assert.deepEqual(await migrateLegacyCategories(storage), { changed: false });
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(await migrateLegacyCategories(memoryStorage()), { changed: false });
});

test("bare tripCategories endres når bare de har gamle nøkler", async () => {
  const storage = memoryStorage({ tripCategories: { a: "skyss" }, userKeywords: { helse: ["x"] } });
  await migrateLegacyCategories(storage);
  assert.deepEqual(storage.writes, [["tripCategories"]]);
});