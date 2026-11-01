export const formatNOK = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatSyncTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `Sist synkronisert: ${date.toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

// Andre halvdel av headersetningen i dashboardet: «sist synkronisert 1. nov. kl. 09:14».
export function formatSyncPhrase(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const day = date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return `sist synkronisert ${day} kl. ${time}`;
}
