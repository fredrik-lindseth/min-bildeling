// Demomodus: syntetiske, deterministiske reservasjoner for skjermbilder og for
// den som vil se utvidelsen uten dele.no-konto. Slås på med ?demo=1 på
// dashbordet, popupen og årsoppsummeringen.
//
// Modulen bruker ingen nettleser-API. Sidene i demomodus leser herfra og
// skriver bare til et lager i minnet, så ekte storage blir aldri rørt og
// sidene kan åpnes over vanlig http. Stasjoner, notater og biler er oppdiktet.

export const DEMO_SEED = 20261101;

const ORGS = {
  bergen: { id: "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0", name: "Bildeleringen" },
  trondheim: { id: "8dba8f19-c438-f278-ed7c-912ec6537cb9", name: "Trondheim Bilkollektiv" },
};

const MEMBERSHIP_ID = "00000000-0000-0000-0000-00000000de40";

// Vekten styrer hvor ofte stasjonen brukes, så «Mest brukte stasjoner» får
// en tydelig favoritt og en lang hale.
const STATIONS = [
  { name: "Regnbuetorget, Bergen", org: "bergen", weight: 34 },
  { name: "Sildeskjæret, Bergen", org: "bergen", weight: 20 },
  { name: "Tyttebærstien, Bergen", org: "bergen", weight: 12 },
  { name: "Lomvikbakken, Bergen", org: "bergen", weight: 6 },
  { name: "Måkeløkken, Bergen", org: "bergen", weight: 3 },
  { name: "Elvebryggen, Trondheim", org: "trondheim", weight: 9 },
  { name: "Torvhaugen, Trondheim", org: "trondheim", weight: 5 },
];

const CARS = [
  { model: "Volkswagen ID.3", category: "Kombi", fuel: "Elektrisitet", weight: 30, hourly: 69 },
  { model: "Toyota Yaris", category: "Småbil", fuel: "Bensin", weight: 18, hourly: 59 },
  { model: "Volkswagen e-up!", category: "Minibil", fuel: "Elektrisitet", weight: 12, hourly: 55 },
  { model: "Toyota Corolla STV", category: "Stasjonsvogn", fuel: "Bensin", weight: 14, hourly: 72 },
  { model: "Skoda Enyaq", category: "SUV", fuel: "Elektrisitet", weight: 10, hourly: 85 },
  { model: "Toyota RAV4", category: "SUV", fuel: "Bensin", weight: 6, hourly: 85 },
  { model: "Toyota Proace", category: "Varebil", fuel: "Diesel", weight: 6, hourly: 89 },
];

const FUEL_KEYS = { Bensin: "GASOLINE", Diesel: "DIESEL", Elektrisitet: "ELECTRIC" };

// Turtyper med notater. `category` er den kategorien standard-nøkkelordene
// skal gi notatet (sjekkes i testen). null betyr at notatet med vilje ikke
// treffer, så forslagslisten og treffprosenten blir realistiske.
// `noteCategory` overstyrer for enkeltnotater, så turtypene og dermed
// tilfeldighetene i demodataene kan stå uendret.
export const DEMO_TRIP_TYPES = [
  {
    weight: 22, km: [6, 30], hours: [1, 3], category: "handletur",
    notes: ["Storhandel på Coop", "IKEA-tur", "Biltema, hagemøbler", "Handle til helgen", "Rema og Europris"],
  },
  {
    weight: 11, km: [15, 90], hours: [3, 8], category: "besok",
    notes: ["Besøk hos besteforeldre", "Bursdag hos venner", "Familiemiddag"],
  },
  {
    weight: 7, km: [140, 360], hours: [28, 52], weekend: true, category: "hyttetur",
    notes: ["Hyttetur", "Opp på hytta", "Fjellhelg"],
  },
  {
    weight: 9, km: [10, 60], hours: [2, 5], weekend: true, category: "aktivitet",
    notes: ["Fotballcup", "Skitur", "Klatring", "Kino og pizza", "Padletur i fjorden"],
  },
  {
    weight: 8, km: [8, 40], hours: [1, 3], category: "transport",
    notes: ["Levere til gjenbruk", "Hente sofa", "Kaste hageavfall", "Frakte bokhylle"],
  },
  {
    weight: 5, km: [10, 40], hours: [1, 3], weekday: true, category: "helse",
    notes: ["Tannlege", "Veterinær med katten", "Fysioterapeut"],
  },
  {
    weight: 5, km: [20, 120], hours: [3, 9], weekday: true, category: "jobb",
    notes: ["Kundemøte", "Kurs", "Jobbseminar"],
  },
  {
    weight: 4, km: [25, 45], hours: [1, 3], category: "flyplass",
    notes: ["Kjøre til flyplassen", "Hente på flyplassen"],
  },
  {
    weight: 3, km: [20, 140], hours: [5, 12], category: "hoytid",
    notes: ["Julebord", "Konfirmasjon", "Påskeferie"],
  },
  {
    weight: 14, km: [5, 70], hours: [1, 5], category: null,
    notes: ["Diverse ærender", "Litt av hvert", "Ærend i byen", null, null, null],
    noteCategory: { "Diverse ærender": "aerend", "Ærend i byen": "aerend" },
  },
];

// Flere turer om sommeren og i desember.
const MONTH_WEIGHT = [3, 3, 5, 4, 5, 7, 8, 6, 6, 4, 4, 6];

const LEAD_BUCKETS_HOURS = [
  { weight: 24, range: [0.2, 20] },
  { weight: 18, range: [24, 46] },
  { weight: 20, range: [50, 94] },
  { weight: 16, range: [100, 186] },
  { weight: 10, range: [200, 330] },
  { weight: 5, range: [340, 700] },
];

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** mulberry32: liten, rask PRNG med 32-bits seed. Samme seed gir samme rekke. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed) {
  const next = mulberry32(seed);
  const rnd = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted: (list) => {
      const total = list.reduce((sum, item) => sum + item.weight, 0);
      let roll = next() * total;
      for (const item of list) {
        roll -= item.weight;
        if (roll < 0) return item;
      }
      return list[list.length - 1];
    },
    hex: (n) => {
      let s = "";
      for (let i = 0; i < n; i++) s += Math.floor(next() * 16).toString(16);
      return s;
    },
  };
  rnd.uuid = () => `${rnd.hex(8)}-${rnd.hex(4)}-4${rnd.hex(3)}-a${rnd.hex(3)}-${rnd.hex(12)}`;
  return rnd;
}

// API-et sender lokal tid uten sone («2024-05-22T11:45:36»). Regner i UTC og
// skriver ut uten sone, så dataene blir like uansett tidssone og sommertid.
function isoLocal(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

function stableId(prefix, text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return `${prefix}${h.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`.slice(0, 36);
}

function buildCar(car, index) {
  return {
    id: stableId("ca", car.model),
    licensePlate: `EK${10100 + index}`,
    carNumber: String(900 + index),
    model: car.model,
    category: car.category,
    properties: [
      {
        groupKey: "FUEL_TYPE",
        group: "Drivstoff",
        name: car.fuel,
        key: FUEL_KEYS[car.fuel],
      },
    ],
  };
}

function buildLocation(station) {
  return {
    id: stableId("10", station.name),
    name: station.name,
    description: "Oppdiktet demostasjon.",
  };
}

function priceLines({ hours, km, hourly, noTrips }) {
  const round = (n) => Math.round(n * 100) / 100;
  if (noTrips) {
    return [
      { price: 49, quantity: 1, total: 49, description: "Startavgift", unit: "" },
      { price: 150, quantity: 1, total: 150, description: "Booket, ikke kjørt", unit: "" },
    ];
  }
  // Timeprisen har et dagstak på ti timer, som hos de fleste bilkollektiv.
  const fullDays = Math.floor(hours / 24);
  const rest = Math.min(10, Math.ceil(hours - fullDays * 24));
  const billedHours = fullDays * 10 + rest;
  const first = Math.min(km, 100);
  const over = Math.max(0, km - 100);
  const lines = [
    { price: 49, quantity: 1, total: 49, description: "Startavgift", unit: "" },
    { price: hourly, quantity: billedHours, total: hourly * billedHours, description: "Timepris", unit: "" },
    { price: 3.1, quantity: first, total: round(first * 3.1), description: "Første 100 km", unit: "" },
  ];
  if (over > 0) {
    lines.push({ price: 2.4, quantity: over, total: round(over * 2.4), description: "Over 100 km", unit: "" });
  }
  return lines;
}

function buildReservation(rnd, spec) {
  const { startMs, hours, km, carIndex, station, notes, leadHours, noTrips = false, canceled = false } = spec;
  const carDef = CARS[carIndex];
  const endMs = startMs + Math.round(hours * 60) * 60000;
  const createdMs = startMs - Math.round(leadHours * 60) * 60000;
  const org = ORGS[station.org];

  let lines;
  if (canceled) {
    // Avbestilt under 48 timer før start koster et gebyr, ellers ingenting.
    lines = leadHours < 48
      ? [
        { price: 49, quantity: 1, total: 49, description: "Startavgift", unit: "" },
        { price: 24.5, quantity: 1, total: 24.5, description: "Avbestillingsgebyr", unit: "" },
      ]
      : [];
  } else {
    lines = priceLines({ hours, km, hourly: carDef.hourly, noTrips });
  }
  const total = Math.round(lines.reduce((sum, l) => sum + l.total, 0) * 100) / 100;
  const driven = !canceled && !noTrips;

  return {
    id: rnd.uuid(),
    reservationNumber: String(1500000 + rnd.int(0, 499999)),
    organizationId: org.id,
    organizationName: org.name,
    membershipId: MEMBERSHIP_ID,
    drivenKm: driven ? km : 0,
    start: isoLocal(startMs),
    end: isoLocal(endMs),
    started: driven ? isoLocal(startMs + 4 * 60000) : null,
    ended: driven ? isoLocal(endMs - 6 * 60000) : null,
    created: isoLocal(createdMs),
    effectiveStart: isoLocal(startMs),
    effectiveEnd: isoLocal(endMs),
    car: buildCar(carDef, carIndex),
    price: { currency: "Kr", total, lines },
    invoiced: true,
    freeIfNoTrips: false,
    noTrips: !driven,
    state: canceled ? "CANCELED" : "PAST",
    notes,
    location: buildLocation(station),
    canceled: canceled ? isoLocal(createdMs + Math.max(1, leadHours / 2) * HOUR) : null,
  };
}

function pickCarIndex(rnd, type) {
  if (type.category === "transport" && rnd.next() < 0.6) {
    return CARS.findIndex((c) => c.category === "Varebil");
  }
  if (type.category === "hyttetur" && rnd.next() < 0.6) {
    return rnd.pick([3, 4, 5]);
  }
  return CARS.indexOf(rnd.weighted(CARS));
}

function dayStartMs(year, month, day) {
  return Date.UTC(year, month, day);
}

function pickDay(rnd, year, month, maxDay, type) {
  // Prøv noen ganger å treffe ønsket ukedag, ellers ta det som kom.
  let day = rnd.int(1, maxDay);
  for (let i = 0; i < 6; i++) {
    const weekday = new Date(dayStartMs(year, month, day)).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6 || weekday === 5;
    if (type.weekend && !isWeekend) { day = rnd.int(1, maxDay); continue; }
    if (type.weekday && (weekday === 0 || weekday === 6)) { day = rnd.int(1, maxDay); continue; }
    // Uten krav: helg er dobbelt så sannsynlig som én hverdag.
    if (!type.weekend && !type.weekday && !isWeekend && rnd.next() < 0.35) {
      day = rnd.int(1, maxDay);
      continue;
    }
    break;
  }
  return day;
}

function startHour(rnd, startMs, type) {
  const weekday = new Date(startMs).getUTCDay();
  if (type.weekend || weekday === 0 || weekday === 6) return rnd.int(8, 13);
  if (type.weekday) return rnd.int(8, 15);
  // Hverdager: flest etter jobb.
  const [from, to] = rnd.weighted([
    { weight: 2, hours: [7, 9] },
    { weight: 3, hours: [10, 15] },
    { weight: 5, hours: [16, 19] },
    { weight: 1, hours: [20, 21] },
  ]).hours;
  return rnd.int(from, to);
}

// Ytterpunktene legges inn for hånd, så lengste tur, dyreste tur, mest
// spontane og tidligste booking alltid har noe å vise. Nøkkelordene i
// notatene sjekkes i testen.
export const DEMO_EXTREME_NOTES = {
  "Sommerferie langs kysten": "helgetur",
  "Julemiddag hos svigers": "hoytid",
  "Hente pakke på posten": "handletur",
  "17. mai-frokost": "hoytid",
  "Fotballcup": "aktivitet",
};

function demoExtremes(midYear, firstYear) {
  return [
    // Lengste og dyreste: en uke langs kysten om sommeren.
    { startMs: dayStartMs(midYear, 6, 6) + 9 * HOUR, hours: 7 * 24 - 2, km: 1184, carIndex: 4,
      station: STATIONS[0], notes: "Sommerferie langs kysten", leadHours: 52 * 24 },
    // Booket sju uker før jul.
    { startMs: dayStartMs(midYear, 11, 23) + 10 * HOUR, hours: 50, km: 212, carIndex: 3,
      station: STATIONS[1], notes: "Julemiddag hos svigers", leadHours: 49 * 24 },
    // Mest spontane: booket etter at turen startet (klampes til 0 t).
    { startMs: dayStartMs(midYear, 2, 14) + 17 * HOUR, hours: 1, km: 4, carIndex: 2,
      station: STATIONS[0], notes: "Hente pakke på posten", leadHours: -0.2 },
    // Kort tur i Trondheim i 17. mai-uken.
    { startMs: dayStartMs(firstYear, 4, 17) + 8 * HOUR, hours: 6, km: 38, carIndex: 0,
      station: STATIONS[5], notes: "17. mai-frokost", leadHours: 9 * 24 },
    // Avbestilt sent, med gebyr, som i ekte data.
    { startMs: dayStartMs(midYear, 3, 12) + 12 * HOUR, hours: 4, km: 0, carIndex: 1,
      station: STATIONS[2], notes: "Fotballcup", leadHours: 30, canceled: true },
  ];
}

/**
 * Lag demoreservasjonene. Utvalget dekker de tre siste kalenderårene fram til
 * og med dagens dato i `now`, så popupen har turer denne og forrige måned.
 * Bare år, måned og dag fra `now` brukes: samme seed og samme dag gir
 * nøyaktig samme data.
 */
export function generateDemoReservations({ seed = DEMO_SEED, now = new Date() } = {}) {
  const rnd = makeRandom(seed);
  const endYear = now.getFullYear();
  const endMonth = now.getMonth();
  const today = now.getDate();
  const firstYear = endYear - 2;
  const reservations = [];

  const stationFor = (type) => {
    // Hytteturer og flyplassturer starter fra en av de faste stasjonene.
    if (type.category === "hyttetur" || type.category === "flyplass") return STATIONS[rnd.int(0, 1)];
    return rnd.weighted(STATIONS);
  };

  for (let year = firstYear; year <= endYear; year++) {
    const lastMonth = year === endYear ? endMonth : 11;
    for (let month = 0; month <= lastMonth; month++) {
      const isCurrent = year === endYear && month === endMonth;
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const maxDay = isCurrent ? Math.max(1, today) : daysInMonth;
      let count = MONTH_WEIGHT[month] + rnd.int(-1, 1);
      if (isCurrent) count = Math.max(2, Math.round((count * maxDay) / daysInMonth));

      for (let i = 0; i < count; i++) {
        const type = rnd.weighted(DEMO_TRIP_TYPES);
        const day = pickDay(rnd, year, month, maxDay, type);
        const dayMs = dayStartMs(year, month, day);
        const hour = startHour(rnd, dayMs, type);
        const startMs = dayMs + hour * HOUR + rnd.pick([0, 15, 30, 45]) * 60000;
        const hours = Math.round(rnd.float(type.hours[0], type.hours[1]) * 2) / 2;
        const lead = rnd.weighted(LEAD_BUCKETS_HOURS).range;
        const roll = rnd.next();

        reservations.push(buildReservation(rnd, {
          startMs,
          hours,
          km: rnd.int(type.km[0], type.km[1]),
          carIndex: pickCarIndex(rnd, type),
          station: stationFor(type),
          notes: rnd.pick(type.notes),
          leadHours: rnd.float(lead[0], lead[1]),
          noTrips: roll < 0.05,
          canceled: roll > 0.975,
        }));
      }
    }
  }

  const extremes = demoExtremes(endYear - 1, firstYear);
  for (const spec of extremes) reservations.push(buildReservation(rnd, spec));

  // Nyeste først, som historikk-endepunktet.
  reservations.sort((a, b) => b.start.localeCompare(a.start));
  return reservations;
}

/**
 * Brukerdata som ellers kommer fra skjemaene: noen kategorier satt for hånd
 * og transportdata for hvert år, så Transport-seksjonen har noe å
 * sammenligne med.
 */
export function demoUserData(reservations) {
  const tripCategories = {};
  for (const r of reservations) {
    if (r.notes === "Sommerferie langs kysten") tripCategories[r.id] = "helgetur";
  }
  // De eldste ukategoriserte turene settes til Annet, så kategoriene får en
  // manuell rest, mens de nyeste blir stående som forslag.
  const unmatched = reservations.filter((r) => r.notes === "Litt av hvert").slice(-4);
  for (const r of unmatched) tripCategories[r.id] = "annet";

  const years = [...new Set(reservations.map((r) => Number(r.start.slice(0, 4))))].sort();
  const transportData = {};
  years.forEach((year, i) => {
    transportData[year] = {
      buss: { trips: 310 + i * 24, totalKm: 2400 + i * 180, totalCost: 7200 + i * 450 },
      taxi: { trips: 7 - i, totalKm: 95 - i * 10, totalCost: 2900 - i * 300 },
      fly: { trips: 4, totalKm: 1900, totalCost: 5600 + i * 300 },
      sykkel: { totalKm: 900 + i * 150 },
    };
  });

  return { tripCategories, transportData };
}

/**
 * Lager i minnet med samme get/set som storage-polyfillen. Det som lagres i
 * demomodus (kategorier, nøkkelord, transport), forsvinner når siden lukkes.
 */
export function createDemoStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of list) {
        if (key in data) result[key] = structuredClone(data[key]);
      }
      return result;
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

/** ?demo=1 i adressen slår på demomodus. */
export function isDemoMode(search) {
  return new URLSearchParams(search).get("demo") === "1";
}

/**
 * Alt en side trenger i demomodus: reservasjoner og et lager i minnet
 * forhåndsfylt med brukerdata. Ingen «sist synkronisert», for ingenting er
 * synkronisert, og en ekte tid i et skjermbilde ville sett ut som ekte data.
 */
export function createDemoSession({ seed = DEMO_SEED, now = new Date() } = {}) {
  const reservations = generateDemoReservations({ seed, now });
  const storage = createDemoStorage(demoUserData(reservations));
  return { reservations, storage };
}

/** Merket som skiller demoskjermbilder fra ekte tall. */
export function createDemoBadge(doc) {
  const badge = doc.createElement("span");
  badge.className = "demo-badge";
  badge.textContent = "Demodata";
  badge.title = "Oppdiktede turer. Ingenting lagres.";
  return badge;
}
