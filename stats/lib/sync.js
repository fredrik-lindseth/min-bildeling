// Synkmotoren. Ren orkestrering: fetch, storage, auth, klokke og sleep sendes
// inn, så den kan testes i node med stubs (stats/test/sync.test.js).
//
// Den kjører i utvidelsessiden som ba om synken (dashbordet eller popupen),
// ikke i background. Firefox avslutter MV3-event-pagen på idle midt i en lang
// synk, og da forsvant alt som lå i minnet. Et vanlig dokument blir ikke
// suspendert. Alt som hentes lagres fortløpende, så en avbrutt synk fortsetter
// der den slapp neste gang. Se AGENTS.md (API-regler) og docs/api-bruk.md.

import {
  createClient,
  emptyCounters,
  fetchListPage,
  fetchReservationDetail,
  PAGE_SIZE,
} from "./api.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SYNC_INTERVAL_MS = HOUR;
export const DETAIL_BATCH_SIZE = 20;
export const PAUSE_INITIAL_MS = 250;
export const PAUSE_INCREMENTAL_MS = 100;
// En reservasjon kan få endret pris og km en stund etter at den er avsluttet.
// Detaljen hentes på nytt høyst én gang i døgnet til den er hentet minst sju
// dager etter slutt. Deretter regnes den som fryst og hentes aldri igjen.
export const SETTLE_WINDOW_MS = 7 * DAY;
export const DETAIL_REFRESH_MS = DAY;
// Lås mellom sider: en side som dør, slipper låsen når leasen går ut.
export const LOCK_LEASE_MS = 45 * 1000;
export const LOCK_CONFIRM_MS = 100;
// En detalj som feiler (404 o.l.) prøves ved de neste synkene, maks så mange ganger.
export const MAX_DETAIL_ATTEMPTS = 3;
export const HISTORY_LENGTH = 3;
// Etter at bryteren har slått ut, starter ikke en automatisk synk igjen før
// denne pausen er over. Brukeren kan alltid trykke Synkroniser selv.
export const SERVICE_PAUSE_MS = 10 * MINUTE;
const MAX_LIST_PAGES = 200;

export const SYNC_STORAGE_KEYS = ["syncState", "syncLock", "syncHistory"];

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endMs(r) {
  const t = Date.parse(r.end);
  return Number.isNaN(t) ? null : t;
}

/**
 * Om detaljen for en lagret reservasjon bør hentes på nytt nå.
 * fallbackFetchedAt brukes for data lagret før detailFetchedAt fantes (lastSync).
 */
export function needsDetail(r, nowMs, fallbackFetchedAt = null) {
  const fetchedAt = r.detailFetchedAt ?? fallbackFetchedAt;
  if (fetchedAt == null) return true;
  const end = endMs(r);
  if (end == null) return false;
  if (fetchedAt >= end + SETTLE_WINDOW_MS) return false;
  return nowMs - fetchedAt >= DETAIL_REFRESH_MS;
}

export function selectRefreshIds(reservations, nowMs, fallbackFetchedAt, failed = {}) {
  return reservations
    .filter((r) => !isGivenUp(failed[r.id]) && needsDetail(r, nowMs, fallbackFetchedAt))
    .map((r) => r.id);
}

function isGivenUp(failure) {
  return failure != null && failure.attempts >= MAX_DETAIL_ATTEMPTS;
}

function startMs(r) {
  const t = Date.parse(r.start);
  return Number.isNaN(t) ? 0 : t;
}

export function mergeReservations(existing, details) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const d of details) byId.set(d.id, d);
  return [...byId.values()].sort((a, b) => startMs(b) - startMs(a));
}

async function acquireLock(storage, owner, now, sleep) {
  const { syncLock } = await storage.get(["syncLock"]);
  if (syncLock && syncLock.owner !== owner && syncLock.expiresAt > now()) return false;
  await storage.set({ syncLock: { owner, expiresAt: now() + LOCK_LEASE_MS } });
  // storage.local har ingen compare-and-set. Les tilbake etter en kort pause, så
  // taper den av to samtidige sider som skrev først.
  await sleep(LOCK_CONFIRM_MS);
  const check = await storage.get(["syncLock"]);
  return check.syncLock?.owner === owner;
}

async function releaseLock(storage, owner) {
  const { syncLock } = await storage.get(["syncLock"]);
  if (syncLock?.owner === owner) await storage.set({ syncLock: null });
}

/**
 * Kjør én synk.
 *
 * @returns {Promise<object>} { status, error?, count, fetched, failed, pending, total, done, calls, durationMs }
 *   status: SYNCED | PARTIAL | PAUSED | CACHED | BUSY | ERROR
 *   error:  NOT_LOGGED_IN | AUTH_EXPIRED | SERVICE_UNAVAILABLE | annen melding
 */
export async function runSync({
  fetch,
  storage,
  getAuth,
  clientId,
  owner,
  force = false,
  full = false,
  maxDetails = Infinity,
  onProgress = () => {},
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random,
}) {
  const startedAt = now();
  const stored = await storage.get(["reservations", "lastSync", ...SYNC_STORAGE_KEYS]);
  let reservations = Array.isArray(stored.reservations) ? stored.reservations : [];
  const prev = stored.syncState || null;
  const failed = { ...(prev?.failed || {}) };
  const resumable =
    prev != null && prev.phase !== "done" && Array.isArray(prev.pendingIds) && prev.pendingIds.length > 0;
  const servicePaused =
    prev?.phase === "paused" &&
    prev.reason === "SERVICE_UNAVAILABLE" &&
    startedAt - (prev.pausedAt || 0) < SERVICE_PAUSE_MS;

  const summary = (extra) => ({
    count: reservations.length,
    pending: resumable ? prev.pendingIds.length : 0,
    failed: Object.keys(failed).length,
    ...extra,
  });

  if (!force) {
    if (servicePaused) return summary({ status: "PAUSED", error: "SERVICE_UNAVAILABLE" });
    if (!resumable && stored.lastSync && startedAt - stored.lastSync < SYNC_INTERVAL_MS) {
      return summary({ status: "CACHED" });
    }
  }

  const auth = await getAuth();
  if (!auth || !auth.token) return summary({ status: "ERROR", error: "NOT_LOGGED_IN" });

  if (!(await acquireLock(storage, owner, now, sleep))) return summary({ status: "BUSY" });

  const calls = emptyCounters();
  const initial = resumable ? Boolean(prev.initial) : reservations.length === 0;
  const pause = initial ? PAUSE_INITIAL_MS : PAUSE_INCREMENTAL_MS;
  let requestsMade = 0;
  const polite = async () => {
    if (requestsMade++ > 0) await sleep(pause);
  };

  const client = createClient({
    fetch,
    token: auth.token,
    clientId,
    sleep,
    now,
    random,
    counters: calls,
    // Forleng låsen over ventetiden, ellers kan en annen side ta over mens vi venter.
    onWait: ({ ms }) =>
      storage.set({ syncLock: { owner, expiresAt: now() + ms + LOCK_LEASE_MS } }),
  });

  let pendingIds = [];
  let total = 0;
  let done = 0;
  let fetched = 0;
  let failedThisRun = 0;
  let buffer = [];

  const state = (phase, extra = {}) => ({
    phase,
    initial,
    startedAt: resumable ? prev.startedAt : startedAt,
    pendingIds,
    failed,
    total,
    done,
    calls,
    updatedAt: now(),
    ...extra,
  });

  const flush = async (phase = "details", extra = {}) => {
    if (buffer.length > 0) {
      reservations = mergeReservations(reservations, buffer);
      buffer = [];
    }
    await storage.set({
      reservations,
      syncState: state(phase, extra),
      syncLock: { owner, expiresAt: now() + LOCK_LEASE_MS },
    });
  };

  const finish = async (status, error = null) => {
    const finishedAt = now();
    const history = Array.isArray(stored.syncHistory) ? stored.syncHistory : [];
    const entry = {
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      status,
      error,
      calls,
      fetched,
      failed: failedThisRun,
    };
    await storage.set({ syncHistory: [entry, ...history].slice(0, HISTORY_LENGTH) });
    await releaseLock(storage, owner);
    return {
      status,
      ...(error ? { error } : {}),
      count: reservations.length,
      fetched,
      failed: Object.keys(failed).length,
      failedThisRun,
      pending: pendingIds.length,
      total,
      done,
      calls,
      durationMs: finishedAt - startedAt,
    };
  };

  try {
    if (resumable) {
      pendingIds = prev.pendingIds.slice();
      total = prev.total || pendingIds.length;
      done = prev.done || 0;
    } else {
      onProgress({ phase: "list", current: 0, total: null });
      const knownIds = new Set([...reservations.map((r) => r.id), ...Object.keys(failed)]);
      const newIds = [];
      const seen = new Set();
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        await polite();
        const { items, totalElements } = await fetchListPage(client, auth.membershipId, page);
        let hitKnown = false;
        for (const item of items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (knownIds.has(item.id)) hitKnown = true;
          else newIds.push(item.id);
        }
        onProgress({ phase: "list", current: page + 1, total: totalElements });
        if (items.length < PAGE_SIZE) break;
        // Listen er sortert nyeste først. Treffer vi en kjent id og kjente pluss
        // nye dekker totalen serveren oppgir, er resten av sidene kjent fra før.
        const covered = totalElements == null || knownIds.size + newIds.length >= totalElements;
        if (!full && hitKnown && covered) break;
      }

      const refreshIds = selectRefreshIds(reservations, startedAt, stored.lastSync ?? null, failed);
      const retryIds = Object.entries(failed)
        .filter(([, f]) => !isGivenUp(f))
        .map(([id]) => id);
      pendingIds = [...new Set([...newIds, ...refreshIds, ...retryIds])];
      total = pendingIds.length;
      done = 0;
    }

    await flush();

    while (pendingIds.length > 0 && fetched + failedThisRun < maxDetails) {
      const id = pendingIds[0];
      await polite();
      try {
        const detail = await fetchReservationDetail(client, id);
        buffer.push({ ...detail, detailFetchedAt: now() });
        delete failed[id];
        fetched += 1;
      } catch (e) {
        if (e.code !== "NOT_FOUND" && e.code !== "HTTP_ERROR") throw e;
        failed[id] = { status: e.status, attempts: (failed[id]?.attempts || 0) + 1 };
        calls.failed += 1;
        failedThisRun += 1;
      }
      pendingIds.shift();
      done += 1;
      onProgress({ phase: "details", current: done, total });
      if (buffer.length >= DETAIL_BATCH_SIZE) await flush();
    }

    if (pendingIds.length > 0) {
      await flush("details");
      return await finish("PARTIAL");
    }

    await flush("done", { finishedAt: now() });
    await storage.set({ lastSync: now() });
    return await finish("SYNCED");
  } catch (e) {
    const code = e.code === "AUTH_EXPIRED" || e.code === "SERVICE_UNAVAILABLE" ? e.code : null;
    const reason = code || e.message || String(e);
    try {
      await flush("paused", { reason, pausedAt: now() });
    } catch (saveError) {
      console.error("[sync] Klarte ikke å lagre delvis resultat", saveError);
    }
    return await finish("PAUSED", reason);
  }
}
