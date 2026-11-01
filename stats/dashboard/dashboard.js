import {
  filterValid,
  filterDriven,
  costStats,
  monthlyCosts,
  yearlyCosts,
  usagePatterns,
  mileageStats,
  bookingPatterns,
} from "../lib/stats.js";

import {
  createBarChart,
  createLineChart,
} from "../lib/chart-helpers.js";

import { formatNOK, formatSyncTime } from "../lib/formatters.js";

import { estimateOwnershipCost, estimateVolvoComparison, OWNERSHIP_METHOD } from "../lib/ownership-cost.js";

import {
  CATEGORIES,
  loadCategories,
  saveCategory,
  categoryStats,
  autoSuggestAll,
  DEFAULT_KEYWORDS,
  mergeKeywords,
  keywordHits,
  normalizeUserKeywords,
  parseKeywordInput,
  loadUserKeywords,
  saveUserKeywords,
} from "../lib/categories.js";

import { storage } from "../lib/browser-polyfill.js";
import { startSync, isAuthError, describeSyncResult, describeProgress } from "../lib/sync-page.js";

import { totalCO2, monthlyCO2, CO2_METHOD } from "../lib/co2.js";

import {
  TRANSPORT_MODES,
  loadTransportData,
  saveTransportData,
  transportSummary,
  TRANSPORT_METHOD,
} from "../lib/transport.js";

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// ---------- CSS Color Helpers ----------

/**
 * Read a CSS custom property value from :root.
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Convert any CSS color string to rgba() with a given alpha.
 * Uses a scratch canvas to let the browser parse the color.
 */
const _colorCtx = document.createElement("canvas").getContext("2d");
function colorWithAlpha(cssColor, alpha) {
  _colorCtx.fillStyle = cssColor;
  // The browser normalises any color to rgb()/rgba() in fillStyle
  const parsed = _colorCtx.fillStyle;
  if (parsed.startsWith("#")) {
    // Kort hex, konverter for hånd
    const r = parseInt(parsed.slice(1, 3), 16);
    const g = parseInt(parsed.slice(3, 5), 16);
    const b = parseInt(parsed.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Already rgb(...) or rgba(...)
  return parsed.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
    const parts = inner.split(",").map((s) => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  });
}

// Set Chart.js global defaults for current theme
Chart.defaults.color = cssVar("--color-text-secondary");
Chart.defaults.borderColor = cssVar("--color-border");

// ---------- Formatters ----------

const formatKm = new Intl.NumberFormat("nb-NO", {
  maximumFractionDigits: 0,
});

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
const mainContent = $("main-content");
const syncBtn = $("sync-btn");
const lastSyncedEl = $("last-synced");
const dataSummaryEl = $("data-summary");

// Feltene skjules når de er tomme, så gap-avstanden i headeren ikke står igjen alene.
function setHeaderText(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function updateDataSummary(reservations) {
  if (!reservations || reservations.length === 0) {
    setHeaderText(dataSummaryEl, "");
    return;
  }
  const valid = filterValid(reservations);
  const total = valid.reduce((sum, r) => sum + (r.price?.total || 0), 0);

  const years = [...new Set(reservations.map((r) => new Date(r.start).getFullYear()))]
    .sort((a, b) => a - b);
  const yearLabel =
    years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0]}`;

  setHeaderText(dataSummaryEl, `${formatTrips(reservations.length)} i ${yearLabel}, ${formatNOK.format(total)}`);
}

// ---------- Chart instances (for cleanup) ----------
const charts = {};

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

function showLoginRequired() {
  statusEl.classList.add("status--login");
  statusText.innerHTML = `<strong>Ikke innlogget</strong><br>Logg inn på app.dele.no og trykk Synkroniser.`;
  removeStatusAction();

  const action = document.createElement("a");
  action.id = "status-action";
  action.className = "status__action";
  action.textContent = "Åpne app.dele.no";
  action.href = "https://app.dele.no";
  action.target = "_blank";
  action.rel = "noopener";
  statusEl.appendChild(action);

  progressBar.hidden = true;
  statusEl.hidden = false;
  emptyState.hidden = true;
}

function removeStatusAction() {
  const existing = document.getElementById("status-action");
  if (existing) existing.remove();
}

// Feil og delvise resultater vises med en Prøv igjen-knapp og blir stående.
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
}

function showProgress(pct) {
  progressBar.hidden = false;
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
  hideStatus();
}

// ---------- Navigation ----------

const navLinks = document.querySelectorAll(".nav__link");

function updateActiveNav() {
  const sections = document.querySelectorAll(".section");
  let current = "";

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    if (rect.top <= 140) {
      current = section.id;
    }
  }

  navLinks.forEach((link) => {
    const isActive = link.dataset.section === current;
    link.classList.toggle("nav__link--active", isActive);
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    navLinks.forEach((l) => l.classList.remove("nav__link--active"));
    link.classList.add("nav__link--active");
  });
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

function buildYearSelector(reservations) {
  const container = $("cost-year-selector");
  const years = new Set();
  for (const r of filterValid(reservations)) {
    years.add(new Date(r.start).getFullYear());
  }

  const sorted = [...years].sort((a, b) => a - b);

  // Clear and rebuild
  container.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "year-btn year-btn--active";
  allBtn.dataset.year = "all";
  allBtn.textContent = "Alle år";
  container.appendChild(allBtn);

  for (const year of sorted) {
    const btn = document.createElement("button");
    btn.className = "year-btn";
    btn.dataset.year = String(year);
    btn.textContent = String(year);
    container.appendChild(btn);
  }

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".year-btn");
    if (!btn) return;

    container.querySelectorAll(".year-btn").forEach((b) =>
      b.classList.remove("year-btn--active")
    );
    btn.classList.add("year-btn--active");

    selectedYear = btn.dataset.year;
    renderCosts(allReservations);
  });
}

function renderCosts(reservations) {
  const filtered = getFilteredByYear(reservations, selectedYear);
  const stats = costStats(filtered);
  const monthly = monthlyCosts(filtered);
  const yearly = yearlyCosts(filtered);
  const mileage = mileageStats(filtered);

  // Yearly total display
  const yearlyEl = document.getElementById("cost-yearly-total");
  if (selectedYear === "all" && yearly.length > 0) {
    yearlyEl.innerHTML = yearly
      .map(
        (y) =>
          `<div class="yearly-row"><span>${y.year}</span><span>${formatNOK.format(y.total)}</span></div>`
      )
      .join("");
  } else if (stats) {
    yearlyEl.textContent = formatNOK.format(stats.total);
  } else {
    yearlyEl.textContent = "–";
  }

  // Stat cards
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
  destroyChart("monthlyCost");
  if (monthly.length > 0) {
    const labels = monthly.map((m) => formatMonthLabel(m.month));
    const data = monthly.map((m) => m.total);
    charts.monthlyCost = createBarChart(
      $("monthly-cost-chart"),
      labels,
      data,
      "Kostnad",
      { yTitle: "Kr" }
    );
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
  destroyChart("tripsPerMonth");
  const tpmEntries = Object.entries(patterns.tripsPerMonth).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (tpmEntries.length > 0) {
    const labels = tpmEntries.map(([key]) => formatMonthLabel(key));
    const data = tpmEntries.map(([, val]) => val);
    charts.tripsPerMonth = createLineChart(
      $("trips-per-month-chart"),
      labels,
      data,
      "Turer",
      { yTitle: "Antall" }
    );
  }

  // Stat cards
  setText("usage-avg-duration", formatDuration(patterns.avgDuration));
  setText("usage-total-trips", valid.length.toString());

  // Top cars list
  const topCarsList = $("top-cars-list");
  topCarsList.innerHTML = "";
  const top5 = patterns.topCars.slice(0, 5);
  if (top5.length === 0) {
    topCarsList.innerHTML = '<li class="ranked-list__empty">Ingen data</li>';
  } else {
    for (let i = 0; i < top5.length; i++) {
      const li = document.createElement("li");
      li.className = "ranked-list__item";
      li.innerHTML = `
        <span class="ranked-list__rank">${i + 1}</span>
        <span class="ranked-list__name">${escapeHtml(top5[i].name)}</span>
        <span class="ranked-list__value">${formatTrips(top5[i].count)}</span>
      `;
      topCarsList.appendChild(li);
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

  // Get CSS custom property values for theming
  const styles = getComputedStyle(document.documentElement);
  const emptyColor = styles.getPropertyValue("--color-heatmap-empty").trim();
  const textColor = styles.getPropertyValue("--color-heatmap-text").trim();
  const heatmapFill = styles.getPropertyValue("--color-heatmap-fill").trim();

  // Hour labels
  ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
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
    ctx.font = "12px " + getComputedStyle(document.body).fontFamily;
    ctx.fillText(dayLabels[day], labelW - 6, y + cellH / 2 + 4);

    for (let hour = 0; hour < 24; hour++) {
      const x = labelW + hour * cellW;
      const intensity = heatmapData[day][hour] / max;

      if (intensity === 0) {
        ctx.fillStyle = emptyColor;
      } else {
        ctx.fillStyle = colorWithAlpha(heatmapFill, 0.15 + intensity * 0.85);
      }
      // Use roundRect if available, fallback to fillRect for older browsers
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, cellW - 2, cellH - 2, 3);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, cellW - 2, cellH - 2);
      }
    }
  }
}

// ---------- Rendering: Section 3 - Bookingmønster ----------

function formatLeadDays(days) {
  if (days == null || isNaN(days)) return "–";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} t`;
  }
  // En desimal opp til 10 dager, deretter heltall
  return days < 10
    ? `${days.toFixed(1)} dager`
    : `${Math.round(days)} dager`;
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

  // Stat cards
  setText("booking-avg-lead", formatLeadDays(patterns.avgDays));
  setText("booking-median-lead", formatLeadDays(patterns.medianDays));
  setText(
    "booking-short-notice",
    `${Math.round(patterns.shortNoticeShare * 100)} %`
  );
  setText("booking-unique-stations", String(patterns.uniqueStations));

  // Lead time histogram
  destroyChart("leadTime");
  const distLabels = patterns.distribution.map((b) => b.label);
  const distData = patterns.distribution.map((b) => b.count);
  charts.leadTime = createBarChart(
    $("lead-time-chart"),
    distLabels,
    distData,
    "Turer",
    { yTitle: "Antall" }
  );

  // Top stations (top 10, resten samlet som "Andre")
  destroyChart("topStations");
  const TOP_N = 10;
  const top = patterns.stationsRanked.slice(0, TOP_N);
  const rest = patterns.stationsRanked.slice(TOP_N);
  const stationLabels = top.map((s) => s.name);
  const stationData = top.map((s) => s.count);
  if (rest.length > 0) {
    stationLabels.push(`Andre (${rest.length})`);
    stationData.push(rest.reduce((sum, s) => sum + s.count, 0));
  }

  charts.topStations = new Chart($("top-stations-chart"), {
    type: "bar",
    data: {
      labels: stationLabels,
      datasets: [
        {
          label: "Turer",
          data: stationData,
          backgroundColor: cssVar("--color-accent"),
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
            label: (ctx) => `${ctx.parsed.x} turer`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Antall turer", font: { size: 12 } },
          ticks: { precision: 0 },
        },
        y: {
          ticks: { font: { size: 12 } },
        },
      },
    },
  });

  // Method detail
  const methodDetail = $("booking-method-detail");
  if (methodDetail) {
    methodDetail.innerHTML = `
      <p>Tiden fra du booket til turen startet. Booket du etter starttid, teller det som 0 timer. Turer som ikke ble kjørt er med. Avbestilte turer og eldre bookinger uten bookingtidspunkt er ikke.</p>
    `;
  }
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

  // Stat cards
  setText("km-total", `${formatKm.format(mileage.total)} km`);
  setText("km-avg", `${formatKm.format(mileage.average)} km`);
  setText("km-max", `${formatKm.format(mileage.max)} km`);

  // Monthly distance bar chart
  destroyChart("monthlyKm");
  if (mileage.byMonth.length > 0) {
    const labels = mileage.byMonth.map(([key]) => formatMonthLabel(key));
    const data = mileage.byMonth.map(([, val]) => val);
    charts.monthlyKm = createBarChart(
      $("monthly-km-chart"),
      labels,
      data,
      "Distanse",
      { yTitle: "Km" }
    );
  }

  // Km by car list
  const list = $("km-by-car-list");
  list.innerHTML = "";
  const top5 = mileage.byCar.slice(0, 5);
  if (top5.length === 0) {
    list.innerHTML = '<li class="ranked-list__empty">Ingen data</li>';
  } else {
    for (let i = 0; i < top5.length; i++) {
      const li = document.createElement("li");
      li.className = "ranked-list__item";
      li.innerHTML = `
        <span class="ranked-list__rank">${i + 1}</span>
        <span class="ranked-list__name">${escapeHtml(top5[i][0])}</span>
        <span class="ranked-list__value">${formatKm.format(top5[i][1])} km</span>
      `;
      list.appendChild(li);
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

  // Year-over-year comparison
  destroyChart("yoy");
  if (yearly.length >= 2) {
    renderYearOverYear(reservations, yearly);
  }

  // Rolling 3-month average
  destroyChart("rollingAvg");
  renderRollingAverage(monthly);

  // Seasonal comparison (need at least 2 years of data)
  if (yearly.length >= 2) {
    $("seasonal-container").hidden = false;
    destroyChart("seasonal");
    renderSeasonalComparison(reservations, yearly);
  } else {
    $("seasonal-container").hidden = true;
  }
}

function renderYearOverYear(reservations, yearly) {
  const canvas = $("yoy-chart");

  // Build datasets per year, indexed by month 0-11
  const datasets = [];
  const colors = [1, 2, 3, 4, 5].map((n) => {
    const c = cssVar(`--color-chart-${n}`);
    return { border: c, bg: colorWithAlpha(c, 0.1) };
  });

  for (let i = 0; i < yearly.length; i++) {
    const year = yearly[i].year;
    const yearData = filterValid(reservations).filter(
      (r) => new Date(r.start).getFullYear() === year
    );

    const byMonth = Array(12).fill(0);
    for (const r of yearData) {
      byMonth[new Date(r.start).getMonth()] += r.price.total;
    }

    const color = colors[i % colors.length];
    datasets.push({
      label: String(year),
      data: byMonth,
      borderColor: color.border,
      backgroundColor: color.bg,
      tension: 0.3,
      fill: false,
    });
  }

  charts.yoy = new Chart(canvas, {
    type: "line",
    data: {
      labels: MONTH_NAMES_FULL,
      datasets,
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: "top" } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 11 } } },
        y: { beginAtZero: true, title: { display: true, text: "Kr", font: { size: 12 } } },
      },
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

  charts.rollingAvg = createLineChart(canvas, labels, data, "Snitt tre måneder", { yTitle: "Kr" });
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

  charts.seasonal = createBarChart(
    canvas,
    MONTH_NAMES_FULL,
    avgPerMonth,
    "Snitt månedskostnad",
    { yTitle: "Kr" }
  );
}

// ---------- Rendering: Section 5 - Bilregnestykket ----------

function renderOwnership(reservations) {
  const result = estimateOwnershipCost(reservations);

  if (!result) {
    $("ownership-empty").hidden = false;
    $("ownership-content").hidden = true;
    return;
  }

  $("ownership-empty").hidden = true;
  $("ownership-content").hidden = false;

  // Set cost amounts
  setText("sharing-cost", formatNOK.format(result.sharingCost));
  setText("ownership-cost", `ca. ${formatNOK.format(result.ownershipCost)}`);

  // Build verdict
  const verdictEl = $("comparison-verdict");
  if (result.savings > 0) {
    verdictEl.textContent = `Du sparer ca. ${formatNOK.format(result.savings)} i året med bildeling`;
    verdictEl.className = "comparison__verdict comparison__verdict--saving";
  } else {
    verdictEl.textContent = `Bildeling koster ca. ${formatNOK.format(Math.abs(result.savings))} mer i året`;
    verdictEl.className = "comparison__verdict comparison__verdict--more";
  }

  // Ownership breakdown horizontal bar chart
  destroyChart("ownershipBreakdown");
  const bd = result.breakdownOwnership;
  const breakdownLabels = [
    "Verditap",
    "Forsikring",
    "Årsavgift",
    "Vedlikehold",
    "Parkering",
    "Drivstoff",
  ];
  const breakdownData = [
    bd.depreciation,
    bd.insurance,
    bd.tax,
    bd.maintenance,
    bd.parking,
    bd.fuel,
  ];
  const breakdownColors = [
    cssVar("--color-chart-1"),
    cssVar("--color-chart-2"),
    cssVar("--color-chart-3"),
    cssVar("--color-chart-4"),
    cssVar("--color-chart-5"),
    cssVar("--color-tertiary"),
  ];

  charts.ownershipBreakdown = new Chart($("ownership-breakdown-chart"), {
    type: "bar",
    data: {
      labels: breakdownLabels,
      datasets: [{
        label: "Kostnad",
        data: breakdownData,
        backgroundColor: breakdownColors,
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
      scales: {
        x: {
          title: { display: true, text: "Kr", font: { size: 12 } },
        },
        y: {
          ticks: { font: { size: 12 } },
        },
      },
    },
  });

  // Volvo EX C40 comparison
  const volvo = estimateVolvoComparison(reservations);
  if (volvo) {
    setText("volvo-sharing-cost", formatNOK.format(volvo.sharingCost));
    setText("volvo-ownership-cost", `ca. ${formatNOK.format(volvo.ownershipCost)}`);

    const volvoVerdictEl = $("volvo-verdict");
    if (volvo.savings > 0) {
      volvoVerdictEl.textContent = `Du sparer ca. ${formatNOK.format(volvo.savings)} i året med bildeling`;
      volvoVerdictEl.className = "comparison__verdict comparison__verdict--saving";
    } else {
      volvoVerdictEl.textContent = `Bildeling koster ca. ${formatNOK.format(Math.abs(volvo.savings))} mer i året`;
      volvoVerdictEl.className = "comparison__verdict comparison__verdict--more";
    }
  }

  // Note text
  const categoryName = result.category || "ukjent";
  const noteEl = $("comparison-note");
  noteEl.textContent = `Regnet mot din mest brukte bilkategori (${categoryName}) og Volvo EX C40 2026.`;

  // Ownership methodology detail
  const ownershipMethodDetail = $("ownership-method-detail");
  if (ownershipMethodDetail && result) {
    const bd = result.breakdownOwnership;
    ownershipMethodDetail.innerHTML = `
      <p>${escapeHtml(OWNERSHIP_METHOD.note)}</p>
      <p style="margin-top: 4px;"><code>Verditap ${formatNOK.format(bd.depreciation)} + forsikring ${formatNOK.format(bd.insurance)} + årsavgift ${formatNOK.format(bd.tax)} + vedlikehold ${formatNOK.format(bd.maintenance)} + parkering ${formatNOK.format(bd.parking)} + drivstoff ${formatNOK.format(bd.fuel)} = ${formatNOK.format(result.ownershipCost)}</code></p>
      <p style="margin-top: 4px;">Bildeling, omregnet til ett år: <code>${formatNOK.format(result.sharingCost)}</code></p>
      ${sourcesHtml(OWNERSHIP_METHOD.sources)}
    `;
  }
}

// ---------- Rendering: Section 6 - Turkategorier ----------

async function renderCategories(reservations) {
  // 1. Load saved categories from storage
  const savedCategories = await loadCategories(storage);
  const userKeywords = await loadUserKeywords(storage);
  const keywords = mergeKeywords(DEFAULT_KEYWORDS, userKeywords);

  // 2. Auto-suggest for uncategorized trips
  const suggestions = autoSuggestAll(reservations, savedCategories, keywords);

  // 3. Merge saved + suggestions for stats display
  const merged = { ...suggestions, ...savedCategories };

  // 4. Calculate stats
  const stats = categoryStats(reservations, merged);

  // 5. Render donut chart (cost distribution)
  destroyChart("categoryDonut");
  const entries = Object.entries(stats).filter(([, v]) => v.totalCost > 0);
  if (entries.length > 0) {
    const labels = entries.map(([, v]) => v.label);
    const data = entries.map(([, v]) => v.totalCost);
    const colors = entries.map((_, i) => cssVar(`--color-chart-${(i % 5) + 1}`));

    charts.categoryDonut = new Chart($("category-donut-chart"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "right" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = formatNOK.format(ctx.parsed);
                const pct = Math.round((ctx.parsed / data.reduce((a, b) => a + b, 0)) * 100);
                return `${ctx.label}: ${val} (${pct} %)`;
              },
            },
          },
        },
      },
    });
  }

  // 6. Render category table
  const tableEl = $("category-table");
  tableEl.innerHTML = "";
  for (const [key, val] of entries.sort(([, a], [, b]) => b.totalCost - a.totalCost)) {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <span class="category-row__name">${escapeHtml(val.label)}</span>
      <span class="category-row__stat">${formatTrips(val.count)}</span>
      <span class="category-row__stat">${formatNOK.format(val.totalCost)}</span>
    `;
    tableEl.appendChild(row);
  }

  // 7. Show uncategorized trips with suggestions (max 10)
  const uncategorizedWithSuggestions = filterDriven(reservations)
    .filter(r => !savedCategories[r.id] && suggestions[r.id])
    .slice(0, 10);

  if (uncategorizedWithSuggestions.length > 0) {
    $("uncategorized-section").hidden = false;
    const listEl = $("suggestion-list");
    listEl.innerHTML = "";

    for (const r of uncategorizedWithSuggestions) {
      const catKey = suggestions[r.id];
      const catLabel = CATEGORIES[catKey]?.label || catKey;
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.innerHTML = `
        <span class="suggestion-item__notes">${escapeHtml(r.notes || "Ingen notat")}</span>
        <button class="suggestion-item__btn" data-id="${r.id}" data-cat="${catKey}">${escapeHtml(catLabel)}</button>
      `;
      listEl.appendChild(item);
    }

    // onclick, ikke addEventListener: renderCategories kjøres på nytt ved
    // sync og lagring av nøkkelord, og lyttere ville ellers hopet seg opp.
    listEl.onclick = async (e) => {
      const btn = e.target.closest(".suggestion-item__btn");
      if (!btn) return;
      await saveCategory(storage, btn.dataset.id, btn.dataset.cat);
      btn.textContent = "\u2713";
      btn.disabled = true;
    };
  } else {
    $("uncategorized-section").hidden = true;
  }

  // 8. Egne nøkkelord
  renderKeywordCard(reservations, userKeywords, keywords);
}

// Rekkefølgen i skjemaet er den samme som suggestCategory() sjekker i, så
// brukeren ser hvilken kategori som vinner når et notat treffer flere.
function keywordCategoryOrder() {
  const order = Object.keys(DEFAULT_KEYWORDS);
  for (const key of Object.keys(CATEGORIES)) {
    if (!order.includes(key)) order.push(key);
  }
  return order;
}

function setKeywordStatus(message) {
  const status = $("keyword-status");
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
  }, 4000);
}

function formatTrips(n) {
  return n === 1 ? "1 tur" : `${n} turer`;
}

function renderKeywordCard(reservations, userKeywords, keywords) {
  const hits = keywordHits(reservations, keywords);
  const pct = hits.total > 0 ? Math.round((hits.matched / hits.total) * 100) : 0;
  setText(
    "keyword-total",
    hits.total > 0
      ? `Treffer ${hits.matched} av ${hits.total} turnotater (${pct} %)`
      : "Ingen turnotater \u00e5 kategorisere"
  );

  const fieldsEl = $("keyword-fields");
  fieldsEl.innerHTML = "";
  for (const key of keywordCategoryOrder()) {
    const inputId = `keyword-${key}`;
    const hintId = `keyword-${key}-hint`;
    const defaults = DEFAULT_KEYWORDS[key] || [];
    const row = document.createElement("div");
    row.className = "keyword-row";
    row.innerHTML = `
      <label class="keyword-row__label" for="${inputId}">${escapeHtml(CATEGORIES[key].label)}</label>
      <input type="text" id="${inputId}" name="${key}" autocomplete="off" spellcheck="false"
        aria-describedby="${hintId}">
      <span class="keyword-row__hits" id="${hintId}">
        ${formatTrips(hits.perCategory[key] || 0)}${defaults.length > 0 ? `, ${defaults.length} standardord` : ""}
      </span>
    `;
    row.querySelector("input").value = (userKeywords[key] || []).join(", ");
    fieldsEl.appendChild(row);
  }

  $("keyword-form").onsubmit = async (e) => {
    e.preventDefault();
    const next = {};
    for (const key of keywordCategoryOrder()) {
      const words = parseKeywordInput($(`keyword-${key}`).value);
      // JSON-import kan gi ord med kantmellomrom («tur »), som ville gått
      // tapt om de ble trimmet her. Behold dem når teksten er uendret.
      const previous = userKeywords[key] || [];
      next[key] = words.join(", ") === previous.map((w) => w.trim()).join(", ")
        ? previous
        : words;
    }
    await saveUserKeywords(storage, next);
    await renderCategories(reservations);
    setKeywordStatus("Lagret");
  };

  $("keyword-export").onclick = () => {
    const json = JSON.stringify(userKeywords, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "bildeleringen-nokkelord.json");
  };

  $("keyword-import").onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setKeywordStatus("Klarte ikke å lese filen. Velg en JSON-fil.");
      return;
    }
    const imported = normalizeUserKeywords(parsed?.userKeywords ?? parsed);
    const count = Object.values(imported).reduce((sum, list) => sum + list.length, 0);
    if (count === 0) {
      setKeywordStatus("Fant ingen n\u00f8kkelord i filen.");
      return;
    }

    // Importen legges til de eksisterende ordene, den erstatter dem ikke.
    const fresh = await loadUserKeywords(storage);
    const combined = {};
    for (const key of keywordCategoryOrder()) {
      combined[key] = [...(fresh[key] || []), ...(imported[key] || [])];
    }
    await saveUserKeywords(storage, combined);
    await renderCategories(reservations);
    setKeywordStatus(`Importerte ${count} n\u00f8kkelord.`);
  };
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

  // Stat cards
  setText("co2-total", `ca. ${formatKm.format(Math.round(total.totalKg))} kg`);
  setText("co2-avg-km", `ca. ${Math.round(total.avgPerKm)} g/km`);

  // Electric percentage
  const elTrips = total.byFuelType["Elektrisitet"]?.trips || 0;
  const elPct = total.tripCount > 0 ? Math.round((elTrips / total.tripCount) * 100) : 0;
  setText("co2-electric-pct", `${elPct} %`);

  // Utregningen per drivstofftype, med tekst og kilder fra CO2_METHOD.
  const methodDetail = $("co2-method-detail");
  if (methodDetail) {
    const fuelLines = Object.entries(total.byFuelType)
      .filter(([, d]) => d.trips > 0)
      .sort(([, a], [, b]) => b.kg - a.kg)
      .map(([fuel, d]) => {
        const gPerKm = d.km > 0 ? Math.round((d.kg * 1000) / d.km) : 0;
        return `<p>${fuel}: <code>${formatKm.format(d.km)} km \u00d7 ${gPerKm} g/km = ${formatKm.format(Math.round(d.kg))} kg CO\u2082</code></p>`;
      })
      .join("");
    methodDetail.innerHTML = `
      <p>${escapeHtml(CO2_METHOD.note)}</p>
      ${fuelLines}
      <p style="margin-top: 4px;">Totalt: <code>${formatKm.format(Math.round(total.totalKg))} kg CO\u2082</code> fra <code>${formatKm.format(total.totalKm)} km</code></p>
      ${sourcesHtml(CO2_METHOD.sources)}
    `;
  }

  // Monthly chart
  destroyChart("monthlyCO2");
  if (monthly.length > 0) {
    charts.monthlyCO2 = createBarChart(
      $("monthly-co2-chart"),
      monthly.map(m => formatMonthLabel(m.month)),
      monthly.map(m => Math.round(m.co2Kg)),
      "CO\u2082",
      { yTitle: "Kg" }
    );
  }

  // Fuel type breakdown
  const fuelList = $("co2-fuel-list");
  fuelList.innerHTML = "";
  for (const [fuel, data] of Object.entries(total.byFuelType).sort(([,a],[,b]) => b.kg - a.kg)) {
    if (data.trips === 0) continue;
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <span class="category-row__name">${escapeHtml(fuel)}</span>
      <span class="category-row__stat">${formatTrips(data.trips)}</span>
      <span class="category-row__stat">ca. ${formatKm.format(Math.round(data.kg))} kg</span>
    `;
    fuelList.appendChild(row);
  }
}

// ---------- Rendering: Section 8 - Min transport ----------

let transportYear = null;

function getTransportYears(reservations) {
  const years = new Set();
  for (const r of filterValid(reservations)) {
    years.add(new Date(r.start).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

function buildTransportForm(year, savedData) {
  const container = $("transport-fields");
  container.innerHTML = "";
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
      if (field.type === "select") {
        const select = document.createElement("select");
        select.name = `${mode}_${field.key}`;
        select.className = "transport-select";
        for (const opt of field.options) {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          if (modeData[field.key] === opt.value) option.selected = true;
          select.appendChild(option);
        }
        row.appendChild(select);
      } else {
        const input = document.createElement("input");
        // type="text" + inputmode lar oss godta "4 740" og andre format.
        // Tall-input parses og normaliseres ved save og blur.
        input.type = "text";
        input.inputMode = "numeric";
        input.autocomplete = "off";
        input.name = `${mode}_${field.key}`;
        input.placeholder = field.label;
        if (modeData[field.key] != null && modeData[field.key] !== 0) {
          input.value = formatNumberDisplay(modeData[field.key]);
        }
        input.addEventListener("blur", () => {
          const parsed = parseNumberInput(input.value);
          input.value = parsed > 0 ? formatNumberDisplay(parsed) : "";
        });
        row.appendChild(input);
      }
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
  egenbil: "--color-secondary",
  buss: "--color-chart-4",
  fly: "--color-chart-5",
  sykkel: "--color-text-tertiary",
};

async function renderTransport(reservations) {
  const years = getTransportYears(reservations);
  if (years.length === 0) return;

  // Build year selector
  const select = $("transport-year");
  select.innerHTML = "";
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }

  // Default to current or most recent year
  if (!transportYear || !years.includes(transportYear)) {
    transportYear = years[0];
  }
  select.value = transportYear;

  // Load saved transport data
  const savedData = await loadTransportData(storage);

  // Build form
  buildTransportForm(transportYear, savedData);

  // Render summary if data exists
  renderTransportSummary(reservations, savedData, transportYear);

  // Year change handler
  select.onchange = async () => {
    transportYear = Number(select.value);
    const freshData = await loadTransportData(storage);
    buildTransportForm(transportYear, freshData);
    renderTransportSummary(reservations, freshData, transportYear);
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

    // Show save status
    const status = $("transport-save-status");
    status.textContent = "Lagret";
    setTimeout(() => { status.textContent = ""; }, 2000);

    // Re-render summary
    renderTransportSummary(reservations, freshData, transportYear);
  };

  // «Tøm feltene» tømmer alle input-felt (men lagrer ikke før bruker
  // trykker Lagre, gir mulighet til å ombestemme seg).
  $("transport-reset").onclick = () => {
    const inputs = document.querySelectorAll("#transport-fields input");
    for (const input of inputs) input.value = "";
    const status = $("transport-save-status");
    status.textContent = "Trykk Lagre for å slette";
    setTimeout(() => { status.textContent = ""; }, 3000);
  };
}

function renderTransportSummary(reservations, savedData, year) {
  const yearData = (savedData && savedData[year]) || {};
  const sharingStats = getSharingStatsForYear(reservations, year);
  const summary = transportSummary(yearData, sharingStats);

  // Check if there is any data beyond bildeling
  const hasOtherModes = Object.keys(summary.modes).some((k) => k !== "bildeling");
  const hasBildeling = summary.modes.bildeling && summary.modes.bildeling.cost > 0;

  if (!hasOtherModes && !hasBildeling) {
    $("transport-summary").hidden = true;
    return;
  }

  $("transport-summary").hidden = false;

  // Summary cards
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
  destroyChart("transportCost");
  if (sortedModes.some(([, m]) => m.cost > 0)) {
    const costEntries = sortedModes.filter(([, m]) => m.cost > 0);
    charts.transportCost = new Chart($("transport-cost-chart"), {
      type: "doughnut",
      data: {
        labels: costEntries.map(([, m]) => m.label),
        datasets: [
          {
            data: costEntries.map(([, m]) => m.cost),
            backgroundColor: costEntries.map(([key]) =>
              cssVar(TRANSPORT_CHART_COLORS[key] || "--color-chart-1")
            ),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "right" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = formatNOK.format(ctx.parsed);
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = Math.round((ctx.parsed / total) * 100);
                return `${ctx.label}: ${val} (${pct} %)`;
              },
            },
          },
        },
      },
    });
  }

  // CO2 donut chart
  destroyChart("transportCO2");
  if (sortedModes.some(([, m]) => m.co2Kg > 0)) {
    const co2Entries = sortedModes.filter(([, m]) => m.co2Kg > 0);
    charts.transportCO2 = new Chart($("transport-co2-chart"), {
      type: "doughnut",
      data: {
        labels: co2Entries.map(([, m]) => m.label),
        datasets: [
          {
            data: co2Entries.map(([, m]) => Math.round(m.co2Kg)),
            backgroundColor: co2Entries.map(([key]) =>
              cssVar(TRANSPORT_CHART_COLORS[key] || "--color-chart-1")
            ),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "right" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = Math.round((ctx.parsed / total) * 100);
                return `${ctx.label}: ca. ${ctx.parsed} kg (${pct} %)`;
              },
            },
          },
        },
      },
    });
  }

  // Tabellen, sortert etter kostnad, høyest først
  const tableEl = $("transport-table");
  tableEl.innerHTML = "";
  for (const [, mode] of sortedModes) {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <span class="category-row__name">${escapeHtml(mode.label)}</span>
      <span class="category-row__stat">${formatNOK.format(mode.cost)}</span>
      <span class="category-row__stat">ca. ${formatKm.format(Math.round(mode.co2Kg))} kg</span>
      <span class="category-row__stat">${formatKm.format(mode.km)} km</span>
    `;
    tableEl.appendChild(row);
  }

  // Methodology detail
  const methodDetail = $("transport-method-detail");
  if (methodDetail) {
    methodDetail.innerHTML = `
      <p>${escapeHtml(TRANSPORT_METHOD.note)} Bildelingstallene hentes fra dele.no.</p>
      ${sourcesHtml(TRANSPORT_METHOD.sources)}
    `;
  }
}

// ---------- Utility ----------

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

function sourcesHtml(sources) {
  const items = sources.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  return `<p style="margin-top: 8px;">Kilder:</p><ul style="margin-left: 16px; margin-top: 4px;">${items}</ul>`;
}

// ---------- Sync ----------

async function renderAll(reservations, lastSync) {
  allReservations = reservations;
  setHeaderText(lastSyncedEl, formatSyncTime(lastSync));
  updateDataSummary(allReservations);

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

async function loadStored() {
  const data = await sendMessage({ type: "GET_DATA" });
  if (!data || !data.reservations || data.reservations.length === 0) return false;
  await renderAll(data.reservations, data.lastSync);
  showMain();
  hasRendered = true;
  return true;
}

function onSyncProgress(progress) {
  showStatus(describeProgress(progress));
  if (progress.phase === "details" && progress.total > 0) {
    showProgress(Math.round((progress.current / progress.total) * 100));
  }
}

// Synker (force: uansett tid siden sist) og tegner opp på nytt. Feil og delvise
// resultater blir stående i statusfeltet. showEmpty() kalles bare når synken
// gikk bra og det likevel ikke finnes data.
async function syncAndRender(force) {
  syncBtn.disabled = true;
  syncBtn.classList.add("is-syncing");
  if (force) showStatus("Synkroniserer…");

  const result = await startSync({ force, onProgress: onSyncProgress });

  syncBtn.disabled = false;
  syncBtn.classList.remove("is-syncing");
  progressBar.hidden = true;

  // Tegn opp på nytt bare når synken faktisk hentet noe, eller ingenting vises ennå.
  let hasData = hasRendered;
  try {
    if (result.fetched > 0 || !hasRendered) hasData = await loadStored();
  } catch (e) {
    console.error("[dashboard] Klarte ikke å lese lagrede data", e);
    showStatus("Klarte ikke å lese lagrede turer. Last inn siden på nytt.");
    return;
  }
  if (isDevMode()) refreshDevInfo();

  if (isAuthError(result.error)) {
    showLoginRequired();
    return;
  }
  const message = describeSyncResult(result);
  if (message) {
    showSyncMessage(message);
  } else if (!hasData) {
    showEmpty();
  } else {
    hideStatus();
  }
}

// ---------- Init ----------

async function init() {
  showStatus("Laster…");
  const hasData = await loadStored();
  if (!hasData) showStatus("Synkroniserer…");
  // Uten force synker den bare når det er over en time siden sist, eller når
  // en tidligere synk ble avbrutt.
  await syncAndRender(false);
}

// Summary button
$("summary-btn").addEventListener("click", () => {
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
  btn.style.opacity = "0.5";

  try {
    const canvas = await html2canvas(section, {
      backgroundColor: cssVar("--color-bg"),
      scale: 2,
    });

    const link = document.createElement("a");
    link.download = `bildeleringen-${section.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("Export failed:", err);
  }

  btn.disabled = false;
  btn.style.opacity = "";
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
  el.classList.remove("dev-status--ok", "dev-status--error");
  if (kind === "ok") el.classList.add("dev-status--ok");
  if (kind === "error") el.classList.add("dev-status--error");
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
    downloadBlob(blob, `bildeleringen-backup-${today}.json`);
    setDevStatus(`Eksporterte ${formatTrips(payload.reservations.length)}.`, "ok");
    clearDevStatusLater();
  } catch (err) {
    console.error("Export failed:", err);
    setDevStatus(`Eksport feilet: ${err.message}`, "error");
  }
}

// Bekreftelse i et eget <dialog> framfor window.confirm(), som WebDriver avviser
// stille i den fjernstyrte nettleseren. Esc og Avbryt gir false, og fokus
// starter på Avbryt.
function confirmDialog(message, confirmLabel) {
  const dialog = $("dev-confirm");
  $("dev-confirm-text").textContent = message;
  $("dev-confirm-ok").textContent = confirmLabel;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
    $("dev-confirm-cancel").focus();
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
  if (!isDevMode()) return;

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
}

initDevTools();

// Start
init();
