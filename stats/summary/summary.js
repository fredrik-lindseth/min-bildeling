import { filterDriven, costStats, usagePatterns, mileageStats, monthlyCosts } from "../lib/stats.js";
import { estimateOwnershipCost, OWNERSHIP_METHOD } from "../lib/ownership-cost.js";
import { co2Comparison, CO2_METHOD } from "../lib/co2.js";
import { formatNOK } from "../lib/formatters.js";
import { renderMethodPanel } from "../lib/method-panel.js";
import { isDemoMode, createDemoSession, createDemoBadge } from "../lib/demo-data.js";

const browserAPI = globalThis.browser ?? globalThis.chrome;
// ?demo=1: syntetiske data uten utvidelses-API.
const demo = isDemoMode(window.location.search) ? createDemoSession() : null;
const formatKm = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

function trips(n) {
  return n === 1 ? "1 tur" : `${n} turer`;
}

const MONTH_NAMES = ["Januar","Februar","Mars","April","Mai","Juni","Juli","August","September","Oktober","November","Desember"];

async function init() {
  if (demo) document.body.prepend(createDemoBadge(document));
  const data = demo ?? await browserAPI.runtime.sendMessage({ type: "GET_DATA" });
  if (!data?.reservations?.length) {
    document.querySelector(".summary").innerHTML = '<section class="slide"><p>Ingen turer lagret ennå. Trykk Synkroniser i utvidelsen først.</p></section>';
    return;
  }

  const reservations = data.reservations;
  const years = [...new Set(filterDriven(reservations).map(r => new Date(r.start).getFullYear()))].sort();

  const select = document.getElementById("year-select");
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }
  // Default to most recent full year, or current year
  const currentYear = new Date().getFullYear();
  select.value = years.includes(currentYear - 1) ? currentYear - 1 : years[years.length - 1];

  renderMethod();
  select.addEventListener("change", () => renderYear(reservations, Number(select.value)));
  renderYear(reservations, Number(select.value));
}

function renderYear(reservations, year) {
  const yearData = reservations.filter(r => new Date(r.start).getFullYear() === year);
  const driven = filterDriven(yearData);

  document.getElementById("summary-year").textContent = year;

  // Total cost
  const costs = costStats(yearData);
  document.getElementById("total-cost").textContent = costs ? formatNOK.format(costs.total) : "0 kr";
  document.getElementById("trip-count").textContent = trips(costs ? costs.count : 0);

  // Km
  const mileage = mileageStats(yearData);
  document.getElementById("total-km").textContent = mileage ? `${formatKm.format(mileage.total)} km` : "\u2013";
  document.getElementById("longest-trip").textContent = mileage ? `Lengste tur: ${formatKm.format(mileage.max)} km` : "";

  // Favorite car
  const patterns = usagePatterns(yearData);
  const topCar = patterns.topCars[0];
  document.getElementById("fav-car").textContent = topCar ? topCar.name : "\u2013";
  document.getElementById("fav-car-trips").textContent = topCar ? trips(topCar.count) : "";

  // Busiest month
  const monthly = monthlyCosts(yearData);
  if (monthly.length > 0) {
    const busiest = monthly.reduce((a, b) => b.total > a.total ? b : a);
    const monthIdx = parseInt(busiest.month.split("-")[1], 10) - 1;
    document.getElementById("busiest-month").textContent = MONTH_NAMES[monthIdx];
    document.getElementById("busiest-month-cost").textContent = formatNOK.format(busiest.total);
  } else {
    document.getElementById("busiest-month").textContent = "\u2013";
    document.getElementById("busiest-month-cost").textContent = "";
  }

  // Savings
  const ownership = estimateOwnershipCost(reservations, year);
  if (ownership) {
    const saved = ownership.savings > 0;
    document.getElementById("savings-label").textContent = saved ? "Spart mot å eie bil" : "Dyrere enn å eie bil";
    document.getElementById("savings").textContent = `ca. ${formatNOK.format(Math.abs(ownership.savings))}`;
    document.getElementById("savings-vs").textContent = `regnet mot en ${ownership.carName}`;
  } else {
    document.getElementById("savings").textContent = "\u2013";
    document.getElementById("savings-vs").textContent = "";
  }

  // CO2
  const co2 = co2Comparison(yearData);
  if (co2 && co2.savedKg > 0) {
    document.getElementById("co2-saved").textContent = `ca. ${formatKm.format(Math.round(co2.savedKg))} kg`;
  } else {
    document.getElementById("co2-saved").textContent = "\u2013";
  }
}

// Sparetallet og CO₂-tallet har hvert sitt panel, med samme oppsett som i
// dashboardet.
function renderMethod() {
  const el = document.getElementById("method-detail");
  const ownership = document.createElement("div");
  const co2 = document.createElement("div");
  el.replaceChildren(ownership, co2);
  renderMethodPanel(ownership, OWNERSHIP_METHOD, { idPrefix: "spart-metode", heading: "Spart mot å eie bil", headingLevel: 2 });
  renderMethodPanel(co2, CO2_METHOD, { idPrefix: "co2-metode", heading: "CO₂ spart", headingLevel: 2 });
}

// Én slide per tastetrykk. Nettleserens eget sidesteg for mellomrom og
// PageDown er ca. 87 % av vinduet, så slidene gled ut av linje. Tastene går
// til forrige eller neste slide i stedet. I årsvelgeren, på knapper, lenker
// og «Slik beregnes det» får tastene gjøre det de ellers gjør.
const NEXT_KEYS = new Set(["PageDown", "ArrowDown"]);
const PREV_KEYS = new Set(["PageUp", "ArrowUp"]);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function currentSlideIndex(slides) {
  let best = 0;
  for (let i = 1; i < slides.length; i++) {
    if (Math.abs(slides[i].getBoundingClientRect().top) < Math.abs(slides[best].getBoundingClientRect().top)) best = i;
  }
  return best;
}

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.("select, button, a, input, textarea, summary")) return;
  let step = 0;
  if (e.key === " ") step = e.shiftKey ? -1 : 1;
  else if (NEXT_KEYS.has(e.key)) step = 1;
  else if (PREV_KEYS.has(e.key)) step = -1;
  if (step === 0) return;

  const slides = [...document.querySelectorAll(".slide")];
  const target = slides[currentSlideIndex(slides) + step];
  // Etter siste slide ruller tastene som vanlig, så en åpen metode som er
  // lengre enn skjermen, kan leses til bunns.
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "instant" : "smooth" });
});

init();
