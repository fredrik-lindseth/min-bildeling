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
} from "../lib/stats.js";

import {
  drawChart,
  barChartConfig,
  lineChartConfig,
  resolveColor,
  applyChartTheme,
  axes,
  onColorSchemeChange,
} from "../lib/chart-helpers.js";

import { formatNOK, formatSyncTime } from "../lib/formatters.js";

import { estimateOwnershipCost, COMPARISON_CAR, OWNERSHIP_METHOD } from "../lib/ownership-cost.js";

import {
  CATEGORIES,
  loadCategories,
  saveCategory,
  saveCategories,
  normalizeTripCategories,
  categoryStats,
  autoSuggestAll,
  DEFAULT_KEYWORDS,
  mergeKeywords,
  matchKeyword,
  keywordHits,
  normalizeUserKeywords,
  parseKeywordInput,
  loadUserKeywords,
  saveUserKeywords,
} from "../lib/categories.js";

import { storage as extensionStorage } from "../lib/browser-polyfill.js";
import { isDemoMode, createDemoSession, createDemoBadge } from "../lib/demo-data.js";
import {
  startSync,
  isAuthError,
  describeSyncResult,
  describeProgress,
  describeProgressShort,
} from "../lib/sync-page.js";

import { totalCO2, monthlyCO2, CO2_METHOD } from "../lib/co2.js";
import { createBackup, parseBackup, mergeBackup } from "../lib/backup.js";

import {
  TRANSPORT_MODES,
  loadTransportData,
  saveTransportData,
  transportSummary,
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
  // Samme utvalg som Kostnader og Bruksmønster, så headeren og seksjonene
  // teller likt. Avbestilte og turer uten pris er med i lageret, men ikke her.
  const valid = filterValid(reservations);
  if (valid.length === 0) {
    setHeaderText(dataSummaryEl, "");
    return;
  }
  const total = valid.reduce((sum, r) => sum + (r.price?.total || 0), 0);

  const years = [...new Set(valid.map((r) => new Date(r.start).getFullYear()))]
    .sort((a, b) => a - b);
  const yearLabel =
    years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0]}`;

  setHeaderText(dataSummaryEl, `${formatTrips(valid.length)} i ${yearLabel}, ${formatNOK.format(total)}`);
}

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

  progressBar.hidden = true;
  statusEl.hidden = false;
  emptyState.hidden = true;
  firstRun.hidden = true;
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
  // Under synk står banneret med fremdriften over tallene som fylles inn.
  if (!syncing) hideStatus();
  scrollToHashOnce();
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
  if (!target?.classList.contains("section")) return;
  target.scrollIntoView({ behavior: "instant", block: "start" });
  setActiveNav(id);
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
    if (rect.top <= 140) {
      current = section.id;
    }
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

  // Hovedtallet: summen av faktiske beløp, derfor uten «ca.»
  setText("cost-total", stats ? formatNOK.format(stats.total) : "–");
  const years = yearly.map((y) => y.year);
  const period = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0] ?? ""}`;
  setText(
    "cost-total-text",
    stats ? `brukt på bildeling i ${period}, fordelt på ${formatTrips(stats.count)}.` : ""
  );

  // Alle år: én linje per år øverst i nøkkeltallene
  const figures = $("cost-figures");
  figures.querySelectorAll(".figures__year").forEach((row) => row.remove());
  if (selectedYear === "all" && yearly.length > 1) {
    const rows = yearly.map((y) => {
      const row = document.createElement("div");
      row.className = "figures__year";
      const dt = document.createElement("dt");
      dt.textContent = `Totalt ${y.year}`;
      const dd = document.createElement("dd");
      dd.textContent = formatNOK.format(y.total);
      row.append(dt, dd);
      return row;
    });
    figures.prepend(...rows);
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
  topCarsList.innerHTML = "";
  const top5 = patterns.topCars.slice(0, 5);
  if (top5.length === 0) {
    topCarsList.innerHTML = '<li class="ranked__empty">Ingen data</li>';
  } else {
    for (let i = 0; i < top5.length; i++) {
      const li = document.createElement("li");
      li.className = "ranked__item";
      li.innerHTML = `
        <span class="ranked__row"><span class="ranked__name">${escapeHtml(top5[i].name)}</span>
        <span class="ranked__value">${formatTrips(top5[i].count)}</span></span>
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

  // Method detail
  const methodDetail = $("booking-method-detail");
  if (methodDetail) {
    methodDetail.innerHTML = `
      <p>Tiden fra du booket til turen startet. Booket du etter starttid, teller det som 0 timer, og ytterpunktet viser «rett før avreise». Turer som ikke ble kjørt er med. Avbestilte turer og eldre bookinger uten bookingtidspunkt er ikke.</p>
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
  list.innerHTML = "";
  const top5 = mileage.byCar.slice(0, 5);
  if (top5.length === 0) {
    list.innerHTML = '<li class="ranked__empty">Ingen data</li>';
  } else {
    for (let i = 0; i < top5.length; i++) {
      const li = document.createElement("li");
      li.className = "ranked__item";
      li.innerHTML = `
        <span class="ranked__row"><span class="ranked__name">${escapeHtml(top5[i][0])}</span>
        <span class="ranked__value">${formatKm.format(top5[i][1])} km</span></span>
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
  if (yearly.length >= 2) {
    renderYearOverYear(reservations, yearly);
  } else {
    destroyChart("yoy");
    $("yoy-legend").replaceChildren();
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

  if (!result) {
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
  setLedger("ledger", result.ownershipCost, result.sharingCost, result.savings);

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
    `Regnet mot en ny ${COMPARISON_CAR.name} ${COMPARISON_CAR.variant} til ${formatNOK.format(COMPARISON_CAR.price)}.`;

  // Ownership methodology detail
  const ownershipMethodDetail = $("ownership-method-detail");
  if (ownershipMethodDetail && result) {
    const bd = result.breakdownOwnership;
    ownershipMethodDetail.innerHTML = `
      <p>${escapeHtml(OWNERSHIP_METHOD.note)}</p>
      <p><code>Verditap ${formatNOK.format(bd.depreciation)} + forsikring ${formatNOK.format(bd.insurance)} + trafikkforsikringsavgift ${formatNOK.format(bd.tax)} + vedlikehold ${formatNOK.format(bd.maintenance)} + parkering i ${escapeHtml(result.parkingCity)} ${formatNOK.format(bd.parking)} + dekk ${formatNOK.format(bd.tyres)} + strøm ${formatNOK.format(bd.energy)} = ${formatNOK.format(result.ownershipCost)}</code></p>
      <p>Bildeling, omregnet til ett år: <code>${formatNOK.format(result.sharingCost)}</code></p>
      ${sourcesHtml(OWNERSHIP_METHOD.sources)}
    `;
  }
}

// Regnestykket: egen bil minus bildeling er forskjellen. Egen bil og
// forskjellen er estimater og får «ca.», bildelingen er faktiske beløp.
function setLedger(prefix, ownershipCost, sharingCost, savings) {
  setText(`${prefix}-car`, `ca. ${formatNOK.format(ownershipCost)}`);
  setText(`${prefix}-sharing`, `− ${formatNOK.format(sharingCost)}`);
  setText(`${prefix}-diff`, `ca. ${formatNOK.format(savings)}`);
}

// ---------- Rendering: Section 6 - Turkategorier ----------

async function renderCategories(reservations) {
  const savedCategories = await loadCategories(storage);
  const userKeywords = await loadUserKeywords(storage);
  const keywords = mergeKeywords(DEFAULT_KEYWORDS, userKeywords);

  renderCategoryOverview(reservations, savedCategories, keywords);
  renderTripCheck(reservations, savedCategories, keywords);
  renderKeywordCard(reservations, userKeywords, keywords);
}

// Forslagene teller med i oversikten, men et lagret valg går alltid foran.
function renderCategoryOverview(reservations, savedCategories, keywords) {
  const suggestions = autoSuggestAll(reservations, savedCategories, keywords);
  const stats = categoryStats(reservations, { ...suggestions, ...savedCategories });

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
  tableEl.innerHTML = "";
  for (const [, val] of entries.sort(([, a], [, b]) => b.totalCost - a.totalCost)) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <span class="table-row__name">${escapeHtml(val.label)}</span>
      <span class="table-row__stat">${formatTrips(val.count)}</span>
      <span class="table-row__stat">${formatNOK.format(val.totalCost)}</span>
    `;
    tableEl.appendChild(row);
  }
}

// ---------- Sjekk forslag ----------

const TRIP_PAGE_SIZE = 10;
// Filter og hvor langt brukeren har bladd, overlever ny tegning ved synk og
// lagring av nøkkelord.
const tripCheck = { filter: "check", shown: TRIP_PAGE_SIZE };
const formatTripDate = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric", month: "short", year: "numeric",
});
const CATEGORY_OPTIONS = Object.entries(CATEGORIES)
  .map(([key, { label }]) => ({ key, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "nb"));

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

function renderTripCheck(reservations, savedCategories, keywords) {
  const driven = filterDriven(reservations)
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const section = $("trip-check");
  section.hidden = driven.length === 0;
  if (driven.length === 0) return;

  const saved = { ...savedCategories };
  const matches = new Map(driven.map((r) => [r.id, matchKeyword(r.notes, keywords)]));
  const pending = driven.filter((r) => !saved[r.id] && matches.get(r.id));

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
    renderTripCheck(reservations, saved, keywords);
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
  listEl.innerHTML = "";
  const moreBtn = $("trip-more");

  const appendRows = (from, to) => {
    let first = null;
    for (const r of rows.slice(from, to)) {
      const item = tripRow(r, saved[r.id], matches.get(r.id));
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
    renderCategoryOverview(reservations, saved, keywords);
    const left = pending.filter((r) => !saved[r.id]);
    pending.length = 0;
    pending.push(...left);
    acceptBtn.textContent = `Godta alle forslag (${pending.length})`;
    acceptBtn.disabled = pending.length === 0;
    setTripStatus(`Lagret: ${CATEGORIES[select.value].label}`);
  };

  $("trip-export").onclick = () => {
    const json = JSON.stringify({ tripCategories: saved }, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "bildeleringen-turkategorier.json");
  };

  $("trip-import").onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setTripStatus("Klarte ikke å lese filen. Velg en JSON-fil.", { error: true });
      return;
    }
    const { categories, skipped } = normalizeTripCategories(parsed);
    const ids = Object.keys(categories);
    if (ids.length === 0) {
      setTripStatus("Fant ingen kategorier i filen.", { error: true });
      return;
    }

    // Som for nøkkelordene legges importen til. Det du alt har valgt, står.
    const fresh = await loadCategories(storage);
    const added = Object.fromEntries(ids.filter((id) => !fresh[id]).map((id) => [id, categories[id]]));
    await saveCategories(storage, added);
    await renderCategories(reservations);
    const kept = ids.length - Object.keys(added).length;
    const parts = [`La inn ${formatCount(Object.keys(added).length, "kategori", "kategorier")}`];
    if (kept > 0) parts.push(`${kept} hadde alt en`);
    if (skipped > 0) parts.push(`${formatCount(skipped, "ukjent", "ukjente")} hoppet over`);
    setTripStatus(`${parts.join(", ")}.`);
  };
}

function tripRow(r, savedKey, match) {
  const item = document.createElement("li");
  item.className = "trip-row";
  const notesId = `trip-notes-${r.id}`;
  const date = formatTripDate.format(new Date(r.start));
  const current = savedKey || match?.category || "";
  const placeholder = current
    ? ""
    : `<option value="" selected disabled>Velg kategori</option>`;
  const options = CATEGORY_OPTIONS.map(({ key, label }) =>
    `<option value="${key}"${key === current ? " selected" : ""}>${escapeHtml(label)}</option>`
  ).join("");

  item.innerHTML = `
    <span class="trip-row__date">${escapeHtml(date)}</span>
    <span class="trip-row__notes${hasNotes(r) ? "" : " trip-row__notes--empty"}" id="${escapeHtml(notesId)}">${escapeHtml(hasNotes(r) ? r.notes : "Uten notat")}</span>
    <span class="trip-row__source">${escapeHtml(tripSourceText(savedKey, match))}</span>
    <select class="field trip-row__select" data-id="${escapeHtml(String(r.id))}"
      aria-label="Kategori for turen ${escapeHtml(date)}" aria-describedby="${escapeHtml(notesId)}">
      ${placeholder}${options}
    </select>
  `;
  return item;
}

function formatCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
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

// Meldingen blir stående til neste handling, så den rekker å bli lest.
function setKeywordStatus(message, { error = false } = {}) {
  const status = $("keyword-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
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
      <input type="text" class="field" id="${inputId}" name="${key}" autocomplete="off" spellcheck="false"
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
      setKeywordStatus("Klarte ikke å lese filen. Velg en JSON-fil.", { error: true });
      return;
    }
    const imported = normalizeUserKeywords(parsed?.userKeywords ?? parsed);
    const count = Object.values(imported).reduce((sum, list) => sum + list.length, 0);
    if (count === 0) {
      setKeywordStatus("Fant ingen n\u00f8kkelord i filen.", { error: true });
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

  // Nøkkeltall
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
        return `<p>${escapeHtml(fuel)}: <code>${formatKm.format(d.km)} km \u00d7 ${gPerKm} g/km = ${formatKm.format(Math.round(d.kg))} kg CO\u2082</code></p>`;
      })
      .join("");
    methodDetail.innerHTML = `
      <p>${escapeHtml(CO2_METHOD.note)}</p>
      ${fuelLines}
      <p>Totalt: <code>${formatKm.format(Math.round(total.totalKg))} kg CO\u2082</code> fra <code>${formatKm.format(total.totalKm)} km</code></p>
      ${sourcesHtml(CO2_METHOD.sources)}
    `;
  }

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
  fuelList.innerHTML = "";
  for (const [fuel, data] of Object.entries(total.byFuelType).sort(([,a],[,b]) => b.kg - a.kg)) {
    if (data.trips === 0) continue;
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <span class="table-row__name">${escapeHtml(fuel)}</span>
      <span class="table-row__stat">${formatTrips(data.trips)}</span>
      <span class="table-row__stat">ca. ${formatKm.format(Math.round(data.kg))} kg</span>
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
        select.className = "field";
        select.setAttribute("aria-label", `${definition.label}, ${field.label.toLowerCase()}`);
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
        input.className = "field";
        input.setAttribute("aria-label", `${definition.label}, ${field.label.toLowerCase()}`);
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
  egenbil: NEUTRAL_SERIES,
  buss: "--color-chart-4",
  fly: "--color-chart-5",
  sykkel: NEUTRAL_SERIES,
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
  tableEl.innerHTML = "";
  for (const [, mode] of sortedModes) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <span class="table-row__name">${escapeHtml(mode.label)}</span>
      <span class="table-row__stat">${formatNOK.format(mode.cost)}</span>
      <span class="table-row__stat">ca. ${formatKm.format(Math.round(mode.co2Kg))} kg</span>
      <span class="table-row__stat">${formatKm.format(mode.km)} km</span>
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

// En kilde er en tekst eller { text, url }. Lenken åpnes i ny fane, så
// dashbordet blir stående.
function sourcesHtml(sources) {
  const items = sources.map((s) => {
    const text = escapeHtml(typeof s === "string" ? s : s.text);
    if (!s.url) return `<li>${text}</li>`;
    return `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${text}</a></li>`;
  }).join("");
  return `<p>Kilder:</p><ul>${items}</ul>`;
}

// ---------- Sync ----------

let renderedLastSync = null;

// Fargene i diagrammene er løst for én modus. Bytter systemet mellom lys og
// mørk, tegnes alt på nytt med fargene for den nye modusen.
onColorSchemeChange(() => {
  applyChartTheme();
  if (allReservations.length > 0) renderAll(allReservations, renderedLastSync);
});

async function renderAll(reservations, lastSync) {
  renderedLastSync = lastSync;
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
    await renderAll(data.reservations, data.lastSync);
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
  await renderAll(data.reservations, data.lastSync);
  showMain();
  hasRendered = true;
  return true;
}

function onSyncProgress(progress) {
  showStatus(describeProgress(progress));
  syncBtn.textContent = describeProgressShort(progress);
  if (progress.phase === "details" && progress.total > 0) {
    showProgress(Math.round((progress.current / progress.total) * 100));
    renderWhileSyncing();
  }
}

// Synker (force: uansett tid siden sist) og tegner opp på nytt. Feil og delvise
// resultater blir stående i statusfeltet. showEmpty() kalles bare når synken
// gikk bra og det likevel ikke finnes data.
async function syncAndRender(force) {
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
    if (result.fetched > 0 || !hasRendered) hasData = (await loadStored()) || hasRendered;
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
  if (demo) {
    syncBtn.remove();
    lastSyncedEl.remove();
    // I navigasjonslinjen, som står fast øverst, så merket synes uansett hvor
    // langt ned man har scrollet.
    document.querySelector(".nav__inner").append(createDemoBadge(document));
    await renderAll(demo.reservations, null);
    showMain();
    return;
  }
  showStatus("Laster…");
  const hasData = await loadStored();
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
    link.download = `bildeleringen-${section.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("Export failed:", err);
  }

  btn.disabled = false;
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

const BACKUP_KEYS = ["tripCategories", "transportData", "userKeywords", "reservations", "lastSync"];

function setBackupStatus(message, { error = false } = {}) {
  const status = $("backup-status");
  status.textContent = message;
  status.classList.toggle("form-status--error", error);
}

// I demomodus ligger turene i minnet, ikke i lageret, før noe er importert.
async function readBackupSource() {
  const data = await storage.get(BACKUP_KEYS);
  if (demo && !Array.isArray(data.reservations)) data.reservations = allReservations;
  return data;
}

async function handleBackupExport() {
  try {
    const includeReservations = $("backup-include-trips").checked;
    const backup = createBackup(await readBackupSource(), { includeReservations });
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      `bildeleringen-sikkerhetskopi-${today}.json`,
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

// En synk holder turene i minnet og skriver dem tilbake, så importerte turer
// kunne blitt borte. syncLock leses bare, den skrives aldri herfra.
async function syncIsRunning() {
  if (syncing) return true;
  const { syncLock } = await storage.get(["syncLock"]);
  return Boolean(syncLock && syncLock.expiresAt > Date.now());
}

function describeImport(counts, skippedTrips) {
  const parts = [];
  if (counts.reservationsAdded > 0) parts.push(formatTrips(counts.reservationsAdded));
  const categories = counts.categoriesAdded + counts.categoriesReplaced;
  if (categories > 0) parts.push(formatCount(categories, "kategorivalg", "kategorivalg"));
  if (counts.keywordsAdded > 0) parts.push(formatCount(counts.keywordsAdded, "nøkkelord", "nøkkelord"));
  const transport = counts.transportAdded + counts.transportReplaced;
  if (transport > 0) parts.push(formatCount(transport, "transportrad", "transportrader"));

  let message = parts.length > 0
    ? `Importerte ${parts.join(", ").replace(/, ([^,]*)$/, " og $1")}.`
    : "Alt i filen var lagret fra før.";
  const kept = counts.categoriesKept + counts.transportKept;
  if (kept > 0) message += ` ${kept} sto alt med en annen verdi og ble beholdt.`;
  if (skippedTrips) message += " Turene ble ikke importert fordi en synk pågår. Prøv igjen etterpå.";
  return message;
}

async function handleBackupImport(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    setBackupStatus("Klarte ikke å lese filen. Velg en JSON-fil.", { error: true });
    return;
  }
  const result = parseBackup(parsed);
  if (result.error) {
    setBackupStatus(result.error, { error: true });
    return;
  }

  const choice = await confirmBackupImport(result.backup, result.skipped, parsed?.exportedAt);
  if (!choice) {
    setBackupStatus("Import avbrutt.");
    return;
  }

  try {
    const incoming = { ...result.backup };
    let skippedTrips = false;
    if (incoming.reservations && await syncIsRunning()) {
      incoming.reservations = null;
      skippedTrips = true;
    }
    const { next, counts } = mergeBackup(await readBackupSource(), incoming, choice);
    await storage.set(next);
    setBackupStatus(describeImport(counts, skippedTrips));

    if (demo) {
      await renderAll(next.reservations ?? allReservations, null);
    } else if (!(await loadStored()) && hasRendered) {
      await renderAll(allReservations, renderedLastSync);
    }
    if (isDevMode() && !demo) refreshDevInfo();
  } catch (err) {
    console.error("Backup import failed:", err);
    setBackupStatus("Importen feilet. Ingenting er endret.", { error: true });
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

// Start
init();
