import { filterDriven, costStats, usagePatterns, mileageStats, monthlyCosts } from "../lib/stats.js";
import { estimateOwnershipCost, OWNERSHIP_METHOD } from "../lib/ownership-cost.js";
import { co2Comparison, CO2_METHOD } from "../lib/co2.js";
import { formatNOK } from "../lib/formatters.js";

const browserAPI = typeof browser !== "undefined" ? browser : chrome;
const formatKm = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

function trips(n) {
  return n === 1 ? "1 tur" : `${n} turer`;
}

// «en kombi», men «en SUV»: kategoriene fra Dele har stor forbokstav.
function categoryPhrase(category) {
  return category === "SUV" ? "en SUV" : `en ${category.toLowerCase()}`;
}

const MONTH_NAMES = ["Januar","Februar","Mars","April","Mai","Juni","Juli","August","September","Oktober","November","Desember"];

async function init() {
  const data = await browserAPI.runtime.sendMessage({ type: "GET_DATA" });
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
    document.getElementById("savings-vs").textContent = `regnet mot ${categoryPhrase(ownership.category)}`;
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

function renderMethod() {
  const el = document.getElementById("method-detail");
  el.replaceChildren();
  const add = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    el.appendChild(node);
    return node;
  };
  add("p", OWNERSHIP_METHOD.note);
  add("p", `${CO2_METHOD.note} ${CO2_METHOD.comparison}`);
  add("p", "Kilder:");
  const list = add("ul", "");
  for (const source of [...OWNERSHIP_METHOD.sources, ...CO2_METHOD.sources]) {
    const li = document.createElement("li");
    li.textContent = source;
    list.appendChild(li);
  }
}

init();
