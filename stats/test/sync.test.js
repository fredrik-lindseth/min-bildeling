import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSync,
  runSyncWhenFree,
  lockIsFree,
  releaseLock,
  needsDetail,
  mergeReservations,
  DETAIL_BATCH_SIZE,
  PAUSE_INITIAL_MS,
  PAUSE_INCREMENTAL_MS,
  SETTLE_WINDOW_MS,
  DETAIL_REFRESH_MS,
  LOCK_LEASE_MS,
  LOCK_POLL_MS,
  POPUP_MAX_DETAILS,
  DETAIL_RETRY_BASE_MS,
  NOT_FOUND_MAX_ATTEMPTS,
  detailRetryDelayMs,
  withSyncLock,
} from "../lib/sync.js";
import { importBackup } from "../lib/backup-import.js";
import { parseRetryAfter, ITEM_ATTEMPTS } from "../lib/api.js";
import {
  describeProgress,
  describeSyncResult,
  historyProgress,
  describeIncompleteHistory,
} from "../lib/sync-messages.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-01T12:00:00Z");

// ---------- Stubs ----------

function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  const writes = [];
  return {
    data,
    writes,
    async get(keys) {
      const out = {};
      for (const k of keys) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(items) {
      writes.push(Object.keys(items));
      Object.assign(data, structuredClone(items));
    },
  };
}

// n reservasjoner, nyeste først, slik /reservations/historic sorterer.
function makeReservations(n, { endDaysAgo = 30 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const end = NOW - (endDaysAgo + i) * DAY;
    return {
      id: `r${String(n - i).padStart(4, "0")}`,
      start: new Date(end - 3 * 60 * 60 * 1000).toISOString(),
      end: new Date(end).toISOString(),
    };
  });
}

function makeApi(reservations, { failures = {} } = {}) {
  const calls = [];
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  async function fetch(url, init) {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    const key = u.pathname.endsWith("/historic") ? `list:${u.searchParams.get("page")}` : `detail:${u.pathname.split("/").pop()}`;
    const queue = failures[key];
    if (queue && queue.length > 0) {
      const f = queue.shift();
      if (f === "network") throw new TypeError("NetworkError when attempting to fetch resource.");
      // Et element som står igjen alene i køen, gjentas for alltid.
      if (f.always) {
        queue.unshift(f);
        return json({ error: "fail" }, f.status, f.headers || {});
      }
      return json({ error: "fail" }, f.status, f.headers || {});
    }
    if (u.pathname.endsWith("/historic")) {
      const page = Number(u.searchParams.get("page"));
      const size = Number(u.searchParams.get("size"));
      // Listen er slank: ingen pris, km eller canceled.
      const items = reservations
        .slice(page * size, page * size + size)
        .map(({ id, start, end }) => ({ id, start, end, state: "PAST", location: "Et sted" }));
      return json(items, 200, { "x-totalelements": String(reservations.length) });
    }
    const id = u.pathname.split("/").pop();
    const r = reservations.find((x) => x.id === id);
    if (!r) return json({ error: "not found" }, 404);
    return json({ ...r, state: "PAST", canceled: null, noTrips: false, drivenKm: 12, price: { total: 100, lines: [] } });
  }

  const count = (kind) =>
    calls.filter((c) => (kind === "list" ? c.url.includes("/historic") : !c.url.includes("/historic"))).length;
  return { fetch, calls, count };
}

function harness(storage, api, overrides = {}) {
  const sleeps = [];
  let clock = NOW;
  const opts = {
    fetch: api.fetch,
    storage,
    getAuth: async () => ({ token: "Bearer test", membershipId: "m-1" }),
    clientId: "min-bildeling/test",
    owner: "side-a",
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...overrides,
  };
  return {
    opts,
    sleeps,
    advance: (ms) => {
      clock += ms;
    },
    run: (extra = {}) => runSync({ ...opts, ...extra }),
  };
}

// ---------- Førstegangssync og lagring ----------

test("førstegangssync henter liste og alle detaljer og lagrer fortløpende i batcher", async () => {
  const all = makeReservations(250);
  const api = makeApi(all);
  const storage = makeStorage();
  const { run, sleeps } = harness(storage, api);

  const result = await run();

  assert.equal(result.status, "SYNCED");
  assert.equal(result.count, 250);
  assert.equal(api.count("list"), 3); // 100 + 100 + 50
  assert.equal(api.count("detail"), 250);
  assert.deepEqual(result.calls, { list: 3, detail: 250, retries: 0, failed: 0 });
  assert.equal(storage.data.reservations.length, 250);
  assert.ok(storage.data.reservations.every((r) => r.detailFetchedAt != null && r.price));
  assert.ok(storage.data.lastSync);
  assert.equal(storage.data.syncState.phase, "done");
  assert.equal(storage.data.syncLock, null);

  // Listen lagres før første detalj, deretter én skriving per batch.
  const reservationWrites = storage.writes.filter((w) => w.includes("reservations")).length;
  assert.ok(reservationWrites >= Math.ceil(250 / DETAIL_BATCH_SIZE));

  // Pausen mellom kall er den romslige ved førstegangssync.
  assert.ok(sleeps.filter((ms) => ms === PAUSE_INITIAL_MS).length >= 250);
});

test("alle kall bærer X-Client og authorization", async () => {
  const api = makeApi(makeReservations(3));
  const { run } = harness(makeStorage(), api);
  await run();
  for (const c of api.calls) {
    assert.equal(c.headers["X-Client"], "min-bildeling/test");
    assert.equal(c.headers.authorization, "Bearer test");
  }
});

test("andre sync rett etter full sync gir ett listekall og null detaljkall", async () => {
  const all = makeReservations(250);
  const api = makeApi(all);
  const storage = makeStorage();
  const h = harness(storage, api);
  await h.run();
  api.calls.length = 0;

  const second = await h.run({ force: true });

  assert.equal(second.status, "SYNCED");
  assert.deepEqual(second.calls, { list: 1, detail: 0, retries: 0, failed: 0 });
  assert.equal(storage.data.syncHistory.length, 2);
  assert.equal(storage.data.syncHistory[0].calls.list, 1);
});

test("uten force og innenfor timen gjøres ingen kall", async () => {
  const api = makeApi(makeReservations(5));
  const storage = makeStorage();
  const h = harness(storage, api);
  await h.run();
  api.calls.length = 0;
  const again = await h.run();
  assert.equal(again.status, "CACHED");
  assert.equal(api.calls.length, 0);
});

test("ny reservasjon på side 0 hentes, pagineringen stopper ved første kjente id", async () => {
  const all = makeReservations(250);
  const api = makeApi(all);
  const storage = makeStorage();
  const h = harness(storage, api);
  await h.run();

  const fresh = { id: "r9999", start: new Date(NOW - DAY).toISOString(), end: new Date(NOW - DAY + 3600000).toISOString() };
  all.unshift(fresh);
  api.calls.length = 0;
  const result = await h.run({ force: true });

  assert.equal(api.count("list"), 1);
  assert.equal(api.count("detail"), 1);
  assert.equal(result.count, 251);
  assert.equal(storage.data.reservations[0].id, "r9999");
});

test("hull lenger bak i listen fanges via x-totalelements", async () => {
  const all = makeReservations(250);
  const api = makeApi(all);
  // Lagret mangler én reservasjon på side 2, men har de nyeste.
  const missing = all[230].id;
  const stored = all.filter((r) => r.id !== missing).map((r) => ({ ...r, detailFetchedAt: NOW }));
  const storage = makeStorage({ reservations: stored, lastSync: NOW - 2 * DAY });
  const h = harness(storage, api);

  await h.run({ force: true });
  assert.equal(api.count("list"), 3);
  assert.equal(api.count("detail"), 1);
  assert.ok(storage.data.reservations.some((r) => r.id === missing));
});

test("full:true paginerer helt til slutten", async () => {
  const all = makeReservations(250);
  const api = makeApi(all);
  const storage = makeStorage();
  const h = harness(storage, api);
  await h.run();
  api.calls.length = 0;
  await h.run({ force: true, full: true });
  assert.equal(api.count("list"), 3);
  assert.equal(api.count("detail"), 0);
});

test("inkrementell sync bruker kort pause", async () => {
  const all = makeReservations(5);
  const api = makeApi(all);
  const storage = makeStorage();
  const h = harness(storage, api);
  await h.run();
  all.unshift({ id: "rNY", start: new Date(NOW).toISOString(), end: new Date(NOW + 3600000).toISOString() });
  h.sleeps.length = 0;
  await h.run({ force: true });
  assert.ok(h.sleeps.includes(PAUSE_INCREMENTAL_MS));
  assert.ok(!h.sleeps.includes(PAUSE_INITIAL_MS));
});

// ---------- Feil per detalj ----------

test("en detalj som gir 404 hoppes over, resten lagres, og den prøves igjen neste sync", async () => {
  const all = makeReservations(30);
  const bad = all[5].id;
  const api = makeApi(all, { failures: { [`detail:${bad}`]: [{ status: 404 }] } });
  const storage = makeStorage();
  const h = harness(storage, api);

  const first = await h.run();
  assert.equal(first.status, "SYNCED");
  assert.equal(first.failedThisRun, 1);
  assert.equal(first.count, 29);
  assert.ok(storage.data.syncState.failed[bad]);

  api.calls.length = 0;
  const second = await h.run({ force: true });
  assert.equal(second.failedThisRun, 0);
  assert.equal(api.count("detail"), 1);
  assert.equal(second.count, 30);
  assert.equal(storage.data.syncState.failed[bad], undefined);
});

// ---------- Retry-After, backoff og bryter ----------

test("parseRetryAfter tolker sekunder og HTTP-dato", () => {
  assert.equal(parseRetryAfter("3", NOW), 3000);
  assert.equal(parseRetryAfter(new Date(NOW + 5000).toUTCString(), NOW), 5000);
  assert.equal(parseRetryAfter(null, NOW), null);
  assert.equal(parseRetryAfter("tull", NOW), null);
});

test("503 med Retry-After: 3 gir én ventetid på 3 s før nytt forsøk", async () => {
  const all = makeReservations(3);
  const id = all[1].id;
  const api = makeApi(all, {
    failures: { [`detail:${id}`]: [{ status: 503, headers: { "Retry-After": "3" } }] },
  });
  const storage = makeStorage();
  const h = harness(storage, api);
  const result = await h.run();

  assert.equal(result.status, "SYNCED");
  assert.equal(h.sleeps.filter((ms) => ms === 3000).length, 1);
  assert.equal(result.calls.retries, 1);
  assert.equal(result.count, 3);
});

test("429 uten Retry-After gir backoff med jitter", async () => {
  const all = makeReservations(2);
  const api = makeApi(all, { failures: { "list:0": [{ status: 429 }] } });
  const h = harness(makeStorage(), api, { random: () => 0.9 });
  await h.run();
  // 2000 ms base × (0,5 + 0,9)
  assert.ok(h.sleeps.includes(2800));
});

test("tre 503 på rad stopper synken, det hentede er lagret, og neste sync fortsetter", async () => {
  const all = makeReservations(60);
  const id = all[45].id;
  const api = makeApi(all, {
    failures: { [`detail:${id}`]: [{ status: 503 }, { status: 503 }, { status: 503 }] },
  });
  const storage = makeStorage();
  const h = harness(storage, api);

  const first = await h.run();
  assert.equal(first.status, "PAUSED");
  assert.equal(first.error, "SERVICE_UNAVAILABLE");
  assert.equal(storage.data.reservations.length, 45);
  assert.equal(storage.data.syncState.phase, "paused");
  // Id-en bryteren slo ut på, legges til side så neste synk ikke står fast på den.
  assert.equal(storage.data.syncState.failed[id].attempts, 1);
  assert.ok(!storage.data.syncState.pendingIds.includes(id));
  assert.equal(storage.data.lastSync, undefined);
  assert.equal(storage.data.syncLock, null);

  // Automatisk synk venter til pausen er over.
  api.calls.length = 0;
  const auto = await h.run();
  assert.equal(auto.status, "PAUSED");
  assert.equal(api.calls.length, 0);

  // Brukeren trykker Synkroniser: fortsetter fra pendingIds, uten listekall.
  const resumed = await h.run({ force: true });
  assert.equal(resumed.status, "SYNCED");
  assert.equal(api.count("list"), 0);
  assert.equal(api.count("detail"), 15);
  assert.equal(storage.data.reservations.length, 60);
});

test("nettverksfeil teller som forbigående feil", async () => {
  const all = makeReservations(2);
  const api = makeApi(all, { failures: { "list:0": ["network", "network", "network"] } });
  const h = harness(makeStorage(), api);
  const result = await h.run();
  assert.equal(result.error, "SERVICE_UNAVAILABLE");
  assert.equal(result.calls.list, 3);
});

test("Retry-After over to minutter stopper synken i stedet for å vente", async () => {
  const all = makeReservations(2);
  const api = makeApi(all, { failures: { "list:0": [{ status: 429, headers: { "Retry-After": "600" } }] } });
  const h = harness(makeStorage(), api);
  const result = await h.run();
  assert.equal(result.error, "SERVICE_UNAVAILABLE");
  assert.ok(!h.sleeps.includes(600000));
});

test("401 avbryter med AUTH_EXPIRED og lagrer det som er hentet", async () => {
  const all = makeReservations(30);
  const api = makeApi(all, { failures: { [`detail:${all[25].id}`]: [{ status: 401 }] } });
  const storage = makeStorage();
  const h = harness(storage, api);
  const result = await h.run();
  assert.equal(result.error, "AUTH_EXPIRED");
  assert.equal(storage.data.reservations.length, 25);
  assert.equal(storage.data.syncState.pendingIds.length, 5);
});

test("uten innlogging gjøres ingen kall", async () => {
  const api = makeApi(makeReservations(2));
  const h = harness(makeStorage(), api, { getAuth: async () => null });
  const result = await h.run();
  assert.equal(result.error, "NOT_LOGGED_IN");
  assert.equal(api.calls.length, 0);
});

// ---------- Avbrudd, budsjett og lås ----------

test("en avbrutt synk (siden lukket) fortsetter fra pendingIds", async () => {
  const all = makeReservations(50);
  const api = makeApi(all);
  const storage = makeStorage();
  const h = harness(storage, api);

  const partial = await h.run({ maxDetails: 20 });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(storage.data.reservations.length, 20);
  assert.equal(storage.data.syncState.pendingIds.length, 30);

  // Uten force: en uferdig synk fortsetter selv om timen ikke er gått.
  api.calls.length = 0;
  const resumed = await h.run();
  assert.equal(resumed.status, "SYNCED");
  assert.equal(api.count("list"), 0);
  assert.equal(api.count("detail"), 30);
  assert.equal(resumed.done, 50);
  assert.equal(resumed.total, 50);
  assert.equal(resumed.fetchedSoFar, 50);
});

test("en annen side med gyldig lås gir BUSY uten kall", async () => {
  const api = makeApi(makeReservations(2));
  const storage = makeStorage({ syncLock: { owner: "side-b", expiresAt: NOW + 10000 } });
  const h = harness(storage, api);
  const result = await h.run();
  assert.equal(result.status, "BUSY");
  assert.equal(api.calls.length, 0);
});

test("en utløpt lås fra en lukket side tas over", async () => {
  const api = makeApi(makeReservations(2));
  const storage = makeStorage({ syncLock: { owner: "side-b", expiresAt: NOW - 1 } });
  const result = await harness(storage, api).run();
  assert.equal(result.status, "SYNCED");
});

test("popupens lås kan alltid tas, en annen sides gyldige lås kan ikke", () => {
  const live = NOW + 10000;
  assert.equal(lockIsFree(null, "a", NOW), true);
  assert.equal(lockIsFree({ owner: "a", expiresAt: live }, "a", NOW), true);
  assert.equal(lockIsFree({ owner: "b", expiresAt: NOW }, "a", NOW), true);
  assert.equal(lockIsFree({ owner: "b", role: "popup", expiresAt: live }, "a", NOW), true);
  assert.equal(lockIsFree({ owner: "b", role: "page", expiresAt: live }, "a", NOW), false);
  assert.equal(lockIsFree({ owner: "b", expiresAt: live }, "a", NOW), false);
});

test("dashboardet tar over fra en popup som holder låsen, uten å vente", async () => {
  const api = makeApi(makeReservations(2));
  const storage = makeStorage({ syncLock: { owner: "popup", role: "popup", expiresAt: NOW + LOCK_LEASE_MS } });
  const result = await harness(storage, api).run();
  assert.equal(result.status, "SYNCED");
  assert.equal(storage.data.reservations.length, 2);
});

test("venter på en annen sides lås, viser fremdriften derfra og fortsetter selv når leasen går ut", async () => {
  const all = makeReservations(50);
  const api = makeApi(all);
  // Den andre siden ble lukket midt i synken: 20 av 50 er lagret, 30 står i køen.
  const storage = makeStorage({
    reservations: all.slice(0, 20).map((r) => ({ ...r, price: { total: 100 } })),
    syncLock: { owner: "side-b", role: "page", expiresAt: NOW + LOCK_LEASE_MS },
    syncState: {
      phase: "details",
      initial: true,
      startedAt: NOW - 60000,
      pendingIds: all.slice(20).map((r) => r.id),
      failed: {},
      total: 50,
      done: 20,
      fetchedSoFar: 20,
    },
  });
  const h = harness(storage, api);
  const progress = [];
  const result = await runSyncWhenFree({ ...h.opts, onProgress: (p) => progress.push(p) });

  assert.equal(result.status, "SYNCED");
  assert.equal(result.waited, true);
  assert.equal(api.count("list"), 0);
  assert.equal(api.count("detail"), 30);
  assert.equal(storage.data.reservations.length, 50);
  assert.deepEqual(progress[0], { phase: "details", current: 20, total: 50, elsewhere: true });
  // Ventet i steg på LOCK_POLL_MS til leasen var ute, ikke lenger.
  const waits = h.sleeps.filter((ms) => ms === LOCK_POLL_MS).length;
  assert.equal(waits, Math.ceil(LOCK_LEASE_MS / LOCK_POLL_MS));
});

test("to dashboard-faner synker ikke samtidig", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = makeStorage();
  const waiting = [];
  const a = runSyncWhenFree({ ...world.opts("fane-a"), storage });
  // Fane b åpnes litt ut i synken til fane a.
  while (world.now() < NOW + 5000) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const b = runSyncWhenFree({ ...world.opts("fane-b"), storage, onProgress: (p) => waiting.push(p) });
  const [resultA, resultB] = await Promise.all([a, b]);

  assert.equal(resultA.status, "SYNCED");
  assert.equal(resultB.waited, true);
  // Fane b fant en fersk synk da låsen ble ledig, og hentet ingenting selv.
  assert.equal(resultB.status, "CACHED");
  assert.equal(world.api.count("detail"), 60);
  assert.ok(waiting.length > 0 && waiting.every((p) => p.elsewhere));
  assert.equal(storage.data.syncLock, null);
});

test("popupen som mister låsen til dashboardet, venter og henter ikke de samme turene", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = makeStorage();
  const popup = runSyncWhenFree({ ...world.opts("popup"), storage, role: "popup", maxDetails: POPUP_MAX_DETAILS });
  while (world.now() < NOW + 2000) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const dashboard = runSyncWhenFree({ ...world.opts("dashboard"), storage });
  const [resultPopup, resultDashboard] = await Promise.all([popup, dashboard]);

  assert.equal(resultDashboard.status, "SYNCED");
  assert.equal(resultDashboard.waited, undefined);
  assert.equal(resultPopup.waited, true);
  assert.equal(storage.data.reservations.length, 60);
  // Det popupen hentet etter siste lagring, er tapt og hentes på nytt, høyst
  // én batch pluss kallet som var i gang. Ingen tur hentes av begge løpende.
  assert.ok(world.api.count("detail") <= 60 + DETAIL_BATCH_SIZE + 1, `detaljkall: ${world.api.count("detail")}`);
});

test("dashboardet leser lageret på nytt etter låsen, så popupens siste lagrede batch ikke hentes igjen", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = makeStorage();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const popup = runSyncWhenFree({ ...world.opts("popup"), storage, role: "popup", maxDetails: POPUP_MAX_DETAILS });
  // Dashboardet leser lageret når popupen har hentet 18 detaljer. Innloggingen
  // tar så lang tid at popupen rekker å lagre batchen på 20 før låsen tas.
  while (world.api.count("detail") < 18) await settle();
  const slowAuth = async () => {
    while (world.api.count("detail") < 23) await settle();
    return { token: "Bearer test", membershipId: "m-1" };
  };
  const dashboard = runSyncWhenFree({ ...world.opts("dashboard"), storage, getAuth: slowAuth });
  const [, resultDashboard] = await Promise.all([popup, dashboard]);

  assert.equal(resultDashboard.status, "SYNCED");
  assert.equal(storage.data.reservations.length, 60);
  // Bare det popupen hentet etter siste lagring (tre, pluss kallet som var i
  // gang) hentes på nytt. Med den gamle kopien ville hele batchen på 20 gått igjen.
  assert.ok(world.api.count("detail") <= 60 + 5, `detaljkall: ${world.api.count("detail")}`);
});

test("leasen forlenges over en lang Retry-After-ventetid", async () => {
  const all = makeReservations(2);
  const api = makeApi(all, { failures: { "list:0": [{ status: 503, headers: { "Retry-After": "90" } }] } });
  const storage = makeStorage();
  const leases = [];
  const origSet = storage.set.bind(storage);
  storage.set = async (items) => {
    if (items.syncLock) leases.push(items.syncLock.expiresAt);
    return origSet(items);
  };
  await harness(storage, api).run();
  assert.ok(leases.some((t) => t >= NOW + 90000 + LOCK_LEASE_MS));
});

test("syncHistory beholder de tre siste synkene", async () => {
  const api = makeApi(makeReservations(2));
  const storage = makeStorage();
  const h = harness(storage, api);
  for (let i = 0; i < 5; i++) await h.run({ force: true });
  assert.equal(storage.data.syncHistory.length, 3);
});

// ---------- Fryst-regelen ----------

test("needsDetail: ny reservasjon uten detalj hentes", () => {
  assert.equal(needsDetail({ id: "a", end: new Date(NOW).toISOString() }, NOW, null), true);
});

test("needsDetail: hentet minst sju dager etter slutt er fryst for alltid", () => {
  const end = NOW - 400 * DAY;
  const r = { end: new Date(end).toISOString(), detailFetchedAt: end + SETTLE_WINDOW_MS };
  assert.equal(needsDetail(r, NOW, null), false);
});

test("needsDetail: nylig avsluttet hentes på nytt høyst én gang i døgnet", () => {
  const end = NOW - 2 * DAY;
  const fetchedRecently = { end: new Date(end).toISOString(), detailFetchedAt: NOW - 3 * 60 * 60 * 1000 };
  const fetchedYesterday = { end: new Date(end).toISOString(), detailFetchedAt: NOW - DETAIL_REFRESH_MS };
  assert.equal(needsDetail(fetchedRecently, NOW, null), false);
  assert.equal(needsDetail(fetchedYesterday, NOW, null), true);
});

test("needsDetail: hentet før vinduet var over gir én siste henting", () => {
  const end = NOW - 30 * DAY;
  const r = { end: new Date(end).toISOString(), detailFetchedAt: end + DAY };
  assert.equal(needsDetail(r, NOW, null), true);
  assert.equal(needsDetail({ ...r, detailFetchedAt: NOW }, NOW, null), false);
});

test("needsDetail: pågående og kommende reservasjoner oppdateres daglig", () => {
  const r = { end: new Date(NOW + 2 * DAY).toISOString(), detailFetchedAt: NOW - DETAIL_REFRESH_MS - 1 };
  assert.equal(needsDetail(r, NOW, null), true);
});

test("needsDetail: gamle data uten detailFetchedAt bruker lastSync", () => {
  const old = { end: new Date(NOW - 100 * DAY).toISOString() };
  assert.equal(needsDetail(old, NOW, NOW - 2 * DAY), false);
});

test("mergeReservations erstatter på id og sorterer nyeste først", () => {
  const merged = mergeReservations(
    [{ id: "a", start: "2026-01-01T10:00:00", v: 1 }, { id: "b", start: "2026-03-01T10:00:00" }],
    [{ id: "a", start: "2026-01-01T10:00:00", v: 2 }, { id: "c", start: "2026-02-01T10:00:00" }]
  );
  assert.deepEqual(merged.map((r) => r.id), ["b", "c", "a"]);
  assert.equal(merged.find((r) => r.id === "a").v, 2);
});


// ---------- Feil per id mot feil i tjenesten ----------

function detailCallsFor(api, id) {
  return api.calls.filter((c) => c.url.endsWith(`/reservations/${id}`)).length;
}

test("en detalj som alltid svarer 500 hoppes over: N-1 lagres, og den prøves igjen neste synk", async () => {
  const all = makeReservations(30);
  const bad = all[0].id; // først i køen, der den tidligere låste alt
  const failures = { [`detail:${bad}`]: [{ status: 500, always: true }] };
  const api = makeApi(all, { failures });
  const storage = makeStorage();
  const h = harness(storage, api);

  const first = await h.run();
  assert.equal(first.status, "SYNCED");
  assert.equal(first.count, 29);
  assert.equal(storage.data.reservations.length, 29);
  assert.equal(first.failed, 1);
  assert.equal(detailCallsFor(api, bad), ITEM_ATTEMPTS);
  const failure = storage.data.syncState.failed[bad];
  assert.equal(failure.status, 500);
  assert.equal(failure.attempts, 1);
  assert.ok(failure.lastAttemptAt != null);
  assert.ok(storage.data.lastSync);

  // Neste automatiske synk (over en time senere) prøver id-en igjen.
  h.advance(DETAIL_RETRY_BASE_MS);
  api.calls.length = 0;
  const second = await h.run();
  assert.equal(second.status, "SYNCED");
  assert.equal(detailCallsFor(api, bad), ITEM_ATTEMPTS);
  assert.equal(api.count("detail"), ITEM_ATTEMPTS);
  assert.equal(storage.data.syncState.failed[bad].attempts, 2);
  assert.equal(second.count, 29);

  // Backoff: en time senere er det ikke tid for et nytt forsøk ennå.
  h.advance(DETAIL_RETRY_BASE_MS);
  api.calls.length = 0;
  await h.run();
  assert.equal(detailCallsFor(api, bad), 0);

  // Synkroniser-knappen prøver med en gang, og når Dele svarer igjen, er den med.
  api.calls.length = 0;
  delete failures[`detail:${bad}`];
  const forced = await h.run({ force: true });
  assert.equal(detailCallsFor(api, bad), 1);
  assert.equal(forced.count, 30);
  assert.equal(forced.failed, 0);
  assert.equal(storage.data.syncState.failed[bad], undefined);
});

test("backoff for feilede detaljer vokser og stopper på en uke", () => {
  const HOUR = 60 * 60 * 1000;
  assert.deepEqual([1, 2, 3, 4].map((n) => detailRetryDelayMs(n) / HOUR), [1, 4, 16, 64]);
  assert.equal(detailRetryDelayMs(5), 7 * DAY);
  assert.equal(detailRetryDelayMs(50), 7 * DAY);
});

test("en detalj som alltid svarer 503 stopper ikke neste synk på samme sted", async () => {
  const all = makeReservations(30);
  const bad = all[0].id;
  const api = makeApi(all, { failures: { [`detail:${bad}`]: [{ status: 503, always: true }] } });
  const storage = makeStorage();
  const h = harness(storage, api);

  const first = await h.run();
  assert.equal(first.status, "PAUSED");
  assert.equal(first.error, "SERVICE_UNAVAILABLE");
  assert.equal(storage.data.syncState.failed[bad].attempts, 1);

  // Etter pausen fortsetter synken med de andre og blir ferdig.
  h.advance(10 * 60 * 1000);
  api.calls.length = 0;
  const second = await h.run();
  assert.equal(second.status, "SYNCED");
  assert.equal(detailCallsFor(api, bad), 0);
  assert.equal(second.count, 29);
  assert.equal(second.failed, 1);
});

test("500 på tre ulike detaljer på rad er feil i tjenesten og slår ut bryteren", async () => {
  const all = makeReservations(30);
  const failures = {};
  for (const r of all.slice(3, 6)) failures[`detail:${r.id}`] = [{ status: 500, always: true }];
  const api = makeApi(all, { failures });
  const storage = makeStorage();
  const h = harness(storage, api);

  const result = await h.run();
  assert.equal(result.status, "PAUSED");
  assert.equal(result.error, "SERVICE_UNAVAILABLE");
  assert.equal(api.count("detail"), 3 + 3 * ITEM_ATTEMPTS);
  assert.equal(storage.data.reservations.length, 3);
  assert.equal(Object.keys(storage.data.syncState.failed).length, 3);
  assert.equal(storage.data.syncState.pendingIds.length, 24);
});

test("500 på én detalj mellom vellykkede nullstiller telleren for ulike id-er", async () => {
  const all = makeReservations(30);
  const failures = {};
  for (const i of [2, 4, 6, 8]) failures[`detail:${all[i].id}`] = [{ status: 500, always: true }];
  const api = makeApi(all, { failures });
  const result = await harness(makeStorage(), api).run();
  assert.equal(result.status, "SYNCED");
  assert.equal(result.count, 26);
  assert.equal(result.failed, 4);
});

test("brukeren får vite at turer mangler detaljer og prøves igjen", () => {
  const one = describeSyncResult({
    status: "SYNCED", fetchedSoFar: 29, done: 30, total: 30, failedThisRun: 1, failed: 1, missing: 1, stale: 0,
  });
  assert.equal(one, "Hentet 29 av 30. 1 tur mangler detaljer. Den prøves igjen senere.");

  const many = describeSyncResult({ status: "CACHED", count: 30, failed: 3, missing: 3, stale: 0 });
  assert.equal(many, "3 turer mangler detaljer. De prøves igjen senere.");

  assert.equal(describeSyncResult({ status: "CACHED", count: 30, failed: 0, missing: 0, stale: 0 }), null);
});

test("en lagret tur som ikke kunne oppdateres, mangler ikke detaljer", async () => {
  // Avsluttet i går og hentet for to dager siden: skal hentes på nytt.
  const end = NOW - DAY;
  const stored = [{ id: "r0001", start: new Date(end - 3600e3).toISOString(), end: new Date(end).toISOString(),
    detailFetchedAt: NOW - 2 * DAY }];
  const api = makeApi(stored, { failures: { "detail:r0001": [{ status: 500, always: true }] } });
  const storage = makeStorage({ reservations: stored, lastSync: NOW - 2 * 3600e3 });
  const result = await harness(storage, api).run();

  assert.equal(result.status, "SYNCED");
  assert.equal(result.count, 1);
  assert.deepEqual([result.missing, result.stale], [0, 1]);
  assert.equal(
    describeSyncResult(result),
    "Hentet 0 av 1. 1 tur kunne ikke oppdateres og vises slik den var. Den prøves igjen senere."
  );
  assert.equal(
    describeSyncResult({ status: "CACHED", missing: 2, stale: 1 }),
    "2 turer mangler detaljer, og 1 kunne ikke oppdateres. De prøves igjen senere."
  );
});

test("en tur som feilet i samme synk, telles ikke dobbelt når synken fortsetter", async () => {
  const all = makeReservations(10);
  const bad = all[0].id;
  const api = makeApi(all, { failures: { [`detail:${bad}`]: [{ status: 503, always: true }] } });
  const storage = makeStorage();
  const h = harness(storage, api);

  const first = await h.run();
  assert.equal(first.status, "PAUSED");
  assert.equal(first.fetchedSoFar, 0);

  // Synkroniser tar den feilede med igjen. Totalen er fortsatt ti, og den
  // feilede telles ikke som hentet.
  const forced = await h.run({ force: true });
  assert.equal(forced.status, "PAUSED");
  assert.equal(forced.total, 10);
  assert.equal(forced.fetchedSoFar, 9);
  assert.equal(storage.data.reservations.length, 9);
  assert.equal(describeSyncResult(forced), "Dele svarer ikke nå. Prøver igjen senere. Hentet 9 av 10.");
});

test("en tur som svarer 404 gang på gang, regnes som slettet og prøves ikke mer", async () => {
  const all = makeReservations(5);
  const bad = all[2].id;
  const api = makeApi(all, { failures: { [`detail:${bad}`]: [{ status: 404, always: true }] } });
  const storage = makeStorage();
  const h = harness(storage, api);

  let result = await h.run();
  for (let n = 1; n < NOT_FOUND_MAX_ATTEMPTS; n++) {
    assert.equal(result.missing, 1);
    h.advance(detailRetryDelayMs(n));
    result = await h.run();
  }
  assert.equal(storage.data.syncState.failed[bad].attempts, NOT_FOUND_MAX_ATTEMPTS);
  assert.equal(result.missing, 0);
  assert.equal(describeSyncResult(result), null);

  // Heller ikke Synkroniser prøver den igjen.
  api.calls.length = 0;
  await h.run({ force: true });
  assert.equal(detailCallsFor(api, bad), 0);
});

test("rå feiltekst når ikke brukeren", () => {
  for (const error of ["API-feil 500", "Max retries exceeded", "NetworkError when attempting to fetch resource."]) {
    const message = describeSyncResult({ status: "PAUSED", error, fetchedSoFar: 5, done: 5, total: 10 });
    assert.equal(message, "Synkroniseringen stoppet. Prøv igjen om litt. Hentet 5 av 10.");
  }
});

test("fremdriften står bare i banneret, med tall", () => {
  const progress = { phase: "details", current: 40, total: 661 };
  assert.equal(describeProgress(progress), "Henter detaljer for 40 av 661 turer…");
  assert.equal(describeProgress({ phase: "list", current: 1, total: null }), "Henter turlisten…");
});

test("popupen sier i banneret at resten hentes i dashboardet", () => {
  assert.equal(
    describeProgress({ phase: "details", current: 18, total: 662, stopsAt: 25, limit: 25 }),
    "Henter 18 av 662. Resten hentes i dashboardet."
  );
});

test("hele historikken er hentet først når køen er tom", () => {
  // Ingen synk ennå, eller en ferdig synk: alt som finnes, er hentet.
  assert.equal(historyProgress(undefined).complete, true);
  assert.equal(historyProgress(null).complete, true);
  assert.equal(historyProgress({ phase: "done", pendingIds: [], total: 662, done: 662 }).complete, true);
  // Popupen har hentet 25 og stoppet: 637 igjen i køen.
  const partial = historyProgress({
    phase: "details",
    pendingIds: Array.from({ length: 637 }, (_, i) => `r${i}`),
    total: 662,
    done: 25,
  });
  assert.deepEqual(partial, { complete: false, done: 25, total: 662 });
  // En pause (503) med id-er igjen er like uferdig.
  assert.equal(historyProgress({ phase: "paused", pendingIds: ["r1"], total: 2, done: 1 }).complete, false);
  // done kan ikke vise mer enn totalen.
  assert.equal(historyProgress({ phase: "details", pendingIds: ["r1"], total: 3, done: 5 }).done, 3);
});

test("tall som trenger hele historikken, får en kort tekst", () => {
  assert.equal(
    describeIncompleteHistory({ done: 25, total: 662 }, "Totalen"),
    "Totalen vises når alle turene er hentet. Hentet 25 av 662."
  );
  assert.equal(describeIncompleteHistory({ done: 0, total: 0 }), "Tallet vises når alle turene er hentet.");
});

test("en annen side som synker, vises som fremdrift og ikke som feil", () => {
  assert.equal(
    describeProgress({ phase: "details", current: 18, total: 662, elsewhere: true }),
    "Et annet vindu henter detaljer for 18 av 662 turer…"
  );
  assert.equal(describeProgress({ phase: "elsewhere", elsewhere: true }), "Et annet vindu synkroniserer…");
  assert.equal(describeSyncResult({ status: "BUSY" }), null);
});

// ---------- Lease etter tid ----------

// To sider som synker samtidig med delt klokke. Hvert kall tar `latencyMs` av
// klokken og slipper hendelsesløkken, så sidene veksler slik de ville gjort i
// nettleseren.
function slowWorld(reservations, { latencyMs, slowCall = null }) {
  let clock = NOW;
  const base = makeApi(reservations);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const fetch = async (url, init) => {
    clock += slowCall && slowCall(url) ? slowCall(url) : latencyMs;
    await tick();
    return base.fetch(url, init);
  };
  const opts = (owner) => ({
    fetch,
    getAuth: async () => ({ token: "Bearer test", membershipId: "m-1" }),
    clientId: "min-bildeling/test",
    owner,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await tick();
    },
    random: () => 0.5,
  });
  return { api: base, opts, now: () => clock };
}

test("leasen fornyes etter tid, så en treg synk ikke får følge av en til", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 3000 });
  const storage = makeStorage();

  const a = runSync({ ...world.opts("side-a"), storage });
  // Side b åpnes når side a har holdt på lenger enn leasen, midt i en batch.
  while (world.now() < NOW + LOCK_LEASE_MS + 5000) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const b = await runSync({ ...world.opts("side-b"), storage });
  const resultA = await a;

  assert.equal(b.status, "BUSY");
  assert.equal(resultA.status, "SYNCED");
  assert.equal(world.api.count("detail"), 60);
  assert.equal(storage.data.reservations.length, 60);
});

test("mister siden låsen etter et svar som brukte hele leasen, stopper den før neste kall", async () => {
  const all = makeReservations(60);
  const slowId = all[10].id;
  const world = slowWorld(all, {
    latencyMs: 100,
    slowCall: (url) => (url.endsWith(`/reservations/${slowId}`) ? LOCK_LEASE_MS + 10000 : 0),
  });
  const storage = makeStorage();

  let resultB = null;
  const a = runSync({
    ...world.opts("side-a"),
    storage,
    onProgress: () => {},
  });
  // Side b åpnes mens side a venter på det trege svaret og leasen er gått ut.
  while (world.now() < NOW + LOCK_LEASE_MS + 2000) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const b = runSync({ ...world.opts("side-b"), storage }).then((r) => (resultB = r));
  const resultA = await a;
  await b;

  assert.equal(resultA.status, "BUSY");
  assert.equal(resultB.status, "SYNCED");
  assert.equal(storage.data.reservations.length, 60);
  // Side a gjorde høyst ett kall etter at b tok over: det trege som allerede var i gang.
  assert.ok(world.api.count("detail") <= 60 + 11, `detaljkall: ${world.api.count("detail")}`);
  assert.equal(storage.data.syncLock, null);
  // Bare side b sin synk står i historikken, ingen BUSY fra side a.
  assert.deepEqual(
    storage.data.syncHistory.map((h) => h.status),
    ["SYNCED"],
  );
});

test("releaseLock sletter bare låsen når siden eier den", async () => {
  const theirs = { owner: "side-b", role: "page", expiresAt: NOW + LOCK_LEASE_MS };
  const storage = makeStorage({ syncLock: theirs });
  await releaseLock(storage, "side-a");
  assert.deepEqual(storage.data.syncLock, theirs);

  await releaseLock(storage, "side-b");
  assert.equal(storage.data.syncLock, null);
});

// ---------- Import av sikkerhetskopi under synk ----------

// Turene slik en sikkerhetskopi fra en annen installasjon har dem: detaljsvar
// hentet lenge etter slutt, altså fryst, så synken skal aldri hente dem igjen.
function backupOf(reservations, { lastSync = NOW - 2 * DAY, tripCategories = {} } = {}) {
  return {
    tripCategories,
    transportData: {},
    userKeywords: {},
    lastSync,
    reservations: reservations.map((r) => ({
      ...r,
      state: "PAST",
      canceled: null,
      noTrips: false,
      drivenKm: 12,
      price: { total: 100, lines: [] },
      car: { model: "Testbil" },
      detailFetchedAt: Date.parse(r.end) + SETTLE_WINDOW_MS + DAY,
    })),
  };
}

// Lager som sjekker etter hver skriving at køen og turene henger sammen: ingen
// id står både i reservations og pendingIds (i en førstegangssynk finnes ingen
// lagrede turer som venter på oppdatering), og ingen tur er lagret to ganger.
function checkedStorage() {
  const storage = makeStorage();
  const set = storage.set.bind(storage);
  storage.set = async (items) => {
    await set(items);
    const ids = (storage.data.reservations || []).map((r) => String(r.id));
    assert.equal(new Set(ids).size, ids.length, "en tur er lagret to ganger");
    const stored = new Set(ids);
    const both = (storage.data.syncState?.pendingIds || []).filter((id) => stored.has(String(id)));
    assert.deepEqual(both, [], "lagrede turer står fortsatt i køen");
  };
  return storage;
}

// Id-ene i detaljkallene, i rekkefølge.
function detailIds(api) {
  return api.calls.filter((c) => !c.url.includes("/historic")).map((c) => c.url.split("/").pop());
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("import midt i en batch tar over synken i samme side, og ingen importert tur hentes", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = checkedStorage();
  const progress = [];
  const sync = runSyncWhenFree({ ...world.opts("side-a"), storage, onProgress: (p) => progress.push(p) });
  // 25 detaljer: én batch på 20 er lagret, fem ligger i minnet.
  while (world.api.count("detail") < 25) await settle();
  const before = world.api.count("detail");

  const { counts } = await importBackup({
    ...world.opts("side-a-import"),
    storage,
    backup: backupOf(all),
    takeFrom: "side-a",
  });
  const atImport = world.api.count("detail");
  const result = await sync;

  assert.equal(result.status, "SYNCED");
  assert.equal(result.waited, true);
  assert.equal(storage.data.reservations.length, 60);
  // De 20 lagrede sto, resten kom fra filen.
  assert.equal(counts.reservationsAdded, 40);
  // Høyst kallet som var i gang da importen tok låsen, og ingen detaljer etterpå.
  assert.ok(atImport <= before + 1, `kall under importen: ${atImport - before}`);
  assert.equal(world.api.count("detail"), atImport);
  assert.ok(progress.some((p) => p.phase === "import"));
  assert.equal(storage.data.syncLock, null);
});

test("import som er ferdig mens synken venter på et svar, stopper synken likevel", async () => {
  // I nettleseren kan hele importen, med låsen tatt og sluppet igjen, skje
  // mens synken venter på ett detaljkall. Etterpå er låsen null, og synken
  // må ikke lese det som at låsen fortsatt er dens og skrive turene fra minnet.
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const gatedId = all[5].id;
  const opts = world.opts("side-a");
  const fetch = async (url, init) => {
    if (url.endsWith(`/reservations/${gatedId}`)) await gate;
    return opts.fetch(url, init);
  };
  const storage = checkedStorage();
  const sync = runSyncWhenFree({ ...opts, fetch, storage });
  while (!world.api.calls.length || detailIds(world.api).length < 5) await settle();
  // Synken står nå og venter på svaret for tur nummer seks.
  await settle();

  await importBackup({ ...world.opts("side-a-import"), storage, backup: backupOf(all), takeFrom: "side-a" });
  assert.equal(storage.data.syncLock, null);
  release();
  const result = await sync;

  assert.equal(result.status, "SYNCED");
  assert.equal(storage.data.reservations.length, 60);
  assert.equal(storage.data.syncState.pendingIds.length, 0);
  // Ingen kall etter det som var i gang da importen kom.
  assert.ok(world.api.count("detail") <= 6, `detaljkall: ${world.api.count("detail")}`);
});

test("import av en del av historikken: synken henter bare det som mangler", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = checkedStorage();
  const sync = runSyncWhenFree({ ...world.opts("side-a"), storage });
  while (world.api.count("detail") < 10) await settle();

  // Filen har de 40 eldste. De 20 nyeste mangler i den.
  const older = all.slice(20);
  await importBackup({
    ...world.opts("side-a-import"),
    storage,
    backup: backupOf(older),
    takeFrom: "side-a",
  });
  const result = await sync;

  assert.equal(result.status, "SYNCED");
  assert.equal(storage.data.reservations.length, 60);
  const imported = new Set(older.map((r) => r.id));
  assert.deepEqual(detailIds(world.api).filter((id) => imported.has(id)), [], "importerte turer ble hentet");
  // De 20 nyeste hentes. Det som lå i minnet da låsen ble tatt (under én
  // batch), og kallet som var i gang, hentes en gang til.
  assert.ok(world.api.count("detail") <= 20 + 10 + 1, `detaljkall: ${world.api.count("detail")}`);
  assert.equal(storage.data.syncState.pendingIds.length, 0);
});

test("import tar over fra popupen, som etterpå fortsetter med det som mangler", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = checkedStorage();
  const popup = runSyncWhenFree({ ...world.opts("popup"), storage, role: "popup", maxDetails: POPUP_MAX_DETAILS });
  while (world.api.count("detail") < 5) await settle();

  // Dashboardet synker ikke selv. Importen tar popupens lås uten å vente.
  const waits = [];
  const older = all.slice(30);
  await importBackup({
    ...world.opts("dash-import"),
    storage,
    backup: backupOf(older),
    takeFrom: "dash",
    onWait: (w) => waits.push(w),
  });
  const result = await popup;

  assert.deepEqual(waits, []);
  assert.equal(result.waited, true);
  const imported = new Set(older.map((r) => r.id));
  assert.deepEqual(detailIds(world.api).filter((id) => imported.has(id)), []);
  // Popupen henter sine 25 blant de 30 som mangler, og 30 kom fra filen.
  assert.ok(storage.data.reservations.length >= 30 + POPUP_MAX_DETAILS);
});

test("import venter på en synk i en annen dashboard-fane og skriver etterpå", async () => {
  const all = makeReservations(60);
  const world = slowWorld(all, { latencyMs: 300 });
  const storage = checkedStorage();
  const other = runSyncWhenFree({ ...world.opts("fane-b"), storage });
  while (world.api.count("detail") < 10) await settle();

  const waits = [];
  const imported = importBackup({
    ...world.opts("fane-a-import"),
    storage,
    backup: backupOf(all.slice(50), { tripCategories: { [all[0].id]: "jobb" } }),
    takeFrom: "fane-a",
    onWait: (w) => waits.push(w),
  });
  const resultB = await other;
  const { counts } = await imported;

  // Fane b mistet aldri låsen og hentet alt selv.
  assert.equal(resultB.status, "SYNCED");
  assert.equal(resultB.waited, undefined);
  assert.equal(world.api.count("detail"), 60);
  assert.ok(waits.length > 0);
  assert.equal(waits[0].syncLock.owner, "fane-b");
  // Turene var hentet da importen slapp til, så bare kategorien er ny.
  assert.equal(counts.reservationsAdded, 0);
  assert.equal(counts.categoriesAdded, 1);
  assert.equal(storage.data.reservations.length, 60);
  assert.equal(storage.data.syncLock, null);
});

test("to importer fra samme side mens en annen fane synker: begge filene blir lagret", async () => {
  const all = makeReservations(40);
  const world = slowWorld(all, { latencyMs: 100 });
  // Lageret bruker en runde per lesing og skriving, slik storage.local gjør, så
  // de to importene faktisk flettes inn i hverandre.
  const storage = checkedStorage();
  for (const op of ["get", "set"]) {
    const fn = storage[op].bind(storage);
    storage[op] = async (arg) => {
      await settle();
      return fn(arg);
    };
  }
  // En annen fane holder låsen, så begge importene venter og slipper til samtidig.
  storage.data.syncLock = { owner: "fane-b", role: "page", expiresAt: NOW + 5000 };

  const first = importBackup({ ...world.opts("side-a"), storage, backup: backupOf(all.slice(0, 20)), takeFrom: "side-a" });
  await settle();
  const second = importBackup({ ...world.opts("side-a"), storage, backup: backupOf(all.slice(20)), takeFrom: "side-a" });
  for (let i = 0; i < 20; i++) await settle();
  storage.data.syncLock = null;
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.counts.reservationsAdded, 20);
  assert.equal(b.counts.reservationsAdded, 20);
  assert.equal(storage.data.reservations.length, 40);
  assert.equal(storage.data.syncLock, null);
});

test("withSyncLock slipper låsen også når oppgaven feiler, og skriver ikke uten den", async () => {
  const storage = makeStorage();
  const h = harness(storage, makeApi([]));
  await assert.rejects(
    withSyncLock({ ...h.opts, owner: "imp", role: "import", task: async () => { throw new Error("feil"); } }),
    /feil/,
  );
  assert.equal(storage.data.syncLock, null);

  await assert.rejects(
    withSyncLock({
      ...h.opts,
      owner: "imp",
      role: "import",
      task: async ({ commit }) => {
        // En annen side har tatt låsen. commit skal nekte å skrive.
        storage.data.syncLock = { owner: "side-b", role: "page", expiresAt: NOW + LOCK_LEASE_MS };
        await commit({ reservations: [] });
      },
    }),
    (e) => e.code === "LOCK_LOST",
  );
  assert.ok(!("reservations" in storage.data));
});

test("en synk som venter på en import, sier det i banneret", () => {
  assert.equal(describeProgress({ phase: "import" }), "Importerer sikkerhetskopien…");
});
