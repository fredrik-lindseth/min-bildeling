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
  if (result.status === "PARTIAL") {
    return `Hentet ${result.done} av ${result.total}. Resten hentes når du åpner dashboardet.`;
  }
  if (result.failed > 0) return missingDetails(result.failed);
  return null;
}

// Turer der detaljkallet feilet, ligger i syncState.failed og prøves igjen med
// økende mellomrom (se sync.js), så brukeren skal vite at de kommer.
function missingDetails(n) {
  return n === 1
    ? "1 tur mangler detaljer. Den prøves igjen senere."
    : `${n} turer mangler detaljer. De prøves igjen senere.`;
}

function withProgress(result, message) {
  if (!result.total) return message;
  return `${message} Hentet ${result.done} av ${result.total}.`;
}

export function describeProgress({ phase, current, total }) {
  if (phase === "list") {
    return total ? `Henter listen over ${total} turer…` : "Henter turlisten…";
  }
  if (phase === "details" && total > 0) return `Henter detaljer for ${current} av ${total} turer…`;
  return "Synkroniserer…";
}
