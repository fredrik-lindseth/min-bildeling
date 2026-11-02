import {
  filterValid,
  filterDriven,
  costStats,
  monthlyCosts,
  yearlyCosts,
  usagePatterns,
  mileageStats,
  bookingPatterns,
  costYears,
  keepSelectedYear,
  yearSummaries,
  yearToDate,
  describeYearToDate,
  averagePerYear,
  mostExpensiveYear,
  sortYearSummaries,
  BOOKING_METHOD,
} from "../lib/stats.js";

import { renderMethodPanel } from "../lib/method-panel.js";

import {
  drawChart,
  barChartConfig,
  lineChartConfig,
  resolveColor,
  applyChartTheme,
  axes,
  onColorSchemeChange,
} from "../lib/chart-helpers.js";

import { formatNOK, formatSyncPhrase } from "../lib/formatters.js";

import { estimateOwnershipCost, homeOrganizationId, COMPARISON_CAR, OWNERSHIP_METHOD } from "../lib/ownership-cost.js";

import {
  loadCategories,
  saveCategory,
  saveCategories,
  categoryStats,
  autoSuggestAll,
  DEFAULT_KEYWORDS,
  mergeKeywords,
  matchKeyword,
  keywordHits,
  normalizeUserKeywords,
  normalizeCategorySettings,
  resolveCategories,
  knownTripCategories,
  STOP_WORDS,
  parseKeywordInput,
  loadUserKeywords,
  loadCategorySettings,
  migrateLegacyCategories,
  addCustomCategory,
  renameCustomCategory,
  removeCustomCategory,
  addKeyword,
  removeKeyword,
  resetCategory,
  moveCategory,
  categoryChanges,
} from "../lib/categories.js";

import { storage as extensionStorage } from "../lib/browser-polyfill.js";
import { isDemoMode, createDemoSession, createDemoBadge } from "../lib/demo-data.js";
import {
  startSync,
  owner as syncOwner,
  isAuthError,
  describeSyncResult,
  describeProgress,
} from "../lib/sync-page.js";
import { historyProgress, describeIncompleteHistory } from "../lib/sync-messages.js";
import { stateForSyncError } from "../lib/auth-state.js";
import { showAuthBanner } from "../lib/auth-banner.js";

import { totalCO2, monthlyCO2, averageCarComparison, CO2_METHOD } from "../lib/co2.js";
import { createBackup, parseBackup, describeImport, importPart } from "../lib/backup.js";
import { importBackup, BACKUP_STORAGE_KEYS } from "../lib/backup-import.js";

import {
  TRANSPORT_MODES,
  loadTransportData,
  saveTransportData,
  transportSummary,
  hasTransportEntries,
  TRANSPORT_METHOD,
} from "../lib/transport.js";

const browserAPI = globalThis.browser ?? globalThis.chrome;

// ?demo=1: syntetiske data og et lager i minnet. Ingen synk, ingen
// utvidelses-API, så siden kan også åpnes over vanlig http.
const demo = isDemoMode(window.location.search) ? createDemoSession() : null;
const storage = demo ? demo.storage : extensionStorage;

// ---------- Diagramfarger ----------

applyChartTheme();
// Høyden kommer fra .chart-frame i CSS-en, ikke fra bredden.
Chart.defaults.maintainAspectRatio = false;

// Varmekartet bruker én kulør i fem trinn, fra sunken til accent. Trinnene
// blandes i CSS, så det finnes ingen fargeverdier her.
const HEAT_STEPS = [0, 25, 50, 75, 100].map(
  (pct) => `color-mix(in srgb, var(--color-accent) ${pct}%, var(--color-sunken))`
);

// Annet i Turkategorier og egen bil i Transport er ikke chart-farger.
const NEUTRAL_SERIES = "--color-border-strong";

function chartColor(n) {
  return resolveColor(`--color-chart-${n}`);
}

// Kakestykker skilles med 2 px strek i flatefargen.
function doughnutDataset(data, colors) {
  return {
    data,
    backgroundColor: colors,
    borderColor: resolveColor("--color-surface"),
    borderWidth: 2,
  };
}

function doughnutOptions(label) {
  return {
    responsive: true,
    cutout: "55%",
    plugins: {
      legend: {
        position: "right",
        labels: { boxWidth: 12, boxHeight: 12, color: resolveColor("--color-text-secondary") },
      },
      tooltip: { callbacks: { label } },
    },
  };
}

// ---------- Formatters ----------

const formatKm = new Intl.NumberFormat("nb-NO", {
  maximumFractionDigits: 0,
});

const formatFixedDecimal = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatMonthYear = new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" });

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "mai", "jun",
  "jul", "aug", "sep", "okt", "nov", "des",
];

const MONTH_NAMES_FULL = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

function formatMonthLabel(key) {
  // "YYYY-MM" -> "jan 2024"
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

// Vis tall med mellomrom som tusen-separator (norsk konvensjon).
// Bruker vanlig mellomrom (ikke NBSP) så det er trygt i input-felt.
function formatNumberDisplay(n) {
  if (n == null || n === 0) return "";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Strip mellomrom, godta komma som desimal, returner Number.
function parseNumberInput(str) {
  if (str == null) return 0;
  const cleaned = String(str).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatDuration(hours) {
  if (hours == null || isNaN(hours)) return "–";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} t`;
  return `${h} t ${m} min`;
}

// ---------- DOM Helpers ----------

function $(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

// ---------- DOM References ----------

const statusEl = $("status");
const statusText = $("status-text");
const progressBar = $("progress-bar");
const progressFill = $("progress-fill");
const emptyState = $("empty-state");
const firstRun = $("first-run");
const restoreOffer = $("restore-offer");
const mainContent = $("main-content");
const syncBtn = $("sync-btn");
const headerMetaEl = $("header-meta");

// Headeren er én setning: «176 turer i 2023–2025 for 41 000 kr, sist
// synkronisert 1. nov. kl. 09:14». Demomodus har ingen synk og får bare første del.
function updateHeaderMeta(reservations, lastSync) {
  // Samme utvalg som Kostnader og Bruksmønster, så headeren og seksjonene
  // teller likt. Avbestilte og turer uten pris er med i lageret, men ikke her.
  const valid = filterValid(reservations || []);
  let summary = "";
  if (!tripHistory.complete) {
    // Antallet og summen over alle år blir feil før hele historikken er hentet.
    summary = tripHistory.total > 0 ? `hentet ${tripHistory.done} av ${tripHistory.total} turer` : "";
  } else if (valid.length > 0) {
    const total = valid.reduce((sum, r) => sum + (r.price?.total || 0), 0);
    const years = [...new Set(valid.map((r) => new Date(r.start).getFullYear()))]
      .sort((a, b) => a - b);
    const yearLabel =
      years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0]}`;
    summary = `${formatTrips(valid.length)} i ${yearLabel} for ${formatNOK.format(total)}`;
  }
  const synced = formatSyncPhrase(lastSync);
  const text = [summary, synced].filter(Boolean).join(", ");
  headerMetaEl.textContent = text.charAt(0).toUpperCase() + text.slice(1);
}

// Er hele historikken hentet? Se historyProgress i lib/sync-messages.js og
// «Foreløpige tall» i docs/design.md. Demomodus har alltid alt.
let tripHistory = { complete: true, done: 0, total: 0 };

// ---------- Chart instances (for cleanup) ----------
const charts = {};

function draw(name, canvas, config) {
  charts[name] = drawChart(charts[name], canvas, config);
}

// For diagrammer som forsvinner fordi det ikke lenger er data å vise.
function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    charts[name] = null;
  }
}

// ---------- Status / UI ----------

function showStatus(message) {
  statusEl.classList.remove("status--login");
  removeStatusAction();
  statusText.textContent = message;
  statusEl.hidden = false;
  emptyState.hidden = true;
}

// Hvorfor innloggingen mangler, med én handling som løser det. Se lib/auth-state.js.
function showAuthProblem({ state, tabId }) {
  progressBar.hidden = true;
  emptyState.hidden = true;
  firstRun.hidden = true;
  showAuthBanner({
    statusEl,
    textEl: statusText,
    state,
    tabId,
    getStatus: () => sendMessage({ type: "GET_AUTH_STATUS" }),
    onRetry: () => syncAndRender(false),
    onWait: (message) => showStatus(message),
  });
}

function removeStatusAction() {
  const existing = document.getElementById("status-action");
  if (existing) existing.remove();
}

// Meldingen blir stående. Bare ekte feil får Prøv igjen. Et delvis resultat
// eller turer som prøves igjen senere, er ikke noe brukeren må gjøre noe med.
function showSyncMessage(message, { retry }) {
  showStatus(message);
  if (!retry) return;
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
}

function showProgress(pct) {
  progressBar.hidden = false;
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressFill.style.width = `${pct}%`;
}

function showEmpty() {
  emptyState.hidden = false;
  mainContent.hidden = true;
  // Behold login-prompt synlig hvis den vises, den er viktigere enn empty-state
  if (!statusEl.classList.contains("status--login")) {
    hideStatus();
  }
}

function showMain() {
  mainContent.hidden = false;
  emptyState.hidden = true;
  firstRun.hidden = true;
  restoreOffer.hidden = true;
  // Under synk står banneret med fremdriften over tallene som fylles inn.
  if (!syncing) hideStatus();
  scrollToHashOnce();
  // Seksjonene var skjult til nå, så en tidligere scroll-hendelse kan ha
  // fjernet markeringen. Regn den ut på nytt når de vises.
  updateActiveNav();
}

// Seksjonene er skjult når siden lastes, så nettleseren finner ikke ankeret i
// en lenke som dashboard.html#klima. Vi hopper dit selv første gang innholdet
// vises. Det gjelder lenken fra popupen og skjermbildescriptet. "instant"
// hindrer myk scroll, så posisjonen er ferdig med en gang.
let hashScrollDone = false;
function scrollToHashOnce() {
  if (hashScrollDone) return;
  hashScrollDone = true;
  const id = decodeURIComponent(window.location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  // Lenken fra «Slik beregnes det» i popupen peker på selve panelet. Det
  // åpnes, og siden ruller til knappen over det.
  if (target.classList.contains("method-detail")) {
    const toggle = target.previousElementSibling;
    target.hidden = false;
    toggle?.setAttribute("aria-expanded", "true");
    (toggle ?? target).scrollIntoView({ behavior: "instant", block: "start" });
    const section = target.closest(".section");
    if (section) setActiveNav(section.id);
    return;
  }
  // Mål inne i en seksjon, som tabellen #per-aar: rull dit og marker
  // seksjonen det står i.
  target.scrollIntoView({ behavior: "instant", block: "start" });
  setActiveNav(target.closest(".section")?.id ?? "");
}

// ---------- Navigation ----------

const navLinks = document.querySelectorAll(".nav__link");

function updateActiveNav() {
  const sections = document.querySelectorAll(".section");
  let current = "";

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    // Utviklerpanelet ligger i en skjult wrapper utenfor ?dev=1 og har da
    // top 0, så uten denne vant det alltid og ingen lenke ble markert.
    if (rect.height === 0) continue;
    // Helt øverst har ingen seksjon nådd linjen ennå. Da er det den første
    // som vises, ellers står navigasjonen uten markering ved last.
    if (!current || rect.top <= 140) current = section.id;
  }

  setActiveNav(current);
}

function setActiveNav(sectionId) {
  navLinks.forEach((link) => {
    if (link.dataset.section === sectionId) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });

navLinks.forEach((link) => {
  link.addEventListener("click", () => setActiveNav(link.dataset.section));
});

// ---------- Messaging ----------

async function sendMessage(msg) {
  return browserAPI.runtime.sendMessage(msg);
}

// ---------- Rendering: Section 1 - Kostnader ----------

let allReservations = [];
let selectedYear = "all";

function getFilteredByYear(reservations, year) {
  if (year === "all") return reservations;
  return reservations.filter((r) => {
    const d = new Date(r.start);
    return d.getFullYear() === Number(year);
  });
}

const yearSelector = $("cost-year-selector");

// Knappene bygges bare på nytt når årene endrer seg, så fokus blir stående
// under opptegningene mens synken går. Valget hentes fra selectedYear.
function buildYearSelector(reservations) {
  const years = costYears(reservations);
  selectedYear = keepSelectedYear(selectedYear, years);

  const options = ["all", ...years.map(String)];
  const current = [...yearSelector.querySelectorAll(".year-btn")].map((b) => b.dataset.year);
  if (current.join() !== options.join()) {
    yearSelector.replaceChildren(
      ...options.map((year) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn year-btn";
        btn.dataset.year = year;
        btn.textContent = year === "all" ? "Alle år" : year;
        return btn;
      })
    );
  }
  markSelectedYear();
}

function markSelectedYear() {
  for (const btn of yearSelector.querySelectorAll(".year-btn")) {
    const active = btn.dataset.year === selectedYear;
    btn.setAttribute("aria-pressed", String(active));
  }
}

yearSelector.addEventListener("click", (e) => {
  const btn = e.target.closest(".year-btn");
  if (!btn) return;
  selectedYear = btn.dataset.year;
  markSelectedYear();
  renderCosts(allReservations);
});

function renderCosts(reservations) {
  const filtered = getFilteredByYear(reservations, selectedYear);
  const stats = costStats(filtered);
  const monthly = monthlyCosts(filtered);
  const yearly = yearlyCosts(filtered);
  const mileage = mileageStats(filtered);

  // Hovedtallet: summen av faktiske beløp, derfor uten «ca.». Summen og
  // årslinjene holdes tilbake til hele historikken er hentet.
  const years = yearly.map((y) => y.year);
  const period = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0] ?? ""}`;
  $("cost-total").hidden = !tripHistory.complete;
  if (!tripHistory.complete) {
    setText("cost-total", "–");
    setText("cost-total-text", describeIncompleteHistory(tripHistory, "Totalen"));
  } else {
    setText("cost-total", stats ? formatNOK.format(stats.total) : "–");
    setText(
      "cost-total-text",
      stats ? `brukt på bildeling i ${period}, fordelt på ${formatTrips(stats.count)}.` : ""
    );
  }

  // Alle år: tre linjer om årene øverst i nøkkeltallene, og en lenke til
  // tabellen i Trender. Også dette venter på hele historikken.
  const showAll = tripHistory.complete && selectedYear === "all" && yearly.length > 1;
  // Per år-tabellen i Trender vises først med tre måneder, som resten av Trender.
  $("cost-all-years-link").hidden = !showAll || monthly.length < 3;
  const [ytdRow, avgRow, topRow] = $("cost-figures").querySelectorAll(".figures__all-years");
  const ytd = showAll ? yearToDate(reservations) : null;
  const avg = showAll ? averagePerYear(reservations) : null;
  const top = showAll ? mostExpensiveYear(yearSummaries(reservations)) : null;
  ytdRow.hidden = !ytd;
  avgRow.hidden = !avg;
  topRow.hidden = !top;
  if (ytd) {
    setText("cost-ytd", formatNOK.format(ytd.total));
    setText("cost-ytd-context", describeYearToDate(ytd));
  }
  if (avg) {
    setText("cost-avg-year", formatNOK.format(avg.perYear));
    setText("cost-avg-year-context", `Fra første tur i ${formatMonthYear.format(new Date(avg.since))} til i dag.`);
  }
  if (top) {
    setText("cost-top-year-label", `Dyreste år, ${top.year}`);
    setText("cost-top-year", formatNOK.format(top.total));
  }

  // Nøkkeltall
  setText("cost-avg-trip", stats ? formatNOK.format(stats.average) : "–");
  setText("cost-median-trip", stats ? formatNOK.format(stats.median) : "–");
  setText("cost-max-trip", stats ? formatNOK.format(stats.max) : "–");
  setText("cost-min-trip", stats ? formatNOK.format(stats.min) : "–");

  // Cost per km
  if (stats && mileage && mileage.total > 0) {
    const costPerKm = stats.total / mileage.total;
    setText("cost-per-km", `${formatNOK.format(costPerKm)}/km`);
  } else {
    setText("cost-per-km", "–");
  }

  // Monthly cost bar chart
  if (monthly.length === 0) {
    destroyChart("monthlyCost");
  } else {
    const labels = monthly.map((m) => formatMonthLabel(m.month));
    const data = monthly.map((m) => m.total);
    draw("monthlyCost", $("monthly-cost-chart"), barChartConfig(labels, data, "Kostnad", { yTitle: "Kr" }));
  }
}

// ---------- Rendering: Section 2 - Bruksmønster ----------

function renderUsage(reservations) {
  const patterns = usagePatterns(reservations);
  const valid = filterValid(reservations);

  // Heatmap
  const heatmapCanvas = $("heatmap-chart");
  renderHeatmapWithLabels(heatmapCanvas, patterns.heatmap);

  // Trips per month line chart
  const tpmEntries = Object.entries(patterns.tripsPerMonth).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (tpmEntries.length === 0) {
    destroyChart("tripsPerMonth");
  } else {
    const labels = tpmEntries.map(([key]) => formatMonthLabel(key));
    const data = tpmEntries.map(([, val]) => val);
    draw("tripsPerMonth", $("trips-per-month-chart"), lineChartConfig(labels, data, "Turer", { yTitle: "Antall" }));
  }

  // Nøkkeltall
  setText("usage-avg-duration", formatDuration(patterns.avgDuration));
  setText("usage-total-trips", valid.length.toString());

  // Top cars list
  const topCarsList = $("top-cars-list");
  topCarsList.replaceChildren();
  const top5 = patterns.topCars.slice(0, 5);
  if (!tripHistory.complete) {
    const li = document.createElement("li");
    li.className = "ranked__empty";
    li.textContent = describeIncompleteHistory(tripHistory, "Listen");
    topCarsList.appendChild(li);
  } else if (top5.length === 0) {
    topCarsList.append(el("li", { className: "ranked__empty", text: "Ingen data" }));
  } else {
    for (let i = 0; i < top5.length; i++) {
      topCarsList.append(rankedItem(top5[i].name, formatTrips(top5[i].count)));
    }
  }
}

/**
 * Draw heatmap with day/hour labels on the canvas directly.
 */
function renderHeatmapWithLabels(canvas, heatmapData) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const dayLabels = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];
  const labelW = 36;
  const labelH = 20;
  const paddingRight = 4;

  const availableW = canvas.clientWidth || 700;
  const cellW = Math.floor((availableW - labelW - paddingRight) / 24);
  const cellH = 24;
  const totalW = labelW + cellW * 24 + paddingRight;
  const totalH = labelH + cellH * 7 + 4;

  canvas.width = totalW * dpr;
  canvas.height = totalH * dpr;
  canvas.style.width = totalW + "px";
  canvas.style.height = totalH + "px";
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, totalW, totalH);

  const max = Math.max(...heatmapData.flat(), 1);

  // Fem trinn fra sunken til accent, løst til ferdige farger for modusen nå.
  const steps = HEAT_STEPS.map(resolveColor);
  const textColor = resolveColor("--color-text-tertiary");

  // Timetall
  ctx.font = "12px " + getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  for (let h = 0; h < 24; h += 3) {
    ctx.fillText(
      String(h).padStart(2, "0"),
      labelW + h * cellW + cellW / 2,
      labelH - 5
    );
  }

  // Day rows
  for (let day = 0; day < 7; day++) {
    const y = labelH + day * cellH;

    // Day label
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    ctx.fillText(dayLabels[day], labelW - 6, y + cellH / 2 + 4);

    for (let hour = 0; hour < 24; hour++) {
      const x = labelW + hour * cellW;
      const intensity = heatmapData[day][hour] / max;
      const step = intensity === 0 ? 0 : Math.max(1, Math.ceil(intensity * 4));
      ctx.fillStyle = steps[step];
      ctx.fillRect(x, y, cellW - 2, cellH - 2);
    }
  }

  // Forklaringen under får de samme fem trinnene som ferdige farger. Står
  // color-mix() igjen i stilen, stopper html2canvas på color(srgb …) og
  // «Last ned bilde» feiler for hele seksjonen.
  document.querySelectorAll(".heatmap-legend__scale span").forEach((el, i) => {
    el.style.backgroundColor = steps[i];
  });
}

// ---------- Rendering: Section 3 - Bookingmønster ----------

const formatLeadDecimal = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatLeadDays(days) {
  if (days == null || isNaN(days)) return "–";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} t`;
  }
  // En desimal opp til 10 dager, deretter heltall
  return days < 10
    ? `${formatLeadDecimal.format(days)} dager`
    : `${Math.round(days)} dager`;
}

// Ytterpunktene spenner fra minutter til måneder, så enheten følger tallet.
// 0 betyr booket ved eller etter starttid.
function formatLeadDuration(hours) {
  if (hours == null || isNaN(hours)) return "–";
  const minutes = Math.round(hours * 60);
  if (minutes < 1) return "rett før avreise";
  if (minutes < 60) return `${minutes} min`;
  const wholeHours = Math.round(hours);
  if (wholeHours < 24) return `${wholeHours} t`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 dag" : `${days} dager`;
}

const formatLongDate = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric" });

function leadContext(extreme) {
  // Stasjonsnavnet har ofte komma selv («Regnbuetorget, Bergen»), så bilen
  // knyttes til stasjonen med «fra».
  return `${formatLongDate.format(new Date(extreme.start))}, ${extreme.carModel} fra ${extreme.station}`;
}

function renderBookingPatterns(reservations) {
  const patterns = bookingPatterns(reservations);

  if (!patterns) {
    $("booking-empty").hidden = false;
    $("booking-content").hidden = true;
    destroyChart("leadTime");
    destroyChart("topStations");
    return;
  }

  $("booking-empty").hidden = true;
  $("booking-content").hidden = false;

  // Nøkkeltall
  setText("booking-avg-lead", formatLeadDays(patterns.avgDays));
  setText("booking-median-lead", formatLeadDays(patterns.medianDays));
  setText(
    "booking-short-notice",
    `${Math.round(patterns.shortNoticeShare * 100)} %`
  );
  setText("booking-unique-stations", String(patterns.uniqueStations));

  const { extremes } = patterns;
  $("booking-extremes").hidden = !extremes;
  if (extremes) {
    setText("booking-longest", formatLeadDuration(extremes.longest.leadHours));
    setText("booking-longest-context", leadContext(extremes.longest));
    setText("booking-shortest", formatLeadDuration(extremes.shortest.leadHours));
    setText("booking-shortest-context", leadContext(extremes.shortest));
  }

  // Lead time histogram
  const distLabels = patterns.distribution.map((b) => b.label);
  const distData = patterns.distribution.map((b) => b.count);
  // Sju faste intervaller: alle etikettene skal stå, også når de er trange.
  const leadConfig = barChartConfig(distLabels, distData, "Turer", { yTitle: "Antall" });
  leadConfig.options.scales.x.ticks = { ...leadConfig.options.scales.x.ticks, autoSkip: false };
  draw("leadTime", $("lead-time-chart"), leadConfig);

  // Top stations (top 10, resten samlet som "Andre")
  const TOP_N = 10;
  const top = patterns.stationsRanked.slice(0, TOP_N);
  const rest = patterns.stationsRanked.slice(TOP_N);
  const stationLabels = top.map((s) => s.name);
  const stationData = top.map((s) => s.count);
  if (rest.length > 0) {
    stationLabels.push(`Andre (${rest.length})`);
    stationData.push(rest.reduce((sum, s) => sum + s.count, 0));
  }

  draw("topStations", $("top-stations-chart"), {
    type: "bar",
    data: {
      labels: stationLabels,
      datasets: [
        {
          label: "Turer",
          data: stationData,
          backgroundColor: chartColor(1),
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${formatKm.format(ctx.parsed.x)} turer`,
          },
        },
      },
      scales: (() => {
        const scales = axes({ yTitle: "Antall turer", horizontal: true });
        scales.x.ticks.precision = 0;
        return scales;
      })(),
    },
  });

  renderMethodPanel($("booking-method-detail"), BOOKING_METHOD, { idPrefix: "booking-metode" });
}

// ---------- Rendering: Section 4 - Kilometer ----------

function renderMileage(reservations) {
  const mileage = mileageStats(reservations);

  if (!mileage) {
    $("km-empty").hidden = false;
    $("km-content").hidden = true;
    return;
  }

  $("km-empty").hidden = true;
  $("km-content").hidden = false;

  // Nøkkeltall
  setText("km-total", `${formatKm.format(mileage.total)} km`);
  setText("km-avg", `${formatKm.format(mileage.average)} km`);
  setText("km-max", `${formatKm.format(mileage.max)} km`);

  // Monthly distance bar chart
  if (mileage.byMonth.length === 0) {
    destroyChart("monthlyKm");
  } else {
    const labels = mileage.byMonth.map(([key]) => formatMonthLabel(key));
    const data = mileage.byMonth.map(([, val]) => val);
    draw("monthlyKm", $("monthly-km-chart"), barChartConfig(labels, data, "Distanse", { yTitle: "Km" }));
  }

  // Km by car list
  const list = $("km-by-car-list");
  list.replaceChildren();
  const top5 = mileage.byCar.slice(0, 5);
  if (top5.length === 0) {
    list.append(el("li", { className: "ranked__empty", text: "Ingen data" }));
  } else {
    for (let i = 0; i < top5.length; i++) {
      list.append(rankedItem(top5[i][0], `${formatKm.format(top5[i][1])} km`));
    }
  }
}

// ---------- Rendering: Section 4 - Trender ----------

function renderTrends(reservations) {
  const monthly = monthlyCosts(reservations);
  const yearly = yearlyCosts(reservations);

  if (monthly.length < 3) {
    $("trends-empty").hidden = false;
    $("trends-content").hidden = true;
    return;
  }

  $("trends-empty").hidden = true;
  $("trends-content").hidden = false;

  // År mot år trenger to år. Med ett år ville panelet stått tomt, så det
  // skjules som sesongsammenligningen under.
  // År mot år sammenligner hele år og venter på hele historikken.
  const showYears = yearly.length >= 2 && tripHistory.complete;
  $("yoy-container").hidden = !showYears;
  $("per-aar").hidden = !showYears;
  if (showYears) {
    // Mer enn tre år i samme diagram blir søyleskog. Resten ligger bak knappen
    // og i tabellen under.
    const toggle = $("yoy-toggle");
    toggle.hidden = yearly.length <= 3;
    toggle.setAttribute("aria-pressed", String(yoyShowAll));
    toggle.textContent = yoyShowAll ? "Vis siste tre år" : "Vis alle år";
    renderYearOverYear(reservations, yoyShowAll ? yearly : yearly.slice(-3));
    renderYearTable(yearSummaries(reservations));
  } else {
    destroyChart("yoy");
    $("yoy-legend").replaceChildren();
    $("year-table-body").replaceChildren();
  }

  // Rolling 3-month average
  renderRollingAverage(monthly);

  // Seasonal comparison (need at least 2 years of data)
  if (yearly.length >= 2) {
    $("seasonal-container").hidden = false;
    renderSeasonalComparison(reservations, yearly);
  } else {
    $("seasonal-container").hidden = true;
    destroyChart("seasonal");
  }
}

// Tilstand som skal overleve opptegningen hvert par sekunder under synk.
let yoyShowAll = false;
let yearTableSort = { key: "year", dir: "asc" };

$("yoy-toggle").addEventListener("click", () => {
  yoyShowAll = !yoyShowAll;
  renderTrends(allReservations);
});

// Første klikk på en tallkolonne viser de største først, som er det man
// leter etter. År starter med det eldste. Neste klikk snur.
$("year-table").addEventListener("click", (e) => {
  const btn = e.target.closest(".year-table__sort");
  if (!btn) return;
  const key = btn.dataset.key;
  if (yearTableSort.key === key) {
    yearTableSort = { key, dir: yearTableSort.dir === "asc" ? "desc" : "asc" };
  } else {
    yearTableSort = { key, dir: key === "year" ? "asc" : "desc" };
  }
  renderYearTable(yearSummaries(allReservations));
});

function renderYearTable(summaries) {
  const table = $("year-table");
  for (const btn of table.querySelectorAll(".year-table__sort")) {
    const sorted = btn.dataset.key === yearTableSort.key;
    const order = yearTableSort.dir === "asc" ? "ascending" : "descending";
    btn.closest("th").setAttribute("aria-sort", sorted ? order : "none");
  }

  const rows = sortYearSummaries(summaries, yearTableSort.key, yearTableSort.dir).map((y) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = String(y.year);
    const cells = [
      formatKm.format(y.trips),
      y.km > 0 ? formatKm.format(y.km) : "–",
      formatNOK.format(y.total),
      formatNOK.format(y.avgPerTrip),
      y.perKm == null ? "–" : formatFixedDecimal.format(y.perKm),
    ].map((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    });
    tr.append(th, ...cells);
    return tr;
  });
  $("year-table-body").replaceChildren(...rows);
}

function renderYearOverYear(reservations, yearly) {
  const canvas = $("yoy-chart");

  // Build datasets per year, indexed by month 0-11
  // Siste år er fylt i chart-1. Årene før er hule søyler med 2 px kant, så
  // seriene skilles på form og ikke bare på farge. Nærmeste år får chart-3,
  // som har størst lyshetsavstand til chart-1.
  const datasets = [];
  const hollowOrder = [3, 5, 2, 4];
  const legend = $("yoy-legend");
  legend.replaceChildren();

  for (let i = 0; i < yearly.length; i++) {
    const year = yearly[i].year;
    const yearData = filterValid(reservations).filter(
      (r) => new Date(r.start).getFullYear() === year
    );

    const byMonth = Array(12).fill(0);
    for (const r of yearData) {
      byMonth[new Date(r.start).getMonth()] += r.price.total;
    }

    const isLatest = i === yearly.length - 1;
    const stepsBack = yearly.length - 1 - i;
    const token = isLatest
      ? "--color-chart-1"
      : `--color-chart-${hollowOrder[(stepsBack - 1) % hollowOrder.length]}`;
    const color = resolveColor(token);
    datasets.push({
      label: String(year),
      data: byMonth,
      backgroundColor: isLatest ? color : "transparent",
      borderColor: color,
      borderWidth: isLatest ? 0 : 2,
      borderRadius: 0,
    });

    const item = document.createElement("span");
    const key = document.createElement("span");
    key.className = "chart-legend__key";
    key.style.color = `var(${token})`;
    if (isLatest) key.style.backgroundColor = `var(${token})`;
    item.append(key, String(year));
    legend.append(item);
  }

  draw("yoy", canvas, {
    type: "bar",
    data: {
      labels: MONTH_NAMES,
      datasets,
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatNOK.format(ctx.parsed.y)}`,
          },
        },
      },
      scales: axes({ yTitle: "Kr" }),
    },
  });
}

function renderRollingAverage(monthly) {
  const canvas = $("rolling-avg-chart");

  if (monthly.length < 3) return;

  const labels = [];
  const data = [];

  for (let i = 2; i < monthly.length; i++) {
    const avg =
      (monthly[i].total + monthly[i - 1].total + monthly[i - 2].total) / 3;
    labels.push(formatMonthLabel(monthly[i].month));
    data.push(Math.round(avg));
  }

  draw("rollingAvg", canvas, lineChartConfig(labels, data, "Snitt tre måneder", { yTitle: "Kr" }));
}

function renderSeasonalComparison(reservations, yearly) {
  const canvas = $("seasonal-chart");
  const valid = filterValid(reservations);

  // Average cost per month across all years
  const monthTotals = Array(12).fill(0);
  const monthCounts = Array(12).fill(0);

  for (const r of valid) {
    const d = new Date(r.start);
    monthTotals[d.getMonth()] += r.price.total;
    monthCounts[d.getMonth()]++;
  }

  const avgPerMonth = monthTotals.map((total, i) =>
    monthCounts[i] > 0 ? Math.round(total / yearly.length) : 0
  );

  draw("seasonal", canvas, barChartConfig(MONTH_NAMES_FULL, avgPerMonth, "Snitt månedskostnad", { yTitle: "Kr" }));
}

// ---------- Rendering: Section 5 - Bilregnestykket ----------

function renderOwnership(reservations) {
  const result = estimateOwnershipCost(reservations);

  if (!result || !tripHistory.complete) {
    $("ownership-empty-text").textContent = tripHistory.complete
      ? "Ingen kjørte turer å regne på ennå."
      : describeIncompleteHistory(tripHistory, "Forskjellen mot egen bil");
    $("ownership-empty").hidden = false;
    $("ownership-content").hidden = true;
    return;
  }

  $("ownership-empty").hidden = true;
  $("ownership-content").hidden = false;

  // Hovedtallet er forskjellen, og regnestykket under viser hvor den kommer fra.
  setText("ownership-savings", `ca. ${formatNOK.format(Math.abs(result.savings))}`);
  setText(
    "ownership-savings-text",
    result.savings > 0
      ? `mindre per år enn å eie en ${result.carName}.`
      : `mer per år enn å eie en ${result.carName}.`
  );
  setLedger("ledger", result.carName, result.ownershipCost, result.sharingCost, result.savings);

  // Ownership breakdown horizontal bar chart
  const bd = result.breakdownOwnership;
  const breakdownLabels = [
    "Verditap",
    "Forsikring",
    "Trafikkforsikringsavgift",
    "Vedlikehold",
    "Parkering",
    "Dekk",
    "Strøm",
  ];
  const breakdownData = [
    bd.depreciation,
    bd.insurance,
    bd.tax,
    bd.maintenance,
    bd.parking,
    bd.tyres,
    bd.energy,
  ];
  // Én serie, én farge. Etikettene på aksen sier hva søylene er.
  draw("ownershipBreakdown", $("ownership-breakdown-chart"), {
    type: "bar",
    data: {
      labels: breakdownLabels,
      datasets: [{
        label: "Kostnad",
        data: breakdownData,
        backgroundColor: chartColor(1),
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = new Intl.NumberFormat("nb-NO").format(ctx.parsed.x);
              return `${val} kr`;
            },
          },
        },
      },
      scales: axes({ yTitle: "Kr", horizontal: true }),
    },
  });

  $("comparison-note").textContent =
    `Regnet mot en ny ${COMPARISON_CAR.name} til antatt ${formatNOK.format(COMPARISON_CAR.price)}.`;

  renderMethodPanel($("ownership-method-detail"), OWNERSHIP_METHOD, { idPrefix: "eierkostnad-metode" });
}

// Regnestykket: egen bil minus bildeling er forskjellen. Egen bil og
// forskjellen er estimater og får «ca.», bildelingen er faktiske beløp.
// Bilen står med navn (fra referansebil.js), samme bil som i hovedtallet.
function setLedger(prefix, carName, ownershipCost, sharingCost, savings) {
  setText(`${prefix}-car-label`, `${carName}, per år`);
  setText(`${prefix}-car`, `ca. ${formatNOK.format(ownershipCost)}`);
  setText(`${prefix}-sharing`, `− ${formatNOK.format(sharingCost)}`);
  setText(`${prefix}-diff`, `ca. ${formatNOK.format(savings)}`);
}

// ---------- Rendering: Section 6 - Turkategorier ----------

// Alt kategoriene trenger, lest ferskt fra lageret. Hver handling i
// redigeringen leser på nytt, så den aldri bygger på en gammel tegning.
async function loadCategoryState() {
  const userKeywords = await loadUserKeywords(storage);
  // Lager fra før rettingen kan ha et ord som både eget og fjernet.
  const settings = normalizeCategorySettings(await loadCategorySettings(storage), userKeywords);
  return {
    settings,
    categories: resolveCategories(settings),
    userKeywords,
    tripCategories: await loadCategories(storage),
  };
}

// Innstillingene skrives i samme storage.set som ordene og valgene, så
// lageret aldri har ord eller valg for en kategori som ikke finnes.
async function saveCategoryState({ settings, userKeywords, tripCategories }) {
  const items = { categorySettings: normalizeCategorySettings(settings, userKeywords) };
  if (userKeywords) items.userKeywords = normalizeUserKeywords(userKeywords, resolveCategories(items.categorySettings));
  if (tripCategories) items.tripCategories = tripCategories;
  await storage.set(items);
}

async function renderCategories(reservations) {
  const state = await loadCategoryState();
  const savedCategories = knownTripCategories(state.tripCategories, state.categories);
  const keywords = mergeKeywords(DEFAULT_KEYWORDS, state.userKeywords, state.settings);

  renderCategoryOverview(reservations, savedCategories, keywords, state.categories);
  renderTripCheck(reservations, savedCategories, keywords, state.categories);
  renderKeywordCard(reservations, state, keywords);
}

// Forslagene teller med i oversikten, men et lagret valg går alltid foran.
function renderCategoryOverview(reservations, savedCategories, keywords, categories) {
  const suggestions = autoSuggestAll(reservations, savedCategories, keywords);
  const stats = categoryStats(reservations, { ...suggestions, ...savedCategories }, categories);

  const entries = Object.entries(stats).filter(([, v]) => v.totalCost > 0);
  if (entries.length === 0) {
    destroyChart("categoryDonut");
  } else {
    // De fem største får hver sin chart-farge etter beløp. Resten samles som
    // «Øvrige» i en nøytral grå, alltid sist, så det aldri trengs en sjette farge.
    const sorted = [...entries].sort(([, a], [, b]) => b.totalCost - a.totalCost);
    const MAX_SLICES = 5;
    const shown = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES) : sorted;
    const labels = shown.map(([, v]) => v.label);
    const data = shown.map(([, v]) => v.totalCost);
    const colors = shown.map((_, i) => chartColor(i + 1));
    if (sorted.length > MAX_SLICES) {
      labels.push("Øvrige");
      data.push(sorted.slice(MAX_SLICES).reduce((sum, [, v]) => sum + v.totalCost, 0));
      colors.push(resolveColor(NEUTRAL_SERIES));
    }

    draw("categoryDonut", $("category-donut-chart"), {
      type: "doughnut",
      data: { labels, datasets: [doughnutDataset(data, colors)] },
      options: doughnutOptions((ctx) => {
        const val = formatNOK.format(ctx.parsed);
        const pct = Math.round((ctx.parsed / data.reduce((a, b) => a + b, 0)) * 100);
        return `${ctx.label}: ${val} (${pct} %)`;
      }),
    });
  }

  const tableEl = $("category-table");
  tableEl.replaceChildren(...entries
    .sort(([, a], [, b]) => b.totalCost - a.totalCost)
    .map(([, val]) => tableRow(val.label, formatTrips(val.count), formatNOK.format(val.totalCost))));
}

// ---------- Sjekk forslag ----------

const TRIP_PAGE_SIZE = 10;
// Filter og hvor langt brukeren har bladd, overlever ny tegning ved synk og
// lagring av nøkkelord.
const tripCheck = { filter: "check", shown: TRIP_PAGE_SIZE };
const formatTripDate = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric", month: "short", year: "numeric",
});

// Valgene bygges ved hver tegning, så egne kategorier er med.
function categoryOptions(categories) {
  return Object.entries(categories)
    .map(([key, { label }]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "nb"));
}

function hasNotes(r) {
  return typeof r.notes === "string" && r.notes.trim() !== "";
}

function setTripStatus(message, { error = false } = {}) {
  const status = $("trip-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
}

function tripSourceText(saved, match) {
  if (saved) return "Valgt";
  if (match) return `Forslag fra «${match.keyword.replace("*", "").trim()}»`;
  return "Ingen forslag";
}

function renderTripCheck(reservations, savedCategories, keywords, categories) {
  const driven = filterDriven(reservations)
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const section = $("trip-check");
  section.hidden = driven.length === 0;
  if (driven.length === 0) return;

  const saved = { ...savedCategories };
  const matches = new Map(driven.map((r) => [r.id, matchKeyword(r.notes, keywords)]));
  const pending = driven.filter((r) => !saved[r.id] && matches.get(r.id));
  const options = categoryOptions(categories);

  // Radene ligger fast til neste tegning, så en tur ikke forsvinner fra
  // listen i det brukeren velger kategori for den.
  const rows = tripCheck.filter === "all"
    ? driven
    : driven.filter((r) => !saved[r.id] && hasNotes(r));

  const filterEl = $("trip-filter");
  filterEl.value = tripCheck.filter;
  filterEl.onchange = () => {
    tripCheck.filter = filterEl.value;
    tripCheck.shown = TRIP_PAGE_SIZE;
    renderTripCheck(reservations, saved, keywords, categories);
  };

  const acceptBtn = $("trip-accept-all");
  acceptBtn.textContent = `Godta alle forslag (${pending.length})`;
  acceptBtn.disabled = pending.length === 0;
  acceptBtn.onclick = async () => {
    const confirmed = await confirmDialog(
      `Godta ${formatCount(pending.length, "forslag", "forslag")}? Valgene kan endres etterpå, én og én.`,
      "Godta alle",
      { danger: false },
    );
    if (!confirmed) return;
    const accepted = Object.fromEntries(pending.map((r) => [r.id, matches.get(r.id).category]));
    await saveCategories(storage, accepted);
    await renderCategories(reservations);
    setTripStatus(`Godtok ${formatCount(pending.length, "forslag", "forslag")}.`);
  };

  const listEl = $("trip-list");
  listEl.replaceChildren();
  const moreBtn = $("trip-more");

  const appendRows = (from, to) => {
    let first = null;
    for (const r of rows.slice(from, to)) {
      const item = tripRow(r, saved[r.id], matches.get(r.id), options);
      listEl.appendChild(item);
      first ??= item.querySelector("select");
    }
    const shown = Math.min(to, rows.length);
    moreBtn.hidden = shown >= rows.length;
    setText("trip-count", rows.length === 0
      ? "Ingen turer å sjekke"
      : `Viser ${shown} av ${formatTrips(rows.length)}`);
    return first;
  };
  appendRows(0, tripCheck.shown);

  moreBtn.onclick = () => {
    const from = listEl.children.length;
    tripCheck.shown = from + TRIP_PAGE_SIZE;
    // Fokus til første nye rad, så tastaturbrukeren slipper å lete.
    appendRows(from, tripCheck.shown)?.focus();
  };

  // onchange, ikke addEventListener: listen tegnes på nytt ved synk og
  // lagring, og lyttere ville ellers hopet seg opp.
  listEl.onchange = async (e) => {
    const select = e.target.closest(".trip-row__select");
    if (!select || !select.value) return;
    const id = select.dataset.id;
    await saveCategory(storage, id, select.value);
    saved[id] = select.value;
    select.closest(".trip-row").querySelector(".trip-row__source").textContent = "Valgt";
    select.querySelector("option[value='']")?.remove();
    renderCategoryOverview(reservations, saved, keywords, categories);
    const left = pending.filter((r) => !saved[r.id]);
    pending.length = 0;
    pending.push(...left);
    acceptBtn.textContent = `Godta alle forslag (${pending.length})`;
    acceptBtn.disabled = pending.length === 0;
    setTripStatus(`Lagret: ${categories[select.value].label}`);
  };
}

function tripRow(r, savedKey, match, options) {
  const notesId = `trip-notes-${r.id}`;
  const date = formatTripDate.format(new Date(r.start));
  const current = savedKey || match?.category || "";
  const placeholder = current
    ? null
    : el("option", { value: "", selected: true, disabled: true, text: "Velg kategori" });
  const optionEls = options.map(({ key, label }) =>
    el("option", { value: key, selected: key === current, text: label }));

  return el("li", { className: "trip-row" },
    el("span", { className: "trip-row__date", text: date }),
    el("span", {
      className: `trip-row__notes${hasNotes(r) ? "" : " trip-row__notes--empty"}`,
      id: notesId,
      text: hasNotes(r) ? r.notes : "Uten notat",
    }),
    el("span", { className: "trip-row__source", text: tripSourceText(savedKey, match) }),
    el("select", {
      className: "field trip-row__select",
      dataset: { id: String(r.id) },
      "aria-label": `Kategori for turen ${date}`,
      "aria-describedby": notesId,
    }, placeholder, ...optionEls),
  );
}

function formatCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatTrips(n) {
  return n === 1 ? "1 tur" : `${n} turer`;
}

// ---------- Eksport og import av kategorier og nøkkelord ----------

function downloadJson(data, filename) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

// Begge importknappene går gjennom sikkerhetskopiens lesing og fletting, så
// egne kategorier i filen kommer med, og ingenting lagret blir skrevet over.
// Hver knapp tar bare sin del av filen (importPart), også fra en full
// sikkerhetskopi.
async function importCategoryFile(file, part, setStatus) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    setStatus("Klarte ikke å lese filen. Velg en JSON-fil.", { error: true });
    return;
  }
  const result = parseBackup(parsed);
  const backup = result.backup ? importPart(result.backup, part) : null;
  if (!backup) {
    setStatus("Fant ingenting å importere i filen.", { error: true });
    return;
  }

  try {
    const { counts } = await importBackup({ storage: backupStorage, backup, overwrite: false, owner: syncOwner });
    await renderCategories(allReservations);
    setStatus(describeImport(counts));
  } catch (err) {
    console.error("Category import failed:", err);
    setStatus("Importen feilet. Ingenting er endret.", { error: true });
  }
}

function initCategoryFiles() {
  $("trip-export").addEventListener("click", async () => {
    const { settings, categories, tripCategories } = await loadCategoryState();
    downloadJson(
      { tripCategories: knownTripCategories(tripCategories, categories), categorySettings: settings },
      "min-bildeling-turkategorier.json",
    );
  });
  $("keyword-export").addEventListener("click", async () => {
    const { settings, userKeywords } = await loadCategoryState();
    downloadJson({ userKeywords, categorySettings: settings }, "min-bildeling-nokkelord.json");
  });
  const buttons = [
    ["trip-import", "categories", setTripStatus],
    ["keyword-import", "keywords", setKeywordStatus],
  ];
  for (const [id, part, setStatus] of buttons) {
    $(id).addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      // Tøm, så samme fil kan velges igjen.
      e.target.value = "";
      if (file) await importCategoryFile(file, part, setStatus);
    });
  }
}

// ---------- Nøkkelord og kategorier ----------

// Meldingen blir stående til neste handling, så den rekker å bli lest.
function setKeywordStatus(message, { error = false } = {}) {
  const status = $("keyword-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
}

// Lista står i categories.js og leses derfra, så teksten ikke kan gå ut av takt med den.
setText(
  "keyword-stop-words",
  `Ord i notatet som begynner med ${new Intl.ListFormat("nb", { type: "disjunction" }).format(STOP_WORDS)}, hoppes over, også for egne nøkkelord.`
);

// Redigeringen tegnes på nytt bare når innstillingene, ordene eller
// navneendringen er endret, ikke ved hver opptegning under synk. Ellers ville
// et halvskrevet ord og fokus forsvunnet hvert andre sekund.
let keywordEditorSource = null;
// Nøkkelen til kategorien som har navnefeltet åpent, eller null.
let keywordRenaming = null;
// Kategorien som skal stå åpen etter neste ombygging. keywordFocus får fokus
// uansett, keywordFocusFallback bare når det fokuserte elementet er borte.
let keywordOpen = null;
let keywordFocus = null;
let keywordFocusFallback = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name === "className") node.className = value;
    else if (name === "dataset") Object.assign(node.dataset, value);
    else if (name === "text") node.textContent = value;
    else node.setAttribute(name, value === true ? "" : value);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// Id-er må være stabile mellom ombygginger, så fokus finner tilbake. Ord kan
// inneholde hva som helst, så de kodes som tegnkoder.
function wordId(key, word) {
  return `kw-${key}-w-${Array.from(word, (c) => c.codePointAt(0).toString(36)).join("-")}`;
}

// «fly » vises som «fly» med «helt ord», «*besøk» som «besøk» med «også sist i ord».
function describeWord(word) {
  const tags = [];
  let text = word;
  if (/\s$/.test(text)) tags.push("helt ord");
  text = text.trim();
  if (text.startsWith("*")) {
    tags.push("også sist i ord");
    text = text.slice(1);
  }
  return { text, tags };
}

function categoryMeta(key, keywords, hits, userKeywords, settings) {
  const { added, removed } = categoryChanges(key, userKeywords, settings);
  const parts = [formatTrips(hits.perCategory[key] || 0), `${keywords[key].length} ord`];
  if (added.length > 0) parts.push(`${added.length} ${added.length === 1 ? "eget" : "egne"}`);
  if (removed.length > 0) parts.push(`${removed.length} ${removed.length === 1 ? "fjernet" : "fjernede"}`);
  return parts.join(", ");
}

function renderKeywordCard(reservations, state, keywords) {
  const hits = keywordHits(reservations, keywords);
  const pct = hits.total > 0 ? Math.round((hits.matched / hits.total) * 100) : 0;
  setText(
    "keyword-total",
    hits.total > 0
      ? `Treffer ${hits.matched} av ${hits.total} turnotater (${pct} %)`
      : "Ingen turnotater å kategorisere"
  );

  const source = JSON.stringify([state.settings, state.userKeywords, keywordRenaming]);
  if (source !== keywordEditorSource) {
    buildKeywordEditor(state, keywords);
    keywordEditorSource = source;
  }

  // Trefftallene endres under synk og settes som tekst, uten å røre skjemaene.
  const editor = $("keyword-editor");
  for (const node of editor.querySelectorAll(".keyword-category__meta")) {
    const key = node.dataset.key;
    if (keywords[key]) node.textContent = categoryMeta(key, keywords, hits, state.userKeywords, state.settings);
  }
  for (const node of editor.querySelectorAll(".keyword-word__hits")) {
    const n = hits.perKeyword[node.dataset.key]?.[node.dataset.word] || 0;
    node.textContent = n > 0 ? formatTrips(n) : "";
  }
}

function buildKeywordEditor(state, keywords) {
  const editor = $("keyword-editor");
  const open = new Set([...editor.querySelectorAll(".keyword-category[open]")].map((d) => d.dataset.key));
  if (keywordOpen) open.add(keywordOpen);
  const focusedId = editor.contains(document.activeElement) ? document.activeElement.id : null;
  // Det som er skrevet i andre kategorier, står etter ombyggingen.
  const typed = new Map(
    [...editor.querySelectorAll("input")].map((input) => [input.id, input.type === "checkbox" ? input.checked : input.value]),
  );

  const keys = Object.keys(state.categories);
  editor.replaceChildren(...keys.map((key, i) =>
    keywordCategory(key, i, keys.length, state, keywords, open.has(key))
  ));

  for (const [id, value] of typed) {
    const input = document.getElementById(id);
    if (!input || !editor.contains(input)) continue;
    if (input.type === "checkbox") input.checked = value;
    else if (input.name !== "label") input.value = value;
  }

  const target = [keywordFocus, focusedId, keywordFocusFallback]
    .map((id) => id && document.getElementById(id))
    .find((node) => node && !node.disabled);
  target?.focus();
  keywordOpen = null;
  keywordFocus = null;
  keywordFocusFallback = null;
}

function keywordCategory(key, index, count, state, keywords, isOpen) {
  const { label, custom } = state.categories[key];
  const userWords = state.userKeywords[key] ?? [];
  const defaults = DEFAULT_KEYWORDS[key] ?? [];
  const removed = normalizeCategorySettings(state.settings).removed[key] ?? [];
  const changes = categoryChanges(key, state.userKeywords, state.settings);

  const words = el("ul", { className: "keyword-words", "aria-label": `Ord i ${label}` });
  for (const word of keywords[key]) {
    const { text, tags } = describeWord(word);
    if (userWords.includes(word) && !defaults.includes(word)) tags.push("egen");
    words.append(el("li", { className: "keyword-word" },
      el("span", { className: "keyword-word__text", text }),
      ...tags.map((tag) => el("span", { className: "keyword-word__tag", text: tag })),
      el("span", { className: "keyword-word__hits", dataset: { key, word } }),
      el("button", {
        type: "button",
        className: "btn btn--quiet",
        id: wordId(key, word),
        dataset: { action: "remove-word", key, word },
        "aria-label": `Fjern ${text} fra ${label}`,
        text: "Fjern",
      }),
    ));
  }
  for (const word of removed) {
    const { text } = describeWord(word);
    words.append(el("li", { className: "keyword-word keyword-word--removed" },
      el("span", { className: "keyword-word__text", text }),
      el("button", {
        type: "button",
        className: "btn btn--quiet",
        id: wordId(key, word),
        dataset: { action: "restore-word", key, word },
        "aria-label": `Ta tilbake ${text} i ${label}`,
        text: "Ta tilbake",
      }),
    ));
  }

  const add = el("form", { className: "keyword-add", dataset: { key } },
    el("label", { for: `kw-${key}-word`, text: "Nytt ord" }),
    el("input", { type: "text", className: "field", id: `kw-${key}-word`, name: "word", autocomplete: "off", spellcheck: "false" }),
    el("label", { className: "keyword-add__whole" },
      el("input", { type: "checkbox", id: `kw-${key}-whole`, name: "whole" }),
      "Bare som helt ord",
    ),
    el("button", { type: "submit", className: "btn", text: "Legg til" }),
  );

  const actionButton = (action, text, extra = {}) => el("button", {
    type: "button",
    className: extra.danger ? "btn btn--danger" : "btn",
    id: `kw-${key}-${action}`,
    dataset: { action, key },
    disabled: extra.disabled,
    text,
  });

  let actions;
  if (keywordRenaming === key) {
    actions = el("form", { className: "keyword-category__actions keyword-rename", dataset: { key } },
      el("label", { for: `kw-${key}-label`, text: "Nytt navn" }),
      el("input", { type: "text", className: "field", id: `kw-${key}-label`, name: "label", value: label, autocomplete: "off" }),
      el("button", { type: "submit", className: "btn", text: "Lagre" }),
      el("button", { type: "button", className: "btn", dataset: { action: "rename-cancel", key }, text: "Avbryt" }),
    );
  } else {
    const changed = changes.added.length > 0 || changes.removed.length > 0;
    actions = el("div", { className: "keyword-category__actions" },
      actionButton("up", "Flytt opp", { disabled: index === 0 }),
      actionButton("down", "Flytt ned", { disabled: index === count - 1 }),
      !custom && changed ? actionButton("reset", "Tilbakestill") : null,
      custom ? actionButton("rename", "Endre navn") : null,
      custom ? actionButton("delete", "Slett", { danger: true }) : null,
    );
  }

  return el("details", { className: "keyword-category", dataset: { key }, open: isOpen },
    el("summary", { className: "keyword-category__summary", id: `kw-${key}-summary` },
      el("span", { className: "keyword-category__order", text: `${index + 1}.` }),
      el("span", { className: "keyword-category__label", text: label }),
      el("span", { className: "keyword-category__meta", dataset: { key } }),
    ),
    el("div", { className: "keyword-category__body" }, words, add, actions),
  );
}

// Les ferskt, kjør den rene funksjonen, lagre, tegn på nytt og si hva som skjedde.
// focus er id-en som får fokus når det fokuserte elementet er borte etterpå.
async function applyKeywordChange(change, message, { focus = null } = {}) {
  const result = change(await loadCategoryState());
  if (result.changed !== false) await saveCategoryState(result);
  keywordFocusFallback = focus;
  await renderCategories(allReservations);
  setKeywordStatus(message);
}

function categoryLabel(key) {
  return document.querySelector(`.keyword-category[data-key="${CSS.escape(key)}"] .keyword-category__label`)?.textContent ?? key;
}

async function onKeywordClick(e) {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const { action, key, word } = button.dataset;
  const label = categoryLabel(key);
  const shown = word == null ? "" : describeWord(word).text;

  if (action === "remove-word") {
    await applyKeywordChange(
      (s) => removeKeyword(s, key, word),
      `Fjernet «${shown}» fra ${label}`,
      { focus: `kw-${key}-word` },
    );
  } else if (action === "restore-word") {
    await applyKeywordChange(
      (s) => addKeyword(s, key, word),
      `Tok tilbake «${shown}»`,
      { focus: wordId(key, word) },
    );
  } else if (action === "up" || action === "down") {
    await applyKeywordChange(
      (s) => moveCategory(s.settings, key, action === "up" ? -1 : 1),
      `Flyttet ${label} ${action === "up" ? "opp" : "ned"}`,
      { focus: `kw-${key}-${action === "up" ? "down" : "up"}` },
    );
  } else if (action === "reset") {
    const confirmed = await confirmDialog(
      `Tilbakestille «${label}»? Egne ord fjernes, og fjernede standardord kommer tilbake.`,
      "Tilbakestill",
    );
    if (!confirmed) return;
    await applyKeywordChange((s) => resetCategory(s, key), `Tilbakestilte ${label}`, { focus: `kw-${key}-summary` });
  } else if (action === "rename") {
    keywordRenaming = key;
    keywordFocus = `kw-${key}-label`;
    await renderCategories(allReservations);
    $(`kw-${key}-label`)?.select();
  } else if (action === "rename-cancel") {
    await cancelRename(key);
  } else if (action === "delete") {
    const { tripCategories } = await loadCategoryState();
    const trips = Object.values(tripCategories).filter((value) => value === key).length;
    const message = trips > 0
      ? `Slette «${label}»? ${formatTrips(trips)} har kategorien valgt og går tilbake til forslag eller ukategorisert. Ordene slettes.`
      : `Slette «${label}»? Ordene slettes.`;
    if (!(await confirmDialog(message, "Slett"))) return;
    await applyKeywordChange((s) => removeCustomCategory(s, key), `Slettet «${label}»`, { focus: "keyword-new-name" });
  }
}

async function cancelRename(key) {
  keywordRenaming = null;
  keywordFocusFallback = `kw-${key}-rename`;
  await renderCategories(allReservations);
}

async function onKeywordSubmit(e) {
  const form = e.target;
  e.preventDefault();
  const key = form.dataset.key;
  const label = categoryLabel(key);

  if (form.classList.contains("keyword-rename")) {
    const { settings } = await loadCategoryState();
    const result = renameCustomCategory(settings, key, form.elements.label.value);
    if (result.error) {
      setKeywordStatus(result.error, { error: true });
      return;
    }
    await saveCategoryState(result);
    keywordRenaming = null;
    keywordFocusFallback = `kw-${key}-rename`;
    await renderCategories(allReservations);
    setKeywordStatus(`Navnet er endret til «${result.settings.custom[key].label}»`);
    return;
  }

  // Komma gir flere ord. «Bare som helt ord» legger mellomrom til slutt.
  const whole = form.elements.whole.checked;
  const words = parseKeywordInput(form.elements.word.value).map((w) => (whole ? `${w} ` : w));
  if (words.length === 0) {
    setKeywordStatus("Skriv et ord.", { error: true });
    return;
  }
  const state = await loadCategoryState();
  let current = { userKeywords: state.userKeywords, settings: state.settings };
  const added = [];
  const existing = [];
  for (const word of words) {
    const result = addKeyword(current, key, word);
    if (result.changed) {
      current = result;
      added.push(describeWord(word.toLowerCase()).text);
    } else if (result.exists) {
      existing.push(describeWord(word.toLowerCase()).text);
    }
  }
  if (added.length === 0) {
    setKeywordStatus(existing.length > 0 ? `«${existing[0]}» står alt i ${label}.` : "Skriv et ord.", { error: true });
    return;
  }
  form.elements.word.value = "";
  form.elements.whole.checked = false;
  await saveCategoryState(current);
  keywordFocusFallback = `kw-${key}-word`;
  await renderCategories(allReservations);
  setKeywordStatus(`La til ${added.map((w) => `«${w}»`).join(", ")} i ${label}`);
}

async function onNewCategory(e) {
  e.preventDefault();
  const input = $("keyword-new-name");
  const { settings } = await loadCategoryState();
  const result = addCustomCategory(settings, input.value);
  if (result.error) {
    setKeywordStatus(result.error, { error: true });
    return;
  }
  await saveCategoryState(result);
  input.value = "";
  // Den nye kategorien står øverst og åpen, med fokus i feltet for ord.
  keywordOpen = result.key;
  keywordFocus = `kw-${result.key}-word`;
  await renderCategories(allReservations);
  setKeywordStatus(`Kategorien «${result.settings.custom[result.key].label}» er laget`);
}

// Lytterne settes én gang. Redigeringen bygges om, men beholder elementet.
function initKeywordEditor() {
  const editor = $("keyword-editor");
  editor.addEventListener("click", onKeywordClick);
  editor.addEventListener("submit", onKeywordSubmit);
  editor.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !e.target.closest(".keyword-rename")) return;
    // Esc avbryter navneendringen uten å lukke noe annet.
    e.preventDefault();
    cancelRename(e.target.closest(".keyword-rename").dataset.key);
  });
  $("keyword-new").addEventListener("submit", onNewCategory);
  initCategoryFiles();
}

// ---------- Rendering: Section 7 - Klimaregnskap ----------

function renderClimate(reservations) {
  const total = totalCO2(reservations);
  const monthly = monthlyCO2(reservations);

  if (!total) {
    $("co2-empty").hidden = false;
    $("co2-content").hidden = true;
    return;
  }

  $("co2-empty").hidden = true;
  $("co2-content").hidden = false;

  // Nøkkeltall
  setText("co2-total", `ca. ${formatKm.format(Math.round(total.totalKg))} kg`);
  setText("co2-avg-km", `ca. ${Math.round(total.avgPerKm)} g/km`);

  // Electric percentage
  const elTrips = total.byFuelType["Elektrisitet"]?.trips || 0;
  const elPct = total.tripCount > 0 ? Math.round((elTrips / total.tripCount) * 100) : 0;
  setText("co2-electric-pct", `${elPct} %`);

  renderAverageCarComparison(reservations);
  renderMethodPanel($("co2-method-detail"), CO2_METHOD, { idPrefix: "co2-metode" });

  // Monthly chart
  if (monthly.length === 0) {
    destroyChart("monthlyCO2");
  } else {
    draw("monthlyCO2", $("monthly-co2-chart"), barChartConfig(
      monthly.map(m => formatMonthLabel(m.month)),
      monthly.map(m => Math.round(m.co2Kg)),
      "CO\u2082",
      { yTitle: "Kg" }
    ));
  }

  // Fuel type breakdown
  const fuelList = $("co2-fuel-list");
  fuelList.replaceChildren();
  for (const [fuel, data] of Object.entries(total.byFuelType).sort(([,a],[,b]) => b.kg - a.kg)) {
    if (data.trips === 0) continue;
    fuelList.append(tableRow(fuel, formatTrips(data.trips), `ca. ${formatKm.format(Math.round(data.kg))} kg`));
  }
}

// Andelen av gjennomsnittsbilen. Et lite tall rundet til 0 % leses som
// ingenting, så det står som «under 1 %».
function shareOfAverageCar(user, car) {
  const pct = Math.round((user / car) * 100);
  return pct === 0 && user > 0 ? "under 1 %" : `${pct} %`;
}

function renderAverageCarComparison(reservations) {
  const cmp = averageCarComparison(reservations);
  $("co2-comparison").hidden = !cmp;
  if (!cmp) return;

  setText("co2-comparison-title", cmp.partial
    ? `Mot en gjennomsnittlig personbil, ${cmp.year} hittil`
    : `Mot en gjennomsnittlig personbil i ${cmp.year}`);
  setText("co2-cmp-user-km", `${formatKm.format(cmp.userKm)} km`);
  setText("co2-cmp-car-km", `${cmp.partial ? "ca. " : ""}${formatKm.format(Math.round(cmp.carKm))} km`);
  setText("co2-cmp-user-co2", `ca. ${formatKm.format(Math.round(cmp.userCO2Kg))} kg`);
  setText("co2-cmp-car-co2", `ca. ${formatKm.format(Math.round(cmp.carCO2Kg))} kg`);
  setText("co2-comparison-note", cmp.partial
    ? `Snittet er en norsk personbil i ${cmp.dataYear}, regnet for den delen av året som er gått.`
    : `Det er ${shareOfAverageCar(cmp.userKm, cmp.carKm)} av kjørelengden og ca. ${shareOfAverageCar(cmp.userCO2Kg, cmp.carCO2Kg)} av utslippet til en norsk personbil i ${cmp.dataYear}, det siste året SSB har utslippstall for.`);
}

// ---------- Rendering: Section 8 - Min transport ----------

let transportYear = null;
// Skjemaet åpnet med «Legg inn tall» for et år uten tall. Står over
// gjentegningen under synk, men lukkes når året byttes.
let transportFormOpen = false;
// Året og de lagrede tallene skjemaet sist ble bygget fra. renderAll kjøres
// hvert andre sekund under synk, og et nytt skjema ville kastet det brukeren
// holder på å skrive og flyttet fokus. Bygges bare når dette endrer seg.
let transportFormSource = null;

function getTransportYears(reservations) {
  const years = new Set();
  for (const r of filterValid(reservations)) {
    years.add(new Date(r.start).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

function transportFormSourceKey(year, savedData) {
  return JSON.stringify([year, savedData?.[year] ?? null]);
}

// Bygger skjemaet på nytt bare når året eller de lagrede tallene for året er
// endret, altså ved årsbytte, lagring, import og første opptegning.
function ensureTransportForm(year, savedData) {
  const key = transportFormSourceKey(year, savedData);
  if (key === transportFormSource) return;
  buildTransportForm(year, savedData);
  transportFormSource = key;
}

function buildTransportForm(year, savedData) {
  const container = $("transport-fields");
  container.replaceChildren();
  const yearData = (savedData && savedData[year]) || {};

  for (const [mode, definition] of Object.entries(TRANSPORT_MODES)) {
    const modeData = yearData[mode] || {};
    const isNarrow = definition.fields.length <= 1;
    const row = document.createElement("div");
    row.className = `transport-row${isNarrow ? " transport-row--narrow" : ""}`;

    const label = document.createElement("span");
    label.className = "transport-row__label";
    label.textContent = definition.label;
    row.appendChild(label);

    for (const field of definition.fields) {
      // Etiketten står synlig over feltet, så et utfylt felt fortsatt sier
      // hva tallet er. Placeholder forsvinner når noe er skrevet inn.
      const wrapper = document.createElement("div");
      wrapper.className = "transport-field";
      const fieldId = `transport-${mode}-${field.key}`;
      const fieldLabel = document.createElement("label");
      fieldLabel.className = "transport-field__label";
      fieldLabel.htmlFor = fieldId;
      fieldLabel.textContent = field.label;
      wrapper.appendChild(fieldLabel);

      let control;
      if (field.type === "select") {
        control = document.createElement("select");
        for (const opt of field.options) {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          if (modeData[field.key] === opt.value) option.selected = true;
          control.appendChild(option);
        }
      } else {
        control = document.createElement("input");
        // type="text" + inputmode lar oss godta "4 740" og andre format.
        // Tall-input parses og normaliseres ved save og blur.
        control.type = "text";
        control.inputMode = "numeric";
        control.autocomplete = "off";
        if (modeData[field.key] != null && modeData[field.key] !== 0) {
          control.value = formatNumberDisplay(modeData[field.key]);
        }
        control.addEventListener("blur", () => {
          const parsed = parseNumberInput(control.value);
          control.value = parsed > 0 ? formatNumberDisplay(parsed) : "";
        });
      }
      control.id = fieldId;
      control.name = `${mode}_${field.key}`;
      control.className = "field";
      // Skjermleseren får transportmiddelet med, siden etiketten alene
      // («Totalt km») går igjen i flere rader.
      control.setAttribute("aria-label", `${definition.label}, ${field.label.toLowerCase()}`);
      wrapper.appendChild(control);
      row.appendChild(wrapper);
    }

    container.appendChild(row);
  }
}

function getSharingStatsForYear(reservations, year) {
  const yearRes = reservations.filter(
    (r) => new Date(r.start).getFullYear() === year
  );

  const valid = filterValid(yearRes);
  const driven = filterDriven(yearRes);

  const cost = valid.reduce((sum, r) => sum + (r.price?.total || 0), 0);
  const km = driven.reduce((sum, r) => sum + (r.drivenKm || 0), 0);
  const trips = valid.length;

  const co2Stats = totalCO2(yearRes);
  const co2Kg = co2Stats ? co2Stats.totalKg : 0;

  return { cost, co2Kg, km, trips };
}

const TRANSPORT_CHART_COLORS = {
  bildeling: "--color-chart-1",
  taxi: "--color-chart-2",
  leiebil: "--color-chart-3",
  egenbil: NEUTRAL_SERIES,
  buss: "--color-chart-4",
  fly: "--color-chart-5",
  sykkel: NEUTRAL_SERIES,
};

// Et år uten tall vises som én linje med knapp, ikke som et tomt skjema og
// en oppsummering der bildelingen er 100 %.
function showTransportYear(reservations, savedData, year) {
  const entries = hasTransportEntries(savedData?.[year]);
  const formShown = entries || transportFormOpen;
  $("transport-entry").hidden = !formShown;
  $("transport-empty").hidden = formShown;
  $("transport-open").hidden = false;
  // Knappen vises bare når skjemaet er lukket, så den skal ikke si at
  // skjemaet er åpent fordi året har tall.
  $("transport-open").setAttribute("aria-expanded", String(transportFormOpen));
  if (!formShown) {
    setText("transport-empty-text", `Legg inn taxi, buss og fly for ${year} for å se hele transportregnskapet.`);
  }
  renderTransportSummary(reservations, savedData, year);
}

async function renderTransport(reservations) {
  const years = getTransportYears(reservations);
  if (years.length === 0) {
    $("transport-year-selector").hidden = true;
    $("transport-entry").hidden = true;
    $("transport-summary").hidden = true;
    $("transport-open").hidden = true;
    $("transport-empty").hidden = false;
    setText("transport-empty-text", "Transportregnskapet vises når turene dine er hentet.");
    return;
  }
  $("transport-year-selector").hidden = false;

  // Valglisten bygges bare når årene endres, så den beholder fokus under synk.
  const select = $("transport-year");
  const shownYears = [...select.options].map((o) => Number(o.value));
  if (shownYears.join() !== years.join()) {
    select.replaceChildren(...years.map((y) => new Option(String(y), String(y))));
  }

  // Default to current or most recent year
  if (!transportYear || !years.includes(transportYear)) {
    transportYear = years[0];
  }
  select.value = transportYear;

  // Load saved transport data
  const savedData = await loadTransportData(storage);

  ensureTransportForm(transportYear, savedData);
  showTransportYear(reservations, savedData, transportYear);

  // Tildelte handlere, ikke addEventListener: renderTransport kjøres hvert
  // andre sekund under synk, og hver lytter skal bare finnes én gang.
  select.onchange = async () => {
    transportYear = Number(select.value);
    transportFormOpen = false;
    $("transport-save-status").textContent = "";
    const freshData = await loadTransportData(storage);
    ensureTransportForm(transportYear, freshData);
    showTransportYear(reservations, freshData, transportYear);
  };

  $("transport-open").onclick = async () => {
    transportFormOpen = true;
    showTransportYear(reservations, await loadTransportData(storage), transportYear);
    $("transport-fields").querySelector("input, select")?.focus();
  };

  // Form submit handler
  $("transport-form").onsubmit = async (e) => {
    e.preventDefault();

    const freshData = await loadTransportData(storage);
    const yearData = {};

    for (const [mode, definition] of Object.entries(TRANSPORT_MODES)) {
      const modeData = {};
      for (const field of definition.fields) {
        const el = document.querySelector(`[name="${mode}_${field.key}"]`);
        if (el && el.value !== "") {
          modeData[field.key] = field.type === "select"
            ? el.value
            : parseNumberInput(el.value);
        }
      }
      if (Object.keys(modeData).length > 0) {
        yearData[mode] = modeData;
      }
    }

    freshData[transportYear] = yearData;
    await saveTransportData(storage, freshData);
    // Feltene viser allerede det som ble lagret. Uten dette ville neste
    // opptegning bygd skjemaet på nytt og tatt fokus fra brukeren.
    transportFormSource = transportFormSourceKey(transportYear, freshData);

    // Skjemaet blir stående, også når året ble tømt, så «Lagret» kan leses.
    transportFormOpen = true;
    $("transport-save-status").textContent = "Lagret";
    showTransportYear(reservations, freshData, transportYear);
  };

  // «Tøm feltene» tømmer alle input-felt (men lagrer ikke før bruker
  // trykker Lagre, gir mulighet til å ombestemme seg).
  $("transport-reset").onclick = () => {
    const inputs = document.querySelectorAll("#transport-fields input");
    for (const input of inputs) input.value = "";
    const status = $("transport-save-status");
    status.textContent = "Trykk Lagre for å slette";
  };
}

function renderTransportSummary(reservations, savedData, year) {
  const yearData = (savedData && savedData[year]) || {};
  const sharingStats = getSharingStatsForYear(reservations, year);
  const summary = transportSummary(yearData, sharingStats, {
    year: Number(year),
    organizationId: homeOrganizationId(reservations),
  });

  // Bildelingen alene gir donuter med én skive og «100 %», så
  // oppsummeringen venter på tall for et annet transportmiddel.
  if (!hasTransportEntries(yearData)) {
    $("transport-summary").hidden = true;
    destroyChart("transportCost");
    destroyChart("transportCO2");
    return;
  }

  $("transport-summary").hidden = false;

  // Tallene gjelder valgt år, summert over transportmidlene. Uten året i
  // etiketten ble «totalt» lest som alle år.
  setText("transport-total-cost-label", `Transportkostnad ${year}`);
  setText("transport-total-co2-label", `CO\u2082-utslipp ${year}`);
  setText("transport-sharing-pct-label", `Bildelingens andel ${year}`);
  setText("transport-total-cost", formatNOK.format(summary.totals.cost));
  setText(
    "transport-total-co2",
    `ca. ${formatKm.format(Math.round(summary.totals.co2Kg))} kg`
  );

  if (summary.totals.cost > 0 && summary.modes.bildeling) {
    const pct = Math.round(
      (summary.modes.bildeling.cost / summary.totals.cost) * 100
    );
    setText("transport-sharing-pct", `${pct} %`);
  } else {
    setText("transport-sharing-pct", "\u2013");
  }

  // Sort modes by cost descending for charts and table
  const sortedModes = Object.entries(summary.modes)
    .filter(([, m]) => m.cost > 0 || m.co2Kg > 0)
    .sort(([, a], [, b]) => b.cost - a.cost);

  // Cost donut chart
  if (!sortedModes.some(([, m]) => m.cost > 0)) {
    destroyChart("transportCost");
  } else {
    const costEntries = sortedModes.filter(([, m]) => m.cost > 0);
    draw("transportCost", $("transport-cost-chart"), {
      type: "doughnut",
      data: {
        labels: costEntries.map(([, m]) => m.label),
        datasets: [doughnutDataset(
          costEntries.map(([, m]) => m.cost),
          costEntries.map(([key]) => resolveColor(TRANSPORT_CHART_COLORS[key] || "--color-chart-1"))
        )],
      },
      options: doughnutOptions((ctx) => {
        const val = formatNOK.format(ctx.parsed);
        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
        const pct = Math.round((ctx.parsed / total) * 100);
        return `${ctx.label}: ${val} (${pct} %)`;
      }),
    });
  }

  // CO2 donut chart
  if (!sortedModes.some(([, m]) => m.co2Kg > 0)) {
    destroyChart("transportCO2");
  } else {
    const co2Entries = sortedModes.filter(([, m]) => m.co2Kg > 0);
    draw("transportCO2", $("transport-co2-chart"), {
      type: "doughnut",
      data: {
        labels: co2Entries.map(([, m]) => m.label),
        datasets: [doughnutDataset(
          co2Entries.map(([, m]) => Math.round(m.co2Kg)),
          co2Entries.map(([key]) => resolveColor(TRANSPORT_CHART_COLORS[key] || "--color-chart-1"))
        )],
      },
      options: doughnutOptions((ctx) => {
        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
        const pct = Math.round((ctx.parsed / total) * 100);
        return `${ctx.label}: ca. ${formatKm.format(ctx.parsed)} kg (${pct} %)`;
      }),
    });
  }

  // Tabellen, sortert etter kostnad, høyest først
  const tableEl = $("transport-table");
  tableEl.replaceChildren(...sortedModes.map(([, mode]) => tableRow(
    mode.label,
    formatNOK.format(mode.cost),
    `ca. ${formatKm.format(Math.round(mode.co2Kg))} kg`,
    `${formatKm.format(mode.km)} km`,
  )));

  renderMethodPanel($("transport-method-detail"), TRANSPORT_METHOD, { idPrefix: "transport-metode" });
}

// ---------- Utility ----------

// Rad i topplistene (biler etter turer og etter km).
function rankedItem(name, value) {
  return el("li", { className: "ranked__item" },
    el("span", { className: "ranked__row" },
      el("span", { className: "ranked__name", text: name }),
      el("span", { className: "ranked__value", text: value })));
}

// Rad i tabellene for kategori, drivstoff og transport: navn og så tallene.
function tableRow(name, ...stats) {
  return el("div", { className: "table-row" },
    el("span", { className: "table-row__name", text: name }),
    ...stats.map((stat) => el("span", { className: "table-row__stat", text: stat })));
}

// ---------- Sync ----------

let renderedLastSync = null;

// Fargene i diagrammene er løst for én modus. Bytter systemet mellom lys og
// mørk, tegnes alt på nytt med fargene for den nye modusen.
onColorSchemeChange(() => {
  applyChartTheme();
  if (allReservations.length > 0) renderAll(allReservations, renderedLastSync);
});

// syncState er med når dataene kommer fra lageret. Uten den gjelder forrige
// historyProgress, for eksempel ved ny opptegning etter fargebytte.
async function renderAll(reservations, lastSync, syncState) {
  if (syncState !== undefined) tripHistory = historyProgress(syncState);
  renderedLastSync = lastSync;
  allReservations = reservations;
  updateHeaderMeta(allReservations, lastSync);

  buildYearSelector(allReservations);
  renderCosts(allReservations);
  renderUsage(allReservations);
  renderBookingPatterns(allReservations);
  renderMileage(allReservations);
  renderTrends(allReservations);
  renderOwnership(allReservations);
  await renderCategories(allReservations);
  renderClimate(allReservations);
  await renderTransport(allReservations);
}

let hasRendered = false;
let syncing = false;

// Synken lagrer turene fortløpende, så seksjonene tegnes opp underveis. Høyst
// én opptegning per LIVE_RENDER_MS, ellers tegner Chart.js hundrevis av ganger.
const LIVE_RENDER_MS = 2000;
let lastLiveRender = 0;
let liveRender = null;

function renderWhileSyncing() {
  if (liveRender || Date.now() - lastLiveRender < LIVE_RENDER_MS) return;
  lastLiveRender = Date.now();
  liveRender = (async () => {
    const data = await sendMessage({ type: "GET_DATA" });
    const count = data?.reservations?.length || 0;
    if (count === 0 || count === allReservations.length) return;
    await renderAll(data.reservations, data.lastSync, data.syncState ?? null);
    showMain();
    hasRendered = true;
  })()
    .catch((e) => console.error("[dashboard] Opptegning under synk feilet", e))
    .finally(() => {
      liveRender = null;
    });
}

async function loadStored() {
  const data = await sendMessage({ type: "GET_DATA" });
  if (!data || !data.reservations || data.reservations.length === 0) return false;
  await renderAll(data.reservations, data.lastSync, data.syncState ?? null);
  showMain();
  hasRendered = true;
  return true;
}

function onSyncProgress(progress) {
  // Fremdriften står i banneret. Knappen sier bare «Synkroniserer…».
  showStatus(describeProgress(progress));
  if (progress.phase === "details" && progress.total > 0) {
    showProgress(Math.round((progress.current / progress.total) * 100));
    renderWhileSyncing();
  }
}

// Synker (force: uansett tid siden sist) og tegner opp på nytt. Feil og delvise
// resultater blir stående i statusfeltet. showEmpty() kalles bare når synken
// gikk bra og det likevel ikke finnes data.
// notice er en melding som står når synken ikke har noe å si selv, for
// eksempel hva importen fra tilbudet ved første oppstart la inn.
async function syncAndRender(force, { notice = null } = {}) {
  restoreOffer.hidden = true;
  syncBtn.disabled = true;
  syncBtn.textContent = "Synkroniserer…";
  if (force) showStatus("Synkroniserer…");
  syncing = true;
  // Første gang er det ingenting å vise på flere minutter, så siden sier hva som skjer.
  if (!hasRendered) {
    emptyState.hidden = true;
    firstRun.hidden = false;
  }

  const result = await startSync({ force, onProgress: onSyncProgress });
  if (liveRender) await liveRender;

  syncing = false;
  syncBtn.disabled = false;
  syncBtn.textContent = "Synkroniser";
  progressBar.hidden = true;
  firstRun.hidden = true;

  // Tegn opp på nytt bare når synken faktisk hentet noe, eller ingenting vises ennå.
  let hasData = hasRendered;
  try {
    // waited: en annen side synket mens denne ventet, og kan ha lagret nye turer.
    if (result.fetched > 0 || result.waited || !hasRendered) hasData = (await loadStored()) || hasRendered;
  } catch (e) {
    console.error("[dashboard] Klarte ikke å lese lagrede data", e);
    showStatus("Klarte ikke å lese lagrede turer. Last inn siden på nytt.");
    return;
  }
  if (isDevMode()) refreshDevInfo();

  if (isAuthError(result.error)) {
    const status = await sendMessage({ type: "GET_AUTH_STATUS" }).catch(() => null);
    showAuthProblem(stateForSyncError(result.error, status));
    return;
  }
  const message = describeSyncResult(result);
  if (message) {
    showSyncMessage(message, { retry: Boolean(result.error) });
  } else if (!hasData) {
    showEmpty();
  } else if (notice) {
    showStatus(notice);
  } else {
    hideStatus();
  }
}

// Første oppstart: en ny installasjon har kanskje en sikkerhetskopi med alle
// turene. Importeres den før synken starter, henter synken bare det som er nytt
// siden kopien ble laget, ikke hele historikken. Lageret regnes som tomt også
// når popupen alt har hentet sine første turer av førstegangssynken.
async function isFirstStart() {
  const { reservations, lastSync, syncState } = await storage.get(["reservations", "lastSync", "syncState"]);
  if (Number.isFinite(lastSync)) return false;
  const stored = Array.isArray(reservations) ? reservations.length : 0;
  return stored === 0 || (syncState?.initial === true && !historyProgress(syncState).complete);
}

function offerRestore() {
  hideStatus();
  emptyState.hidden = true;
  restoreOffer.hidden = false;
  $("restore-skip").focus();
}

function setRestoreStatus(message, { error = false } = {}) {
  const status = $("restore-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
}

function initRestoreOffer() {
  $("restore-skip").addEventListener("click", () => syncAndRender(false));
  $("restore-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const message = await handleBackupImport(file, setRestoreStatus);
    // Avbrutt eller feil: tilbudet står med meldingen, så brukeren kan velge igjen.
    if (message) await syncAndRender(false, { notice: message });
  });
}

// ---------- Init ----------

async function init() {
  // Før første opptegning, så valg og ord under Flyplass, Skyss og Hyttetur
  // står i målkategorien. Kjører den ikke, leses de likevel riktig.
  await migrateLegacyCategories(storage).catch((e) => console.error("[dashboard] Category migration failed", e));
  if (demo) {
    syncBtn.remove();
    // I navigasjonslinjen, som står fast øverst, så merket synes uansett hvor
    // langt ned man har scrollet.
    document.querySelector(".nav__inner").append(createDemoBadge(document));
    await renderAll(demo.reservations, null);
    showMain();
    return;
  }
  showStatus("Laster…");
  const hasData = await loadStored();
  if (await isFirstStart()) {
    offerRestore();
    return;
  }
  if (!hasData) showStatus("Synkroniserer…");
  // Uten force synker den bare når det er over en time siden sist, eller når
  // en tidligere synk ble avbrutt.
  await syncAndRender(false);
}

// Summary button
$("summary-btn").addEventListener("click", () => {
  if (demo) {
    window.open("../summary/summary.html?demo=1", "_blank");
    return;
  }
  browserAPI.tabs.create({ url: browserAPI.runtime.getURL("summary/summary.html") });
});

syncBtn.addEventListener("click", () => syncAndRender(true));

// ---------- PNG Export ----------

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn--export");
  if (!btn) return;

  const section = btn.closest(".section");
  if (!section) return;

  btn.disabled = true;

  try {
    const canvas = await html2canvas(section, {
      backgroundColor: resolveColor("--color-bg"),
      scale: 2,
      onclone: (doc) => doc.body.classList.add("export"),
    });

    const link = document.createElement("a");
    link.download = `min-bildeling-${section.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("Export failed:", err);
  }

  btn.disabled = false;
});

// ---------- Skjemastatus ----------

// «Lagret» står til brukeren endrer et felt i samme skjema, for da stemmer
// det ikke lenger. Ingen tidsgrense: en melding som forsvinner på tid,
// rekker ikke alle å lese.
document.addEventListener("input", (e) => {
  const status = e.target.closest("form")?.querySelector(".form-status");
  if (status) status.textContent = "";
});

// ---------- Methodology Toggles ----------

document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".method-toggle");
  if (!toggle) return;
  const detail = toggle.nextElementSibling;
  if (detail) {
    const open = !detail.hidden;
    detail.hidden = open;
    toggle.setAttribute("aria-expanded", String(!open));
  }
});

// ---------- Dev tools (skjult bak ?dev=1) ----------

const DEV_STORAGE_KEYS = [
  "reservations",
  "lastSync",
  "tripCategories",
  "transportData",
  "userKeywords",
  "categorySettings",
  "syncState",
  "syncLock",
  "syncHistory",
];

function isDevMode() {
  return new URLSearchParams(window.location.search).get("dev") === "1";
}

function setDevStatus(message, kind) {
  const el = $("dev-action-status");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("form-status--ok", "form-status--error");
  if (kind === "ok") el.classList.add("form-status--ok");
  if (kind === "error") el.classList.add("form-status--error");
}

function clearDevStatusLater(ms = 4000) {
  setTimeout(() => setDevStatus("", null), ms);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatOneDecimal.format(bytes / 1024)} kB`;
  return `${formatOneDecimal.format(bytes / (1024 * 1024))} MB`;
}

async function refreshDevInfo() {
  const data = await storage.get(DEV_STORAGE_KEYS);
  const reservations = Array.isArray(data.reservations) ? data.reservations : [];

  setText("dev-count", `${reservations.length}`);
  setText(
    "dev-last-sync",
    data.lastSync
      ? new Date(data.lastSync).toLocaleString("nb-NO", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Aldri"
  );

  renderDevSyncHistory(data.syncHistory, data.syncState);

  // Bytes-tellingen er omtrentlig, JSON-st\u00f8rrelse, ikke faktisk storage-quota.
  const size = new Blob([JSON.stringify(data)]).size;
  setText("dev-storage-size", `~${formatBytes(size)}`);
}

const formatOneDecimal = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });

function describeHistoryEntry(entry) {
  const c = entry.calls || {};
  const when = new Date(entry.startedAt).toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const outcome = entry.error ? ` (${entry.status}: ${entry.error})` : entry.status === "SYNCED" ? "" : ` (${entry.status})`;
  return (
    `${when}: ${c.list ?? 0} listekall, ${c.detail ?? 0} detaljkall, ` +
    `${c.retries ?? 0} nye forsøk, ${c.failed ?? 0} feil, ` +
    `${formatOneDecimal.format((entry.durationMs || 0) / 1000)} s${outcome}`
  );
}

function renderDevSyncHistory(history, state) {
  const list = $("dev-sync-history");
  if (!list) return;
  list.replaceChildren();
  const entries = Array.isArray(history) ? history : [];
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Ingen synker registrert ennå.";
    list.appendChild(li);
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.textContent = describeHistoryEntry(entry);
    list.appendChild(li);
  }

  const failedCount = state?.failed ? Object.keys(state.failed).length : 0;
  const pendingCount = state?.pendingIds?.length || 0;
  setText(
    "dev-sync-state",
    state
      ? `Tilstand: ${state.phase}${state.reason ? ` (${state.reason})` : ""}, ` +
          `${pendingCount} venter, ${failedCount} feilet.`
      : ""
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleDevExport() {
  try {
    const data = await storage.get(["reservations", "lastSync"]);
    const payload = {
      exportedAt: new Date().toISOString(),
      reservations: data.reservations || [],
      lastSync: data.lastSync || null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `min-bildeling-backup-${today}.json`);
    setDevStatus(`Eksporterte ${formatTrips(payload.reservations.length)}.`, "ok");
    clearDevStatusLater();
  } catch (err) {
    console.error("Export failed:", err);
    setDevStatus(`Eksport feilet: ${err.message}`, "error");
  }
}

// Bekreftelse i et eget <dialog> framfor window.confirm(), som WebDriver avviser
// stille i den fjernstyrte nettleseren. Esc og Avbryt gir false, og fokus
// starter på Avbryt. Dialogen står utenfor utviklerpanelet, som kan være skjult.
function confirmDialog(message, confirmLabel, { danger = true } = {}) {
  const dialog = $("confirm-dialog");
  $("confirm-dialog-text").textContent = message;
  const ok = $("confirm-dialog-ok");
  ok.textContent = confirmLabel;
  ok.classList.toggle("btn--danger", danger);
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
    $("confirm-dialog-cancel").focus();
  });
}

function extractReservations(parsed) {
  // Godta enten { reservations: [...] }-format (v\u00e5r eksport) eller en ren array.
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.reservations)) return parsed.reservations;
  return null;
}

function looksLikeReservation(item) {
  // Lett sjekk, vi krever ikke fullt skjema, men nok til \u00e5 avvise tilfeldig JSON.
  return (
    item &&
    typeof item === "object" &&
    typeof item.id !== "undefined" &&
    typeof item.start === "string"
  );
}

async function handleDevImportFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setDevStatus("Ugyldig JSON, kan ikke lese filen.", "error");
      return;
    }

    const reservations = extractReservations(parsed);
    if (!reservations) {
      setDevStatus(
        "Fant ingen reservasjoner i filen. Bruk en eksport herfra eller en JSON-liste.",
        "error"
      );
      return;
    }

    if (reservations.length === 0) {
      setDevStatus("Filen har ingen reservasjoner.", "error");
      return;
    }

    // Stikkpr\u00f8ve: f\u00f8rste element m\u00e5 se ut som en reservasjon.
    if (!looksLikeReservation(reservations[0])) {
      setDevStatus(
        "Elementene ser ikke ut som reservasjoner (mangler id eller start).",
        "error"
      );
      return;
    }

    const confirmed = await confirmDialog(
      `Importere ${formatTrips(reservations.length)}? De erstatter alle turene som er lagret nå.`,
      "Importer"
    );
    if (!confirmed) {
      setDevStatus("Import avbrutt.", null);
      clearDevStatusLater();
      return;
    }

    await storage.set({
      reservations,
      lastSync: Date.now(),
    });
    setDevStatus(`Importerte ${formatTrips(reservations.length)}. Laster p\u00e5 nytt\u2026`, "ok");
    // Reload for \u00e5 trigge full re-render av alle seksjoner.
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    console.error("Import failed:", err);
    setDevStatus(`Import feilet: ${err.message}`, "error");
  }
}

async function handleDevReset() {
  const confirmed = await confirmDialog(
    "Nullstille alt? Reservasjoner, kategorier, nøkkelord og transportdata slettes. Kan ikke angres.",
    "Slett alt"
  );
  if (!confirmed) {
    setDevStatus("Nullstilling avbrutt.", null);
    clearDevStatusLater();
    return;
  }

  try {
    // storage-polyfill eksponerer ikke remove(), bruk underliggende API direkte.
    await browserAPI.storage.local.remove(DEV_STORAGE_KEYS);
    setDevStatus("Alt nullstilt. Laster p\u00e5 nytt\u2026", "ok");
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    console.error("Reset failed:", err);
    setDevStatus(`Nullstilling feilet: ${err.message}`, "error");
  }
}

function initDevTools() {
  // Utviklerpanelet leser og skriver ekte storage, så det er av i demomodus.
  if (!isDevMode() || demo) return;

  const wrapper = $("devtools-wrapper");
  if (!wrapper) return;
  // Wrapperen ligger utenfor <main>, så den er synlig selv når dashbordet er
  // i empty/login-state. Det er da panelet er mest nyttig.
  wrapper.hidden = false;

  refreshDevInfo();

  $("dev-export-btn").addEventListener("click", handleDevExport);

  const fileInput = $("dev-import-file");
  $("dev-import-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    await handleDevImportFile(file);
    // T\u00f8m slik at samme fil kan velges p\u00e5 nytt.
    e.target.value = "";
  });

  $("dev-reset-btn").addEventListener("click", handleDevReset);
  $("dev-sample-btn").addEventListener("click", toggleDevSample);
}

// Viser den første lagrede reservasjonen som JSON, for å se feltene API-et
// faktisk sender uten å eksportere hele lageret.
async function toggleDevSample() {
  const btn = $("dev-sample-btn");
  const pre = $("dev-sample");
  if (!pre.hidden) {
    pre.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  const { reservations } = await storage.get(["reservations"]);
  const list = Array.isArray(reservations) ? reservations : [];
  pre.textContent = list.length > 0
    ? JSON.stringify(list[0], null, 2)
    : "Ingen reservasjoner i storage.";
  pre.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}

initDevTools();

// ---------- Sikkerhetskopi ----------

function setBackupStatus(message, { error = false } = {}) {
  const status = $("backup-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
}

// I demomodus ligger turene i minnet, ikke i lageret, før noe er importert.
const backupStorage = {
  async get(keys) {
    const data = await storage.get(keys);
    if (demo && keys.includes("reservations") && !Array.isArray(data.reservations)) {
      data.reservations = allReservations;
    }
    return data;
  },
  set: (items) => storage.set(items),
};

async function handleBackupExport() {
  try {
    const includeReservations = $("backup-include-trips").checked;
    const backup = createBackup(await backupStorage.get(BACKUP_STORAGE_KEYS), { includeReservations });
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      `min-bildeling-sikkerhetskopi-${today}.json`,
    );
    setBackupStatus(includeReservations
      ? `Lagret kopi med ${formatTrips(backup.reservations.length)}.`
      : "Lagret kopi uten turer.");
  } catch (err) {
    console.error("Backup export failed:", err);
    setBackupStatus("Eksporten feilet. Prøv igjen.", { error: true });
  }
}

const formatBackupDate = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric" });

function describeBackupContents(backup) {
  const items = [];
  if (backup.reservations) items.push(formatTrips(backup.reservations.length));
  const custom = Object.keys(backup.categorySettings.custom).length;
  if (custom > 0) items.push(formatCount(custom, "egen kategori", "egne kategorier"));
  const categories = Object.keys(backup.tripCategories).length;
  if (categories > 0) items.push(formatCount(categories, "kategorivalg", "kategorivalg"));
  const keywordLists = Object.values(backup.userKeywords);
  const words = keywordLists.reduce((sum, list) => sum + list.length, 0);
  if (words > 0) {
    items.push(`${formatCount(words, "nøkkelord", "nøkkelord")} i ${formatCount(keywordLists.length, "kategori", "kategorier")}`);
  }
  const years = Object.keys(backup.transportData).sort();
  if (years.length > 0) items.push(`Transporttall for ${years.join(", ")}`);
  return items;
}

function confirmBackupImport(backup, skipped, exportedAt) {
  const dialog = $("backup-dialog");
  const date = new Date(exportedAt);
  setText("backup-dialog-meta", Number.isNaN(date.getTime())
    ? "Dette er med i filen:"
    : `Laget ${formatBackupDate.format(date)}. Dette er med:`);

  const list = $("backup-dialog-list");
  list.replaceChildren(...describeBackupContents(backup).map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));

  const invalid = skipped.categories + skipped.transport + skipped.reservations;
  const notes = [];
  if (backup.reservations) notes.push("Turer flettes på id, og de som alt er lagret, står.");
  if (Object.keys(backup.userKeywords).length > 0) {
    notes.push("Med overskriving erstatter nøkkelordene i filen hele listen for samme kategori.");
  }
  if (invalid > 0) notes.push(`${formatCount(invalid, "ugyldig oppføring", "ugyldige oppføringer")} hoppes over.`);
  setText("backup-dialog-note", notes.join(" "));

  $("backup-overwrite").checked = false;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"
      ? { overwrite: $("backup-overwrite").checked }
      : null), { once: true });
    dialog.showModal();
    $("backup-dialog-cancel").focus();
  });
}

/**
 * Les, bekreft og importer en fil. Turene skrives under synklåsen
 * (lib/backup-import.js): en synk i denne siden eller popupen stopper til
 * importen er ferdig og fortsetter så med det som mangler. Synker en annen
 * fane, venter importen på den.
 * Returns meldingen om hva som ble importert, eller null.
 */
async function handleBackupImport(file, setStatus = setBackupStatus) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    setStatus("Klarte ikke å lese filen. Velg en JSON-fil.", { error: true });
    return null;
  }
  const result = parseBackup(parsed);
  if (result.error) {
    setStatus(result.error, { error: true });
    return null;
  }

  const choice = await confirmBackupImport(result.backup, result.skipped, parsed?.exportedAt);
  if (!choice) {
    setStatus("Import avbrutt.");
    return null;
  }

  try {
    const { next, counts } = await importBackup({
      storage: backupStorage,
      backup: result.backup,
      overwrite: choice.overwrite,
      owner: syncOwner,
      takeFrom: syncOwner,
      onWait: () => setStatus("Venter til synken i et annet vindu er ferdig. Turene importeres etterpå."),
    });
    const message = describeImport(counts);
    setStatus(message);

    if (demo) {
      await renderAll(next.reservations ?? allReservations, null);
    } else if (!(await loadStored()) && hasRendered) {
      await renderAll(allReservations, renderedLastSync);
    }
    if (isDevMode() && !demo) refreshDevInfo();
    return message;
  } catch (err) {
    console.error("Backup import failed:", err);
    setStatus("Importen feilet. Ingenting er endret.", { error: true });
    return null;
  }
}

function initBackup() {
  $("backup-export").addEventListener("click", handleBackupExport);
  $("backup-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    // Tøm, så samme fil kan velges igjen.
    e.target.value = "";
    if (file) await handleBackupImport(file);
  });
}

initBackup();
initKeywordEditor();
initRestoreOffer();

// Start
init();
