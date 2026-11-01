import { currentMonthStats, monthlyCosts, usagePatterns } from "../lib/stats.js";
import { createMonthBars } from "../lib/chart-helpers.js";
import { formatNOK, formatSyncTime } from "../lib/formatters.js";
import { estimateOwnershipCost } from "../lib/ownership-cost.js";
import {
  startSync,
  isAuthError,
  describeSyncResult,
  describeProgress,
  describeProgressShort,
} from "../lib/sync-page.js";
// Popupen lukkes så snart brukeren klikker et annet sted, og da stopper synken.
// Den henter derfor bare et lite antall detaljer om gangen og ber om dashbordet
// for resten. Det som er hentet, står i storage uansett.
import { POPUP_MAX_DETAILS } from "../lib/sync.js";
import { isDemoMode, createDemoSession, createDemoBadge } from "../lib/demo-data.js";

const browserAPI = globalThis.browser ?? globalThis.chrome;
// ?demo=1: syntetiske data, ingen synk og ingen utvidelses-API.
const demo = isDemoMode(window.location.search) ? createDemoSession() : null;

// DOM references
const statusEl = document.getElementById("status");
const statsSection = document.getElementById("stats-section");
const spendThisMonth = document.getElementById("spend-this-month");
const spendLastMonth = document.getElementById("spend-last-month");
const tripsThisMonth = document.getElementById("trips-this-month");
const avgCost = document.getElementById("avg-cost");
const mostUsedCar = document.getElementById("most-used-car");
const monthsCanvas = document.getElementById("months-chart");
const syncBtn = document.getElementById("sync-btn");
const lastSyncedEl = document.getElementById("last-synced");
const dashboardLink = document.getElementById("dashboard-link");

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
const formatAmount = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

let monthsChart = null;

const statusText = document.getElementById("status-text");
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");

function showStatus(message, progress = null) {
  statusEl.classList.remove("status--login");
  statusText.textContent = message;
  removeStatusAction();
  statusEl.hidden = false;

  if (progress !== null) {
    progressEl.hidden = false;
    progressEl.setAttribute("aria-valuenow", String(progress));
    progressBar.style.width = `${progress}%`;
  } else {
    progressEl.hidden = true;
    progressBar.style.width = "0%";
  }
}

function showLoginRequired() {
  statusEl.classList.add("status--login");
  statusText.innerHTML = `<strong>Ikke innlogget</strong><br>Logg inn på app.dele.no og trykk Synkroniser.`;
  removeStatusAction();

  const action = document.createElement("a");
  action.id = "status-action";
  action.className = "btn btn--primary status__action";
  action.textContent = "Åpne app.dele.no";
  action.href = "https://app.dele.no";
  action.target = "_blank";
  action.rel = "noopener";
  statusEl.appendChild(action);

  progressEl.hidden = true;
  progressBar.style.width = "0%";
  statusEl.hidden = false;
}

function removeStatusAction() {
  const existing = document.getElementById("status-action");
  if (existing) existing.remove();
}

// Feil og delvise resultater vises med en Prøv igjen-knapp.
function showSyncMessage(message) {
  showStatus(message);
  const action = document.createElement("button");
  action.type = "button";
  action.id = "status-action";
  action.className = "btn status__action";
  action.textContent = "Prøv igjen";
  action.addEventListener("click", () => syncAndRender(true));
  statusEl.appendChild(action);
}

function hideStatus() {
  statusEl.classList.remove("status--login");
  removeStatusAction();
  statusEl.hidden = true;
  progressEl.hidden = true;
}

function renderStats(reservations) {
  const stats = currentMonthStats(reservations);
  const monthly = monthlyCosts(reservations);

  // Current month spend
  spendThisMonth.textContent = stats.thisMonth
    ? formatNOK.format(stats.thisMonth.total)
    : "0 kr";

  // Last month spend
  spendLastMonth.textContent = stats.lastMonth
    ? formatNOK.format(stats.lastMonth.total)
    : "0 kr";

  // Trips this month
  tripsThisMonth.textContent = stats.tripsThisMonth === 1 ? "1 tur" : `${stats.tripsThisMonth} turer`;

  avgCost.textContent = stats.thisMonth
    ? formatNOK.format(stats.thisMonth.average)
    : "Ingen turer";

  // Most used car (across all data)
  const patterns = usagePatterns(reservations);
  const topCar = patterns.topCars[0];
  mostUsedCar.textContent = topCar ? topCar.name : "–";

  renderLastSixMonths(monthly);

  // Savings vs car ownership this year
  const currentYear = new Date().getFullYear();
  const ownership = estimateOwnershipCost(reservations, currentYear);
  const savingsEl = document.getElementById("yearly-savings");
  if (ownership && ownership.savings > 0) {
    savingsEl.textContent = `ca. ${formatNOK.format(ownership.savings)}`;
  } else if (ownership) {
    savingsEl.textContent = "0 kr";
  } else {
    savingsEl.textContent = "–";
  }

  statsSection.hidden = false;
}

// De seks siste kalendermånedene, med 0 for måneder uten turer, så søylene
// står for faktiske måneder og ikke bare dem som har data.
function renderLastSixMonths(monthly) {
  if (monthsChart) {
    monthsChart.destroy();
    monthsChart = null;
  }
  const totals = new Map(monthly.map((m) => [m.month, m.total]));
  const now = new Date();
  const labels = [];
  const values = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    labels.push(MONTH_SHORT[d.getMonth()]);
    values.push(Math.round(totals.get(key) || 0));
  }
  monthsCanvas.setAttribute(
    "aria-label",
    `Siste 6 måneder: ${labels.map((l, i) => `${l} ${formatAmount.format(values[i])} kr`).join(", ")}`
  );
  monthsChart = createMonthBars(monthsCanvas, labels, values, (v) => formatAmount.format(v));
}

// Wrap sendMessage med timeout + tydelig feil. Background-scriptet kan være
// sovende (MV3 event page) og bruke sekunder på å våkne, og noen ganger
// svarer det aldri (bg-script crash, race etter reload, etc).
async function sendMessage(msg, timeoutMs = 10000) {
  return Promise.race([
    browserAPI.runtime.sendMessage(msg),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`sendMessage timeout: ${msg.type}`)), timeoutMs)
    ),
  ]);
}

function showProgress({ phase, current, total }) {
  const pct = phase === "details" && total > 0 ? Math.round((current / total) * 100) : null;
  showStatus(describeProgress({ phase, current, total }), pct);
  syncBtn.textContent = describeProgressShort({ phase, current, total });
}

async function renderStored() {
  const data = await sendMessage({ type: "GET_DATA" });
  if (!data || !data.reservations || data.reservations.length === 0) return false;
  renderStats(data.reservations);
  lastSyncedEl.textContent = formatSyncTime(data.lastSync);
  return true;
}

// Kjør synken fra popupen og vis resultatet. Feil vises og blir stående.
async function syncAndRender(force) {
  syncBtn.disabled = true;
  syncBtn.textContent = "Synkroniserer…";
  if (force) showStatus("Synkroniserer…");

  const result = await startSync({
    force,
    maxDetails: POPUP_MAX_DETAILS,
    onProgress: showProgress,
  });
  syncBtn.disabled = false;
  syncBtn.textContent = "Synkroniser";

  let hasData = false;
  try {
    hasData = await renderStored();
  } catch (e) {
    console.error("[popup] GET_DATA etter sync feilet:", e);
    showStatus("Klarte ikke å lese lagrede turer. Åpne popupen på nytt.");
    return;
  }

  if (isAuthError(result.error)) {
    showLoginRequired();
    return;
  }
  const message = describeSyncResult(result);
  if (message) {
    showSyncMessage(message);
  } else if (hasData) {
    hideStatus();
  } else {
    showStatus("Ingen turer lagret ennå.");
  }
}

async function init() {
  if (demo) {
    syncBtn.remove();
    document.querySelector(".header__title").append(" ", createDemoBadge(document));
    renderStats(demo.reservations);
    hideStatus();
    return;
  }
  // Vis "Laster…" som standard så popup aldri ser tom ut. hideStatus()
  // kalles eksplisitt når vi har data å rendere.
  showStatus("Laster…");

  let authStatus;
  try {
    authStatus = await sendMessage({ type: "GET_AUTH_STATUS" });
  } catch (e) {
    console.error("[popup] GET_AUTH_STATUS feilet:", e);
    showStatus("Fikk ikke kontakt med utvidelsen. Åpne popupen på nytt.");
    return;
  }

  let hasData = false;
  try {
    hasData = await renderStored();
    if (hasData) hideStatus();
  } catch (e) {
    console.error("[popup] GET_DATA feilet:", e);
    showStatus("Klarte ikke å lese lagrede turer. Åpne popupen på nytt.");
    return;
  }

  if (!authStatus || !authStatus.hasAuth) {
    // Med lagrede data er tallene viktigere enn login-boksen.
    if (!hasData) showLoginRequired();
    return;
  }

  // Synker bare hvis det er over en time siden sist, eller en synk er uferdig.
  if (!hasData) showStatus("Synkroniserer…");
  await syncAndRender(false);
}

syncBtn.addEventListener("click", () => syncAndRender(true));

function openDashboard(hash = "") {
  if (demo) {
    window.open(`../dashboard/dashboard.html?demo=1${hash}`, "_blank");
    return;
  }
  browserAPI.tabs.create({
    url: browserAPI.runtime.getURL(`dashboard/dashboard.html${hash}`),
  });
}

dashboardLink.addEventListener("click", () => openDashboard());

// Metoden og kildene for sparetallet står i bilregnestykket i dashboardet.
document.getElementById("savings-method").addEventListener("click", (e) => {
  e.preventDefault();
  openDashboard("#bilregnestykket");
});

// Initialize
init();
