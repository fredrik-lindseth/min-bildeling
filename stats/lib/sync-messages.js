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
  if (result.status === "BUSY") return "Synkroniserer allerede i et annet vindu.";
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
      `Hentet ${result.fetchedSoFar} av ${result.total}. Resten hentes når du åpner dashboardet.`,
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

export function describeProgress({ phase, current, total }) {
  if (phase === "list") {
    return total ? `Henter listen over ${total} turer…` : "Henter turlisten…";
  }
  if (phase === "details" && total > 0) return `Henter detaljer for ${current} av ${total} turer…`;
  return "Synkroniserer…";
}

// Kort form til synk-knappen, så knapp og banner viser samme tall.
export function describeProgressShort({ phase, current, total }) {
  if (phase === "details" && total > 0) return `Synkroniserer ${current} av ${total}`;
  return "Synkroniserer…";
}
