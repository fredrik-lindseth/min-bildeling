import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSyncPhrase, formatSyncTime } from "../lib/formatters.js";

test("popupen og headeren viser «sist synkronisert» i samme format", () => {
  const t = Date.parse("2026-11-01T09:14:00Z");
  const phrase = formatSyncPhrase(t);
  assert.match(phrase, /^sist synkronisert \S.* kl\. \d{2}:\d{2}$/);
  assert.equal(formatSyncTime(t), `S${phrase.slice(1)}`);
  assert.equal(formatSyncTime(null), "");
});
