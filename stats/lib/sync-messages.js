// Norske tekster for synkresultater og fremdrift. Ren modul uten nettleser-API,
// så den kan testes i node.

export function isAuthError(error) {
  return error === "NOT_LOGGED_IN" || error === "AUTH_EXPIRED";
}

/**
 * Norsk tekst for et synkresultat som brukeren bør se, eller null når alt
 * gikk som det skulle. Auth-feil håndteres for seg av sidene (login-boksen).
 */
export function describeSyncResult(result) {
  if (!result) return "Synkroniseringen svarte ikke. Prøv igjen.";
  // Sidene venter på en annen side som synker (runSyncWhenFree) og får ikke
  // BUSY tilbake. Kommer den likevel, er det ingenting brukeren skal gjøre.
  if (result.status === "BUSY") return null;
  if (result.error === "SERVICE_UNAVAILABLE") {
    return withProgress(result, "Dele svarer ikke nå. Prøver igjen senere.");
  }
  // Andre feil kommer som rå tekst («API-feil 403», nettleserens egne meldinger).
  // Den står i syncHistory og vises i utviklerpanelet, ikke her.
  if (result.error && !isAuthError(result.error)) {
    return withProgress(result, "Synkroniseringen stoppet. Prøv igjen om litt.");
  }
  const failures = describeFailures(result);
  if (result.status === "PARTIAL") {
    return join(
      `Hentet ${result.fetchedSoFar} av ${result.total}. Resten hentes i dashboardet.`,
      failures
    );
  }
  if (!failures) return null;
  if (result.status === "SYNCED" && result.failedThisRun > 0 && result.total) {
    return join(`Hentet ${result.fetchedSoFar} av ${result.total}.`, failures);
  }
  return failures;
}

function join(...parts) {
  return parts.filter(Boolean).join(" ");
}

// Turer der detaljkallet feilet, ligger i syncState.failed og prøves igjen med
// økende mellomrom (se sync.js), så brukeren skal vite at de kommer. En lagret
// tur som ikke kunne oppdateres, vises med forrige versjon og mangler ingenting.
function describeFailures({ missing = 0, stale = 0 }) {
  const total = missing + stale;
  if (total === 0) return null;
  const retry = total === 1 ? "Den prøves igjen senere." : "De prøves igjen senere.";
  let what;
  if (stale === 0) {
    what = missing === 1 ? "1 tur mangler detaljer." : `${missing} turer mangler detaljer.`;
  } else if (missing === 0) {
    what =
      stale === 1
        ? "1 tur kunne ikke oppdateres og vises slik den var."
        : `${stale} turer kunne ikke oppdateres og vises slik de var.`;
  } else {
    const turer = missing === 1 ? "tur" : "turer";
    what = `${missing} ${turer} mangler detaljer, og ${stale} kunne ikke oppdateres.`;
  }
  return `${what} ${retry}`;
}

function withProgress(result, message) {
  if (!result.total) return message;
  return `${message} Hentet ${result.fetchedSoFar} av ${result.total}.`;
}

// Fremdriften står bare i banneret. Synk-knappen er deaktivert og sier
// «Synkroniserer…» uten tall, så samme teller ikke vises to ganger.
export function describeProgress({ phase, current, total, limit, elsewhere }) {
  if (elsewhere) {
    return phase === "details" && total > 0
      ? `Et annet vindu henter detaljer for ${current} av ${total} turer…`
      : "Et annet vindu synkroniserer…";
  }
  if (phase === "list") {
    return total ? `Henter listen over ${total} turer…` : "Henter turlisten…";
  }
  if (phase === "details" && total > 0) {
    // Bare popupen har en grense, og den stopper før totalen. Banneret i
    // popupen er smalt, så teksten holdes på én linje.
    if (limit) return `Henter ${current} av ${total}. Resten hentes i dashboardet.`;
    return `Henter detaljer for ${current} av ${total} turer…`;
  }
  return "Synkroniserer…";
}

/**
 * Er hele historikken hentet? Så lenge synken har id-er igjen i køen
 * (syncState.pendingIds), mangler turer, og tall som summerer over hele
 * historikken (spart i år, mest brukte bil, årstall) blir feil. Samme regel
 * som avgjør om en synk kan fortsette der den slapp (runSync i sync.js).
 * @returns {{ complete: boolean, done: number, total: number }}
 */
export function historyProgress(syncState) {
  const pending = Array.isArray(syncState?.pendingIds) ? syncState.pendingIds.length : 0;
  const complete = !syncState || syncState.phase === "done" || pending === 0;
  const total = syncState?.total || 0;
  return { complete, done: Math.min(syncState?.done || 0, total), total };
}

/**
 * Kort tekst der tall som trenger hele historikken, er holdt tilbake.
 * subject er det som holdes tilbake, med stor forbokstav («Totalen»).
 */
export function describeIncompleteHistory({ done, total }, subject = "Tallet") {
  const count = total > 0 ? ` Hentet ${done} av ${total}.` : "";
  return `${subject} vises når alle turene er hentet.${count}`;
}
