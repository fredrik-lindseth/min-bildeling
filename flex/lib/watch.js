import { toLocalISO, parseLocalISO } from "./format.js";
import { freeBlocks, blockMinutes, matchesFilters, withinDistance } from "./flex.js";

// window = { start: Date, end: Date }, det effektive vinduet polleren søkte med.
// Gis eksplisitt; funksjonen leser aldri watch.earliestStart selv.
export function detectHits(searchResult, watch, window) {
  const cars = (searchResult.cars || [])
    .filter((c) => matchesFilters(c, watch.filters))
    .filter((c) => withinDistance(c, watch.filters));
  const minMinutes = watch.minHours * 60;
  const hits = [];
  for (const c of cars) {
    for (const b of freeBlocks(c.availability, window.start, window.end)) {
      const mins = blockMinutes(b);
      if (mins < minMinutes) continue;
      hits.push({
        carId: c.carId,
        carNumber: c.carNumber,
        model: c.model,
        category: c.carCategory,
        location: { name: c.location?.name, distance: c.location?.distance },
        blockStart: b.start,
        blockEnd: b.end,
        blockHours: mins / 60,
      });
    }
  }
  return hits;
}

function hitKey(hit) {
  return `${hit.carId}|${toLocalISO(hit.blockEnd)}`;
}

// Ren de-dup + rydding + relay-retry. Nøkkel på blokkslutt (stabil på tvers av
// polls, i motsetning til blokkstart som klippes til det bevegelige vindusstart).
// notified inn er watchens hovedbok; now er en Date.
export function reconcile(hits, notified, now) {
  const prev = notified || {};
  const next = {};
  // Behold eksisterende nøkler som ikke er passert.
  for (const [key, entry] of Object.entries(prev)) {
    const endISO = key.slice(key.indexOf("|") + 1);
    if (parseLocalISO(endISO) > now) next[key] = entry;
  }
  const browserHits = [];
  const relayHits = [];
  for (const hit of hits) {
    const key = hitKey(hit);
    const existing = prev[key];
    if (!existing) {
      browserHits.push(hit);
      relayHits.push(hit);
      next[key] = { notifiedAt: toLocalISO(now), relayed: false };
    } else {
      if (existing.relayed === false) relayHits.push(hit);
      next[key] = existing; // bevar relayed-status
    }
  }
  return { browserHits, relayHits, notified: next };
}
