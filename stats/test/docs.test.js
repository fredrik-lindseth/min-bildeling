// docs/api-bruk.md er skrevet for utviklerne hos Dele og lover konkrete tall.
// Denne testen binder hvert tall til konstanten i koden, så dokumentet ikke
// kan skli fra det utvidelsen faktisk gjør. Feiler den, rett dokumentet eller
// koden, ikke testen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SYNC_INTERVAL_MS,
  DETAIL_BATCH_SIZE,
  PAUSE_INITIAL_MS,
  PAUSE_INCREMENTAL_MS,
  SETTLE_WINDOW_MS,
  DETAIL_REFRESH_MS,
  LOCK_LEASE_MS,
  LOCK_RENEW_MS,
  SERVICE_PAUSE_MS,
  POPUP_MAX_DETAILS,
  DETAIL_RETRY_MAX_MS,
  NOT_FOUND_MAX_ATTEMPTS,
  detailRetryDelayMs,
} from "../lib/sync.js";
import {
  PAGE_SIZE,
  BREAKER_THRESHOLD,
  BACKOFF_BASE_MS,
  MAX_RETRY_AFTER_MS,
  ITEM_ATTEMPTS,
  backoffMs,
} from "../lib/api.js";

const doc = readFileSync(new URL("../../docs/api-bruk.md", import.meta.url), "utf8");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Dokumentet skriver små tall med bokstaver, slik norsk rettskrivning vil.
const WORDS = ["null", "én", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni", "ti",
  "elleve", "tolv", "tretten", "fjorten", "femten", "seksten"];

function word(n) {
  assert.ok(Number.isInteger(n), `${n} er ikke et heltall`);
  return n < WORDS.length ? WORDS[n] : String(n);
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function whole(ms, unit) {
  const n = ms / unit;
  assert.ok(Number.isInteger(n), `${ms} ms er ikke et helt antall av ${unit} ms`);
  return n;
}

function mentions(phrase) {
  assert.ok(doc.includes(phrase), `docs/api-bruk.md mangler «${phrase}»`);
}

test("listesiden: størrelse", () => {
  mentions(`size=${PAGE_SIZE}`);
  mentions(`${PAGE_SIZE} per side`);
});

test("pauser mellom kall", () => {
  mentions(`med ${PAUSE_INITIAL_MS} ms pause mellom dem`);
  mentions(`Pausen er da ${PAUSE_INCREMENTAL_MS} ms`);
});

test("lagring i batcher", () => {
  mentions(`i grupper på ${DETAIL_BATCH_SIZE}`);
});

test("lås: lease og fornyelse", () => {
  const lease = whole(LOCK_LEASE_MS, SECOND);
  mentions(`gjelder i ${lease} sekunder og fornyes hvert ${whole(LOCK_RENEW_MS, SECOND)}. sekund`);
  mentions(`et svar som tok over ${lease} sekunder`);
});

test("popupens grense", () => {
  mentions(`Popupen henter høyst ${POPUP_MAX_DETAILS} detaljer om gangen`);
  mentions(`henter ${POPUP_MAX_DETAILS} til`);
});

test("synkintervall", () => {
  assert.equal(SYNC_INTERVAL_MS, HOUR);
  mentions("over én time siden forrige fullførte synkronisering");
});

test("fryst-regelen", () => {
  assert.equal(DETAIL_REFRESH_MS, DAY);
  mentions("høyst én gang i døgnet");
  mentions(`minst ${word(whole(SETTLE_WINDOW_MS, DAY))} dager etter reservasjonens slutt`);
});

test("backoff og jitter", () => {
  mentions(`venter den ${whole(BACKOFF_BASE_MS, SECOND)} s, så ${whole(BACKOFF_BASE_MS * 2, SECOND)} s`);
  assert.equal(backoffMs(1, () => 0), BACKOFF_BASE_MS * 0.5);
  assert.equal(backoffMs(1, () => 1), BACKOFF_BASE_MS * 1.5);
  mentions("±50 %");
});

test("bryteren", () => {
  mentions(`${capitalize(word(BREAKER_THRESHOLD))} slike feil på rad`);
  mentions(`Feiler ${word(BREAKER_THRESHOLD)} ulike reservasjoner på rad`);
  mentions(`venter da i minst ${word(whole(SERVICE_PAUSE_MS, MINUTE))} minutter`);
  mentions(`mer enn ${word(whole(MAX_RETRY_AFTER_MS, MINUTE))} minutter`);
});

test("feil per reservasjon og nye forsøk", () => {
  assert.equal(ITEM_ATTEMPTS, 2);
  mentions("Den prøves én gang til, og svarer den 500 igjen, hoppes den over");

  const hours = [1, 2, 3, 4].map((n) => whole(detailRetryDelayMs(n), HOUR));
  mentions(
    `tidligst etter ${word(hours[0])} time, så etter ${word(hours[1])}, ${word(hours[2])} og ${word(hours[3])} timer, deretter én gang i uken`
  );
  assert.equal(DETAIL_RETRY_MAX_MS, 7 * DAY);
  assert.equal(detailRetryDelayMs(5), DETAIL_RETRY_MAX_MS);
  mentions(`Svarer den 404 ${word(NOT_FOUND_MAX_ATTEMPTS)} ganger, regnes den som slettet`);
});
