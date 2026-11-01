import { currentMonthStats, monthlyCosts, usagePatterns } from "../lib/stats.js";
import { createSparkline } from "../lib/chart-helpers.js";
import { formatNOK, formatSyncTime } from "../lib/formatters.js";
import { estimateOwnershipCost } from "../lib/ownership-cost.js";
import { startSync, isAuthError, describeSyncResult, describeProgress } from "../lib/sync-page.js";

// Popupen lukkes så snart brukeren klikker et annet sted, og da stopper synken.
// Den henter derfor bare et lite antall detaljer om gangen og ber om dashbordet
// for resten. Det som er hentet, står i storage uansett.
const POPUP_MAX_DETAILS = 25;

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// DOM references
const statusEl = document.getElementById("status");
const statsSection = document.getElementById("stats-section");
const spendThisMonth = document.getElementById("spend-this-month");
const spendLastMonth = document.getElementById("spend-last-month");
const tripsThisMonth = document.getElementById("trips-this-month");
const avgCost = document.getElementById("avg-cost");
const mostUsedCar = document.getElementById("most-used-car");
const sparklineCanvas = document.getElementById("sparkline-canvas");
const syncBtn = document.getElementById("sync-btn");
const lastSyncedEl = document.getElementById("last-synced");
const dashboardLink = document.getElementById("dashboard-link");
const emptyNote = document.getElementById("empty-note");

// Track chart instance to avoid leaks on re-render
let sparklineChart = null;

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
    progressBar.style.width = `${progress}%`;
  } else {
    progressEl.hidden = true;
    progressBar.style.width = "0%";
  }
}

function showLoginRequired() {
  statusEl.classList.add("status--login");
  statusText.innerHTML = `<strong>Du må logge inn på Bildeleringen</strong><br>Vi henter dataene dine så snart du er innlogget.`;
  removeStatusAction();

  const action = document.createElement("a");
  action.id = "status-action";
  action.className = "status__action";
  action.textContent = "Åpne app.dele.no →";
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
  action.className = "status__action status__action--retry";
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
  tripsThisMonth.textContent = stats.tripsThisMonth;

  // Average cost per trip
  avgCost.textContent = stats.thisMonth
    ? formatNOK.format(stats.thisMonth.average)
    : "–";

  // Show empty note if no trips this month
  emptyNote.hidden = !(stats.tripsThisMonth === 0 && stats.thisMonth === null);

  // Most used car (across all data)
  const patterns = usagePatterns(reservations);
  const topCar = patterns.topCars[0];
  mostUsedCar.textContent = topCar ? topCar.name : "–";

  // Sparkline: last 6 months (destroy previous instance to avoid leak)
  if (sparklineChart) {
    sparklineChart.destroy();
    sparklineChart = null;
  }
  const last6 = monthly.slice(-6);
  if (last6.length > 1) {
    sparklineChart = createSparkline(
      sparklineCanvas,
      last6.map((m) => m.total)
    );
  }

  // Savings vs car ownership this year
  const currentYear = new Date().getFullYear();
  const ownership = estimateOwnershipCost(reservations, currentYear);
  const savingsEl = document.getElementById("yearly-savings");
  if (ownership && ownership.savings > 0) {
    savingsEl.textContent = formatNOK.format(ownership.savings);
  } else if (ownership) {
    savingsEl.textContent = "0 kr";
    savingsEl.classList.remove("card__value--tertiary");
  } else {
    savingsEl.textContent = "–";
  }

  statsSection.hidden = false;
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
  if (force) showStatus("Synkroniserer…");

  const result = await startSync({
    force,
    maxDetails: POPUP_MAX_DETAILS,
    onProgress: showProgress,
  });
  syncBtn.disabled = false;

  let hasData = false;
  try {
    hasData = await renderStored();
  } catch (e) {
    console.error("[popup] GET_DATA etter sync feilet:", e);
    showStatus(`Klarte ikke å lese lagrede data: ${e.message}`);
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
    showStatus("Ingen data funnet");
  }
}

async function init() {
  // Vis "Laster…" som standard så popup aldri ser tom ut. hideStatus()
  // kalles eksplisitt når vi har data å rendere.
  showStatus("Laster…");

  let authStatus;
  try {
    authStatus = await sendMessage({ type: "GET_AUTH_STATUS" });
  } catch (e) {
    console.error("[popup] GET_AUTH_STATUS feilet:", e);
    showStatus("Kunne ikke kontakte utvidelsen. Prøv å åpne popup-en på nytt.");
    return;
  }

  let hasData = false;
  try {
    hasData = await renderStored();
    if (hasData) hideStatus();
  } catch (e) {
    console.error("[popup] GET_DATA feilet:", e);
    showStatus("Klarte ikke å lese lagrede data.");
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

// Dashboard link — open in new tab
dashboardLink.addEventListener("click", () => {
  browserAPI.tabs.create({
    url: browserAPI.runtime.getURL("dashboard/dashboard.html"),
  });
});

// Initialize
init();
