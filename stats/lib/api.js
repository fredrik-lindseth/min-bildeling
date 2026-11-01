// HTTP-klient mot dele.no. Ren modul: fetch, sleep, now og random sendes inn,
// så alt kan testes i node uten nettleser. Synkmotoren i sync.js bruker den.
//
// Snillhetsreglene (se docs/api-bruk.md):
// - 429, 502, 503, 504 og nettverksfeil gjelder hele tjenesten. Vi venter så
//   lenge Retry-After ber om, ellers eksponentiell backoff med jitter.
// - Bryter: tre slike feil på rad stopper synken (SERVICE_UNAVAILABLE).
// - 500 på et detaljkall gjelder som regel bare den ene reservasjonen. Den
//   prøves én gang til, så gir kallet opp med HTTP_ERROR og synken går videre.
//   Uten dette låste én reservasjon med fast 500 hele synken for godt.
// - 401 avbryter med en gang (AUTH_EXPIRED).
// - Alle kall bærer X-Client så Dele kan kjenne oss igjen i loggene.

export const API_BASE = "https://app.dele.no/api";
export const PAGE_SIZE = 100;
export const BREAKER_THRESHOLD = 3;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 30000;
// Ber serveren om lengre pause enn dette, gir vi opp denne synken framfor å
// holde en fane åpen og vente.
export const MAX_RETRY_AFTER_MS = 120000;

// Hvor mange forsøk et detaljkall får når serveren svarer 500.
export const ITEM_ATTEMPTS = 2;

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "ApiError";
    this.code = code; // AUTH_EXPIRED | NOT_FOUND | HTTP_ERROR | SERVICE_UNAVAILABLE
    this.status = status;
  }
}

// Retry-After kan være sekunder ("3") eller en HTTP-dato.
export function parseRetryAfter(value, nowMs) {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

export function backoffMs(failureNumber, random) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failureNumber - 1));
  // Jitter 50–150 % så flere klienter ikke treffer samtidig etter en feil.
  return Math.round(base * (0.5 + random()));
}

export function emptyCounters() {
  return { list: 0, detail: 0, retries: 0, failed: 0 };
}

/**
 * @param {object} opts
 * @param {Function} opts.fetch
 * @param {string} opts.token        authorization-headeren slik dele.no lagrer den
 * @param {string} opts.clientId     f.eks. "bildeleringen-stats/1.2.0"
 * @param {Function} opts.sleep      (ms) => Promise
 * @param {Function} opts.now        () => ms
 * @param {Function} opts.random     () => [0, 1)
 * @param {object}   opts.counters   muteres: list/detail/retries per HTTP-kall
 * @param {Function} [opts.onWait]   ({ms, reason}) når vi venter før nytt forsøk
 */
export function createClient({ fetch, token, clientId, sleep, now, random, counters, onWait }) {
  let consecutiveFailures = 0;

  /**
   * @param {string} url
   * @param {"list"|"detail"} kind
   * @param {object} [opts]
   * @param {boolean} [opts.itemScoped]  500 gjelder bare dette ene elementet
   */
  async function getJson(url, kind, { itemScoped = false } = {}) {
    let itemFailures = 0;
    for (;;) {
      counters[kind] += 1;
      let res = null;
      let networkError = null;
      try {
        res = await fetch(url, {
          headers: {
            authorization: token,
            accept: "application/json",
            "X-Client": clientId,
          },
        });
      } catch (e) {
        networkError = e;
      }

      if (res && res.ok) {
        consecutiveFailures = 0;
        return { data: await res.json(), headers: res.headers };
      }

      if (res && res.status === 401) throw new ApiError("AUTH_EXPIRED", "Innloggingen er utløpt", 401);

      if (itemScoped && res && res.status === 500) {
        itemFailures += 1;
        if (itemFailures >= ITEM_ATTEMPTS) throw new ApiError("HTTP_ERROR", "API-feil 500", 500);
        const wait = backoffMs(itemFailures, random);
        counters.retries += 1;
        if (onWait) await onWait({ ms: wait, reason: 500 });
        await sleep(wait);
        continue;
      }

      const transient = networkError || TRANSIENT_STATUSES.has(res.status);
      if (!transient) {
        consecutiveFailures = 0;
        const code = res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR";
        throw new ApiError(code, `API-feil ${res.status}`, res.status);
      }

      consecutiveFailures += 1;
      const status = res ? res.status : null;
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        throw new ApiError("SERVICE_UNAVAILABLE", "Tjenesten svarer ikke", status);
      }

      const retryAfter = res ? parseRetryAfter(res.headers.get("retry-after"), now()) : null;
      if (retryAfter != null && retryAfter > MAX_RETRY_AFTER_MS) {
        throw new ApiError("SERVICE_UNAVAILABLE", "Tjenesten ba om lang pause", status);
      }
      const wait = retryAfter ?? backoffMs(consecutiveFailures, random);
      counters.retries += 1;
      if (onWait) await onWait({ ms: wait, reason: status ?? "network" });
      await sleep(wait);
    }
  }

  return { getJson };
}

export function listUrl(membershipId, page) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(PAGE_SIZE),
    sort: "start,desc",
    membershipId,
  });
  return `${API_BASE}/reservations/historic?${params}`;
}

export function detailUrl(id) {
  return `${API_BASE}/reservations/${encodeURIComponent(id)}`;
}

// Listeelementene er en slank versjon (id, start, end, state, location som
// streng, ingen pris eller km). Bare detaljkallet gir hele reservasjonen.
export async function fetchListPage(client, membershipId, page) {
  const { data, headers } = await client.getJson(listUrl(membershipId, page), "list");
  const total = Number(headers.get("x-totalelements"));
  return {
    items: Array.isArray(data) ? data : [],
    totalElements: Number.isFinite(total) && headers.get("x-totalelements") != null ? total : null,
  };
}

export async function fetchReservationDetail(client, id) {
  const { data } = await client.getJson(detailUrl(id), "detail", { itemScoped: true });
  return data;
}
