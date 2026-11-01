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
  if (!result) return "Synkroniseringen ga ikke noe svar.";
  if (result.status === "BUSY") {
    return "En synkronisering pågår allerede i et annet vindu. Prøv igjen om et minutt.";
  }
  if (result.error === "SERVICE_UNAVAILABLE") {
    return withProgress(
      result,
      "Dele sin tjeneste svarer ikke akkurat nå. Prøver igjen ved neste synkronisering."
    );
  }
  if (result.error && !isAuthError(result.error)) {
    return withProgress(result, `Synkroniseringen stoppet: ${result.error}`);
  }
  if (result.status === "PARTIAL") {
    return `Hentet ${result.done} av ${result.total}. Resten hentes når du åpner dashbordet.`;
  }
  if (result.status === "SYNCED" && result.failedThisRun > 0) {
    return `Hentet ${result.done - result.failedThisRun} av ${result.total}. ${missingDetails(result.failed)}`;
  }
  if (result.failed > 0) return missingDetails(result.failed);
  return null;
}

// Reservasjoner der detaljkallet feilet, ligger i syncState.failed og prøves
// igjen med økende mellomrom (se sync.js), så brukeren skal vite at de kommer.
function missingDetails(n) {
  const what = n === 1 ? "1 reservasjon mangler detaljer" : `${n} reservasjoner mangler detaljer`;
  return `${what} fordi Dele svarte med feil. De prøves igjen ved senere synkroniseringer.`;
}

function withProgress(result, message) {
  if (!result.total) return message;
  return `${message} Hentet ${result.done} av ${result.total} så langt.`;
}

export function describeProgress({ phase, current, total }) {
  if (phase === "list") {
    return total ? `Henter reservasjonslisten (${total} totalt)…` : "Henter reservasjonslisten…";
  }
  if (phase === "details" && total > 0) return `Henter detaljer: ${current} av ${total}`;
  return "Synkroniserer…";
}
