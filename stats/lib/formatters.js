export const formatNOK = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// «sist synkronisert 1. nov. kl. 09:14». Samme format i popupen og i
// headersetningen i dashboardet, der den står som andre halvdel.
export function formatSyncPhrase(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const day = date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return `sist synkronisert ${day} kl. ${time}`;
}

// Popupen viser frasen alene, med stor forbokstav.
export function formatSyncTime(timestamp) {
  const phrase = formatSyncPhrase(timestamp);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
