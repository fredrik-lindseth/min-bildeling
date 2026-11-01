// Synkmotoren. Ren orkestrering: fetch, storage, auth, klokke og sleep sendes
// inn, så den kan testes i node med stubs (stats/test/sync.test.js).
//
// Den kjører i utvidelsessiden som ba om synken (dashbordet eller popupen),
// ikke i background. Firefox avslutter MV3-event-pagen på idle midt i en lang
// synk, og da forsvant alt som lå i minnet. Et vanlig dokument blir ikke
// suspendert. Alt som hentes lagres fortløpende, så en avbrutt synk fortsetter
// der den slapp neste gang. Se docs/arkitektur.md og docs/api-bruk.md.

import {
  ApiError,
  BREAKER_THRESHOLD,
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
// Lås mellom sider: en side som dør, slipper låsen når leasen går ut. Leasen
// fornyes etter tid, før et kall når mer enn en tredjedel av den er brukt, så
// trege svar ikke lar den gå ut mens siden fortsatt synker.
export const LOCK_LEASE_MS = 45 * 1000;
export const LOCK_RENEW_MS = LOCK_LEASE_MS / 3;
export const LOCK_CONFIRM_MS = 100;
// En side som venter på låsen, ser etter så ofte. Den viser fremdriften fra
// syncState i mellomtiden og tar over når låsen er ledig.
export const LOCK_POLL_MS = 1000;
// En detalj som feiler (404, 500 o.l.) legges i syncState.failed og prøves
// igjen ved senere automatiske synker med økende mellomrom: én time, så fire,
// seksten og 64 timer, deretter høyst én gang i uken. Synkroniser-knappen
// prøver dem med en gang.
export const DETAIL_RETRY_BASE_MS = HOUR;
export const DETAIL_RETRY_FACTOR = 4;
export const DETAIL_RETRY_MAX_MS = 7 * DAY;
// Svarer en reservasjon 404 så mange ganger, er den slettet hos Dele. Den
// prøves ikke igjen, heller ikke av Synkroniser, og telles ikke lenger blant
// dem som mangler detaljer. Med backoff-rekken over tar det knapt et døgn.
export const NOT_FOUND_MAX_ATTEMPTS = 4;
// Popupen lukkes så fort brukeren klikker utenfor. Den henter derfor bare så
// mange detaljer per synk, resten tar dashbordet.
export const POPUP_MAX_DETAILS = 25;
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

// Id-er som har feilet, styres av retryDue(), ikke av fryst-regelen.
export function selectRefreshIds(reservations, nowMs, fallbackFetchedAt, failed = {}) {
  return reservations
    .filter((r) => failed[r.id] == null && needsDetail(r, nowMs, fallbackFetchedAt))
    .map((r) => r.id);
}

export function detailRetryDelayMs(attempts) {
  const n = Math.max(1, attempts || 1);
  return Math.min(DETAIL_RETRY_MAX_MS, DETAIL_RETRY_BASE_MS * DETAIL_RETRY_FACTOR ** (n - 1));
}

export function isGone(failure) {
  return failure.status === 404 && failure.attempts >= NOT_FOUND_MAX_ATTEMPTS;
}

export function retryDue(failure, nowMs, force = false) {
  if (isGone(failure)) return false;
  if (force || failure.lastAttemptAt == null) return true;
  return nowMs - failure.lastAttemptAt >= detailRetryDelayMs(failure.attempts);
}

function dueRetryIds(failed, nowMs, force) {
  return Object.entries(failed)
    .filter(([, f]) => retryDue(f, nowMs, force))
    .map(([id]) => id);
}

// Feilede id-er som fortsatt prøves igjen. En lagret reservasjon som ikke kunne
// oppdateres, vises med forrige versjon og mangler altså ikke detaljer.
export function countFailed(failed, reservations) {
  const stored = new Set(reservations.map((r) => r.id));
  let missing = 0;
  let stale = 0;
  for (const [id, f] of Object.entries(failed)) {
    if (isGone(f)) continue;
    if (stored.has(id)) stale += 1;
    else missing += 1;
  }
  return { failed: missing + stale, missing, stale };
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

/**
 * Kan `owner` ta låsen nå? Den er ledig når ingen har den, når leasen er ute,
 * eller når den er vår. En lås fra popupen kan alltid tas: popupen lever
 * bare til brukeren klikker utenfor, og det finnes høyst én om gangen, så en
 * popup-lås er enten fra en popup som er lukket, eller fra en som et
 * dashboard skal ta over fra. Ren funksjon.
 */
export function lockIsFree(lock, owner, nowMs) {
  if (!lock || lock.owner === owner) return true;
  if (lock.expiresAt <= nowMs) return true;
  return lock.role === "popup";
}

async function acquireLock(storage, owner, role, now, sleep) {
  const { syncLock } = await storage.get(["syncLock"]);
  if (!lockIsFree(syncLock, owner, now())) return false;
  await storage.set({ syncLock: { owner, role, expiresAt: now() + LOCK_LEASE_MS } });
  // storage.local har ingen compare-and-set. Les tilbake etter en kort pause, så
  // taper den av to samtidige sider som skrev først.
  await sleep(LOCK_CONFIRM_MS);
  const check = await storage.get(["syncLock"]);
  return check.syncLock?.owner === owner;
}

function lockLost() {
  return new ApiError("LOCK_LOST", "En annen side har overtatt synkroniseringen");
}

async function releaseLock(storage, owner) {
  const { syncLock } = await storage.get(["syncLock"]);
  if (syncLock?.owner === owner) await storage.set({ syncLock: null });
}

/**
 * Kjør én synk.
 *
 * @returns {Promise<object>} { status, error?, count, fetched, fetchedSoFar, failed, missing, stale,
 *   failedThisRun, pending, total, done, calls, durationMs }
 *   status: SYNCED | PARTIAL | PAUSED | CACHED | BUSY | ERROR
 *   failed: missing + stale, altså feilede id-er som prøves igjen senere
 *   missing: feilede som ikke er lagret, stale: lagrede som ikke kunne oppdateres
 *   done/total: id-er behandlet av køen, til fremdriftslinjen.
 *   fetchedSoFar: detaljer hentet i denne synken, også før et avbrudd.
 *   error:  NOT_LOGGED_IN | AUTH_EXPIRED | SERVICE_UNAVAILABLE | annen melding
 */
export async function runSync({
  fetch,
  storage,
  getAuth,
  clientId,
  owner,
  role = "page",
  force = false,
  full = false,
  maxDetails = Infinity,
  onProgress = () => {},
  onLock = () => {},
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random,
}) {
  const startedAt = now();
  const readStored = async () => {
    const stored = await storage.get(["reservations", "lastSync", ...SYNC_STORAGE_KEYS]);
    const prev = stored.syncState || null;
    return {
      stored,
      reservations: Array.isArray(stored.reservations) ? stored.reservations : [],
      prev,
      failed: { ...(prev?.failed || {}) },
      resumable:
        prev != null && prev.phase !== "done" && Array.isArray(prev.pendingIds) && prev.pendingIds.length > 0,
    };
  };
  let { stored, reservations, prev, failed, resumable } = await readStored();
  const servicePaused =
    prev?.phase === "paused" &&
    prev.reason === "SERVICE_UNAVAILABLE" &&
    startedAt - (prev.pausedAt || 0) < SERVICE_PAUSE_MS;

  const summary = (extra) => ({
    count: reservations.length,
    pending: resumable ? prev.pendingIds.length : 0,
    ...countFailed(failed, reservations),
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

  if (!(await acquireLock(storage, owner, role, now, sleep))) return summary({ status: "BUSY" });
  onLock(true);
  // Mellom lesingen over og låsen kan siden vi tar over fra (popupen) ha
  // lagret en batch til. Les lageret på nytt nå som låsen er vår, ellers
  // skrives den batchen over med den gamle kopien og hentes en gang til.
  ({ stored, reservations, prev, failed, resumable } = await readStored());
  let leaseRenewedAt = now();

  // Sjekk at låsen fortsatt er vår, og forny den. Kalles før hver skriving og
  // før hvert kall når en tredjedel av leasen er brukt. storage.local har ingen
  // compare-and-set, men har en annen side tatt over etter et svar som brukte
  // hele leasen, stopper vi her i stedet for å synke parallelt.
  const holdLease = async (extraMs = 0) => {
    const { syncLock } = await storage.get(["syncLock"]);
    if (syncLock && syncLock.owner !== owner) throw lockLost();
    await storage.set({ syncLock: { owner, role, expiresAt: now() + extraMs + LOCK_LEASE_MS } });
    leaseRenewedAt = now();
  };

  const calls = emptyCounters();
  const initial = resumable ? Boolean(prev.initial) : reservations.length === 0;
  const pause = initial ? PAUSE_INITIAL_MS : PAUSE_INCREMENTAL_MS;
  let requestsMade = 0;
  const polite = async () => {
    if (requestsMade++ > 0) await sleep(pause);
    const { syncLock } = await storage.get(["syncLock"]);
    if (syncLock && syncLock.owner !== owner) throw lockLost();
    if (now() - leaseRenewedAt >= LOCK_RENEW_MS) await holdLease();
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
    onWait: ({ ms }) => holdLease(ms),
  });

  let pendingIds = [];
  let total = 0;
  let done = 0;
  let fetched = 0;
  // En synk kan gå over flere sideåpninger. Det som ble hentet før avbruddet,
  // står i syncState, så «Hentet X av Y» teller hele synken.
  const fetchedBefore = resumable ? prev.fetchedSoFar || 0 : 0;
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
    fetchedSoFar: fetchedBefore + fetched,
    calls,
    updatedAt: now(),
    ...extra,
  });

  const flush = async (phase = "details", extra = {}) => {
    const { syncLock } = await storage.get(["syncLock"]);
    if (syncLock && syncLock.owner !== owner) throw lockLost();
    if (buffer.length > 0) {
      reservations = mergeReservations(reservations, buffer);
      buffer = [];
    }
    await storage.set({
      reservations,
      syncState: state(phase, extra),
      syncLock: { owner, role, expiresAt: now() + LOCK_LEASE_MS },
    });
    leaseRenewedAt = now();
  };

  const markFailed = (id, status) => {
    failed[id] = {
      status: status ?? null,
      attempts: (failed[id]?.attempts || 0) + 1,
      lastAttemptAt: now(),
    };
    calls.failed += 1;
    failedThisRun += 1;
  };

  const finish = async (status, error = null) => {
    const finishedAt = now();
    // Les historikken på nytt: en annen side kan ha skrevet sin siden vi startet.
    const fresh = await storage.get(["syncHistory"]);
    const history = Array.isArray(fresh.syncHistory) ? fresh.syncHistory : [];
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
    onLock(false);
    return {
      status,
      ...(error ? { error } : {}),
      count: reservations.length,
      fetched,
      fetchedSoFar: fetchedBefore + fetched,
      ...countFailed(failed, reservations),
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
      done = prev.done || 0;
      const queued = new Set(pendingIds);
      for (const id of dueRetryIds(failed, startedAt, force)) {
        if (queued.has(id)) continue;
        pendingIds.push(id);
        // Feilet den tidligere i denne synken, er den talt som ferdig. Nå står
        // den i køen igjen, ellers ville totalen vokse forbi antall turer.
        if (failed[id].lastAttemptAt >= prev.startedAt) done = Math.max(0, done - 1);
      }
      total = Math.max(prev.total || 0, done + pendingIds.length);
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
      const retryIds = dueRetryIds(failed, startedAt, force);
      pendingIds = [...new Set([...newIds, ...refreshIds, ...retryIds])];
      total = pendingIds.length;
      done = 0;
    }

    await flush();

    // Feil per id (404, 500 på én detalj) hopper over id-en. Feiler flere ulike
    // id-er med 5xx på rad, er det tjenesten og ikke reservasjonene, og da
    // stopper bryteren synken som ved 503.
    let itemServerErrorsInRow = 0;
    // Med maxDetails (popupen) stopper denne synken før totalen. Siden sier
    // da i banneret hvor langt den kommer, og at resten hentes i dashboardet.
    const stopsAt = Math.min(total, done + maxDetails);
    while (pendingIds.length > 0 && fetched + failedThisRun < maxDetails) {
      const id = pendingIds[0];
      await polite();
      try {
        const detail = await fetchReservationDetail(client, id);
        buffer.push({ ...detail, detailFetchedAt: now() });
        delete failed[id];
        fetched += 1;
        itemServerErrorsInRow = 0;
      } catch (e) {
        if (e.code === "SERVICE_UNAVAILABLE" && e.status >= 500) {
          // Bryteren slo ut på denne id-en. Legg den til side med backoff, så
          // en reservasjon som alltid svarer 503 ikke stopper neste synk på
          // samme sted. 429 og nettverksfeil gjelder ikke id-en og lar den stå.
          markFailed(id, e.status);
          pendingIds.shift();
          done += 1;
          throw e;
        }
        if (e.code !== "NOT_FOUND" && e.code !== "HTTP_ERROR") throw e;
        markFailed(id, e.status);
        itemServerErrorsInRow = e.status >= 500 ? itemServerErrorsInRow + 1 : 0;
        if (itemServerErrorsInRow >= BREAKER_THRESHOLD) {
          pendingIds.shift();
          done += 1;
          throw new ApiError("SERVICE_UNAVAILABLE", "Flere reservasjoner på rad feilet", e.status);
        }
      }
      pendingIds.shift();
      done += 1;
      onProgress({
        phase: "details",
        current: done,
        total,
        ...(stopsAt < total ? { stopsAt, limit: maxDetails } : {}),
      });
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
    if (e.code === "LOCK_LOST") {
      // Den andre siden eier syncState nå. Ikke skriv over den.
      return await finish("BUSY");
    }
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

/**
 * Som runSync, men venter i stedet for å gi opp når en annen side synker.
 * Mens den venter, meldes fremdriften fra syncState i storage som
 * { phase, current, total, elsewhere: true }, slik den andre siden lagrer
 * den. Blir låsen ledig (den andre er ferdig, er lukket så leasen gikk ut,
 * eller var en popup), kjøres synken på nytt uten force: en uferdig synk
 * fortsetter der den slapp, og en fersk lastSync gir CACHED.
 * Resultatet har waited: true når siden ventet, så den vet at andre kan ha
 * lagret nye turer.
 */
export async function runSyncWhenFree(opts) {
  const { storage, owner, now = Date.now, sleep = defaultSleep, onProgress = () => {} } = opts;
  let result = await runSync(opts);
  let waited = false;
  while (result.status === "BUSY") {
    waited = true;
    for (;;) {
      const { syncLock, syncState } = await storage.get(["syncLock", "syncState"]);
      if (lockIsFree(syncLock, owner, now())) break;
      if (syncState?.phase === "details" && syncState.total > 0) {
        onProgress({ phase: "details", current: syncState.done || 0, total: syncState.total, elsewhere: true });
      } else {
        onProgress({ phase: "elsewhere", elsewhere: true });
      }
      await sleep(LOCK_POLL_MS);
    }
    result = await runSync({ ...opts, force: false });
  }
  return waited ? { ...result, waited } : result;
}
