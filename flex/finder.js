import { solve, splitPairs, REGION_CEILING_M } from "./lib/flex.js";
import { parseLocalISO, toLocalISO } from "./lib/format.js";
import { getPlaces, savePlace } from "./lib/storage.js";
import { stationPlaces } from "./lib/places.js";
import { searchErrorText } from "./lib/search-api.js";

// 2→4 km-utvidelsen gir bare mening ved en bevisst kort radius.
const WIDEN_MAX_M = 5000;

const api = typeof browser !== "undefined" ? browser : chrome;

const STATE_LABEL = { AVAILABLE: "Ledig", RESERVED: "Opptatt", UNAVAILABLE: "Utilgjengelig" };

let tipEl = null;
function showTip(target, text) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  tipEl.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
}
function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

const CATEGORIES = ["Småbil", "Minibil", "Kombi", "Stasjonsvogn", "SUV", "Varebil"];
const CATEGORY_OFF_BY_DEFAULT = new Set(["Småbil", "Varebil"]);
const FUELS = ["Bensin", "Diesel", "Elektrisitet"];
const WEEKDAYS = ["ma", "ti", "on", "to", "fr", "lø", "sø"];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

const pad = (n) => String(n).padStart(2, "0");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function fmtDay(date) {
  return cap(date.toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" }));
}
function fmtTime(date) {
  return date.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}
function fmtRange(a, b) {
  const sameDay = a.toDateString() === b.toDateString();
  return sameDay
    ? `${fmtDay(a)} ${fmtTime(a)}–${fmtTime(b)}`
    : `${fmtDay(a)} ${fmtTime(a)} – ${fmtDay(b)} ${fmtTime(b)}`;
}

// Tre kilder til stedsvalg: brukerens lagrede steder (storage), nåværende
// posisjon (geolokasjon, bare i minnet) og stasjonslisten fra /api/locations.
// Koden har ingen innebygde steder.
const GEO_ID = "geo";
let savedPlaces = [];
let stations = [];
let geoPlace = null;
let rangeStart = null;
let rangeEnd = null;
let calView = null;

const allPlaces = () => [...savedPlaces, ...(geoPlace ? [geoPlace] : []), ...stations];

async function init() {
  savedPlaces = await getPlaces();
  renderPlaceOptions(savedPlaces[0]?.id || "");
  const placeSel = document.getElementById("place");
  placeSel.addEventListener("change", onPlaceChange);
  document.getElementById("placeSaveBtn").addEventListener("click", onPlaceSave);
  loadStations();

  buildTimeOptions();
  document.getElementById("startTime").value = "09:00";
  document.getElementById("endTime").value = "21:00";
  buildChips("categoryChips", CATEGORIES, (v) => !CATEGORY_OFF_BY_DEFAULT.has(v));
  buildChips("fuelChips", FUELS, () => true);
  document.getElementById("maxdist").addEventListener("change", updateFilterHint);
  updateFilterHint();

  initCalendar();
  document.getElementById("startTime").addEventListener("change", updateSummary);
  document.getElementById("endTime").addEventListener("change", updateSummary);

  wireDurationToggle();
  document.getElementById("wish").addEventListener("submit", onSearch);
  document.getElementById("watch-save").addEventListener("click", onWatchSave);
}

function renderPlaceOptions(selectedId) {
  const sel = document.getElementById("place");
  const opts = [el("option", { value: "", text: "Velg posisjon…" })];
  if (savedPlaces.length) {
    const g = el("optgroup", { label: "Mine steder" });
    for (const p of savedPlaces) g.append(el("option", { value: p.id, text: p.name }));
    opts.push(g);
  }
  opts.push(el("option", { value: GEO_ID, text: geoPlace ? "Min posisjon (hentet)" : "Min posisjon" }));
  if (stations.length) {
    const g = el("optgroup", { label: "Stasjoner" });
    for (const p of stations) g.append(el("option", { value: p.id, text: p.name }));
    opts.push(g);
  }
  sel.replaceChildren(...opts);
  sel.value = selectedId;
  updatePlaceSave();
}

function selectedPlace() {
  const id = document.getElementById("place").value;
  return allPlaces().find((p) => p.id === id) || null;
}

// "Husk stedet" gir bare mening for steder som ikke alt er lagret.
function updatePlaceSave() {
  const place = selectedPlace();
  const canSave = place && !savedPlaces.some((p) => p.id === place.id);
  document.getElementById("placeSave").hidden = !canSave;
  if (canSave) document.getElementById("placeLabel").value = place.id === GEO_ID ? "" : place.name;
}

async function loadStations() {
  const res = await api.runtime.sendMessage({ type: "GET_LOCATIONS" }).catch(() => null);
  if (!res || res.error) {
    if (!savedPlaces.length) {
      setMsg(document.getElementById("placeMsg"),
        "Logg inn på app.dele.no for å se stasjonene. Bruk «Min posisjon» så lenge.", "");
    }
    return;
  }
  stations = stationPlaces(res.locations);
  const current = document.getElementById("place").value;
  renderPlaceOptions(current);
  setMsg(document.getElementById("placeMsg"), "", "");
}

async function onPlaceChange() {
  const sel = document.getElementById("place");
  const msg = document.getElementById("placeMsg");
  setMsg(msg, "", "");
  if (sel.value === GEO_ID && !geoPlace) {
    setMsg(msg, "Henter posisjon…", "");
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 300000 }));
      geoPlace = { id: GEO_ID, name: "Min posisjon", point: { lng: pos.coords.longitude, lat: pos.coords.latitude } };
      renderPlaceOptions(GEO_ID);
      setMsg(msg, "", "");
    } catch {
      renderPlaceOptions("");
      setMsg(msg, "Fant ikke posisjonen. Velg en stasjon.", "err");
    }
    return;
  }
  updatePlaceSave();
}

async function onPlaceSave() {
  const place = selectedPlace();
  const msg = document.getElementById("placeMsg");
  const name = document.getElementById("placeLabel").value.trim();
  if (!place) return;
  if (!name) { setMsg(msg, "Gi stedet et navn.", "err"); return; }
  const saved = { id: `saved:${Date.now()}`, name, point: place.point };
  savedPlaces = await savePlace(saved);
  renderPlaceOptions(saved.id);
  setMsg(msg, `Lagret «${name}».`, "ok");
}

async function onWatchSave() {
  const msg = document.getElementById("watch-msg");
  const wish = readWish();                                // earliestStart/latestEnd er Date
  const placeName = selectedPlace()?.name || "Sted";
  const minHours = Number(document.getElementById("watch-minhours").value);
  const windowHours = (wish.latestEnd - wish.earliestStart) / 3600000; // Date-diff i ms
  if (!wish.point) { setMsg(msg, "Velg posisjon først.", "err"); return; }
  if (wish.latestEnd <= wish.earliestStart) { setMsg(msg, "Sluttiden må være etter starten.", "err"); return; }
  if (!minHours || minHours <= 0) { setMsg(msg, "Skriv minst 1 time.", "err"); return; }
  if (minHours > windowHours) {
    setMsg(msg, `Du ber om ${minHours} t, men tidsrommet er bare ${Math.floor(windowHours)} t.`, "err");
    return;
  }
  await api.runtime.sendMessage({ type: "ADD_WATCH", watch: {
    label: `${placeName}, ${minHours} t`,
    point: wish.point, placeName,
    filters: wish.filters,
    earliestStart: toLocalISO(wish.earliestStart),
    latestEnd: toLocalISO(wish.latestEnd),
    minHours,
  }});
  setMsg(msg, "Lagret i «Mine overvåkninger».", "ok");
}

function setMsg(el, text, cls) {
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (cls) el.classList.add(cls);
}

const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function initCalendar() {
  const now = new Date();
  rangeStart = atMidnight(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  rangeEnd = atMidnight(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3));
  calView = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  document.getElementById("calPrev").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => shiftMonth(1));
  renderCalendar();
}

function shiftMonth(dir) {
  calView = new Date(calView.getFullYear(), calView.getMonth() + dir, 1);
  renderCalendar();
}

function pickDay(date) {
  if (!rangeStart || rangeEnd || date < rangeStart) {
    rangeStart = date;
    rangeEnd = null;
  } else {
    rangeEnd = date;
  }
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById("calGrid");
  grid.replaceChildren();
  document.getElementById("calMonth").textContent =
    cap(calView.toLocaleDateString("nb-NO", { month: "long", year: "numeric" }));

  const today = atMidnight(new Date());
  document.getElementById("calPrev").disabled =
    calView.getFullYear() === today.getFullYear() && calView.getMonth() === today.getMonth();

  for (const wd of WEEKDAYS) grid.append(el("div", { class: "cal__wd", text: wd }));

  const lead = (new Date(calView.getFullYear(), calView.getMonth(), 1).getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.append(el("div", { class: "cal__day is-empty" }));

  const days = new Date(calView.getFullYear(), calView.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(calView.getFullYear(), calView.getMonth(), d);
    const btn = el("button", { type: "button", class: "cal__day", text: String(d) });
    const past = date < today;
    if (past) btn.disabled = true;
    if (date.getTime() === today.getTime()) btn.classList.add("is-today");
    if (rangeStart && date.getTime() === rangeStart.getTime()) btn.classList.add("is-start");
    if (rangeEnd && date.getTime() === rangeEnd.getTime()) btn.classList.add("is-end");
    if (rangeStart && rangeEnd && date > rangeStart && date < rangeEnd) btn.classList.add("in-range");
    if (!past) btn.addEventListener("click", () => pickDay(date));
    grid.append(btn);
  }
  updateSummary();
}

function updateSummary() {
  const s = document.getElementById("rangeSummary");
  if (!rangeStart) { s.textContent = "Velg startdag"; return; }
  const st = document.getElementById("startTime").value;
  if (!rangeEnd) { s.textContent = `${fmtDay(rangeStart)} ${st}, velg sluttdag`; return; }
  const et = document.getElementById("endTime").value;
  s.textContent = `${fmtDay(rangeStart)} ${st} → ${fmtDay(rangeEnd)} ${et}`;
}

function buildTimeOptions() {
  const start = document.getElementById("startTime");
  const end = document.getElementById("endTime");
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const t = `${pad(h)}:${pad(m)}`;
      start.append(el("option", { value: t, text: t }));
      end.append(el("option", { value: t, text: t }));
    }
  }
}

function readRange() {
  const st = document.getElementById("startTime").value;
  const et = document.getElementById("endTime").value;
  const endDay = rangeEnd || rangeStart;
  return {
    start: parseLocalISO(`${dayKey(rangeStart)}T${st}:00`),
    end: parseLocalISO(`${dayKey(endDay)}T${et}:00`),
  };
}

function buildChips(containerId, values, isOn) {
  const box = document.getElementById(containerId);
  for (const v of values) {
    const chip = el("button", {
      type: "button",
      class: "chip",
      "data-val": v,
      "aria-pressed": String(isOn(v)),
      text: v,
    });
    chip.addEventListener("click", () => {
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
      updateFilterHint();
    });
    box.append(chip);
  }
}

function updateFilterHint() {
  const cats = pressedValues("categoryChips");
  const fuels = pressedValues("fuelChips");
  const dist = document.getElementById("maxdist");
  const parts = [];
  if (cats.length && cats.length < CATEGORIES.length) parts.push(`${cats.length} biltyper`);
  if (fuels.length && fuels.length < FUELS.length) parts.push(fuels.map((f) => f.toLowerCase()).join(", "));
  if (dist.value) parts.push(dist.selectedOptions[0].text);
  document.getElementById("filterHint").textContent = parts.length ? parts.join(" · ") : "";
}

function pressedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip[aria-pressed="true"]`)]
    .map((c) => c.getAttribute("data-val"));
}

function wireDurationToggle() {
  const hoursRow = document.getElementById("hoursRow");
  const sync = () => {
    const duration = document.querySelector('input[name="mode"]:checked').value === "duration";
    hoursRow.classList.toggle("is-disabled", !duration);
  };
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener("change", sync);
  }
  sync();
}

function readWish() {
  const place = selectedPlace();
  const { start: earliestStart, end: latestEnd } = readRange();
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const durationMinutes = mode === "duration" ? Number(document.getElementById("hours").value) * 60 : null;

  const categories = pressedValues("categoryChips");
  const fuels = pressedValues("fuelChips");
  const distVal = document.getElementById("maxdist").value;
  const excluded = CATEGORIES.filter((c) => !categories.includes(c));
  const filters = {
    excludeCategories: categories.length && excluded.length ? excluded : undefined,
    fuels: fuels.length && fuels.length < FUELS.length ? fuels : undefined,
    maxDistanceM: distVal ? Number(distVal) : REGION_CEILING_M,
  };
  return { point: place ? place.point : null, earliestStart, latestEnd, durationMinutes, filters };
}

function onSearch(e) {
  e.preventDefault();
  runSearch();
}

async function runSearch() {
  const results = document.getElementById("results");
  const wish = readWish();

  if (!wish.point) {
    results.replaceChildren(el("p", { class: "hint", text: "Velg posisjon først." }));
    document.getElementById("place").focus();
    return;
  }
  if (wish.latestEnd <= wish.earliestStart) {
    results.replaceChildren(el("p", { class: "hint", text: "Sluttiden må være etter starten." }));
    return;
  }
  results.replaceChildren(el("p", { class: "hint", text: "Søker…" }));

  let res;
  try {
    res = await api.runtime.sendMessage({
      type: "SEARCH",
      point: wish.point,
      start: toLocalISO(wish.earliestStart),
      end: toLocalISO(wish.latestEnd),
    });
  } catch (err) {
    renderError(results, null);
    return;
  }
  if (!res || res.error) {
    renderError(results, res && res.error);
    return;
  }
  render(results, solve(res.result, wish), wish, res.result);
}

function renderError(results, code) {
  // Manglende innlogging er den vanlige feilen: token bor i app.dele.no sin
  // localStorage, så vi trenger en fane der. Åpne den i en ufokusert
  // bakgrunnsfane og kjør søket på nytt automatisk når innloggingen er lest.
  if (code === "NOT_LOGGED_IN" || code === "AUTH_EXPIRED") {
    autoConnect(results);
    return;
  }
  if (code) console.warn("[finder] søk feilet:", code);
  results.replaceChildren(el("p", { class: "hint", text: searchErrorText(code) }));
}

async function autoConnect(results) {
  results.replaceChildren(el("p", { class: "hint", text: "Kobler til app.dele.no…" }));
  // Ikke lag duplikatfaner: åpne bare hvis ingen app.dele.no-fane finnes.
  const existing = await api.tabs.query({ url: "*://app.dele.no/*" }).catch(() => []);
  if (!existing.length) {
    await api.tabs.create({ url: "https://app.dele.no/", active: false });
  }
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const s = await api.runtime.sendMessage({ type: "GET_AUTH_STATUS" }).catch(() => null);
    if (s && s.hasAuth) {
      if (!stations.length) loadStations();
      runSearch();
      return;
    }
  }
  // Timeout: sannsynligvis faktisk ikke innlogget. Gi en fokusert vei inn.
  const box = el("div", { class: "hint hint--action" }, [
    el("p", { text: "Fant ingen innlogging. Logg inn på app.dele.no og trykk Søk igjen." }),
  ]);
  const btn = el("button", { type: "button", class: "car__open", text: "Gå til app.dele.no →" });
  btn.addEventListener("click", async () => {
    const tabs = await api.tabs.query({ url: "*://app.dele.no/*" }).catch(() => []);
    if (tabs.length) await api.tabs.update(tabs[0].id, { active: true });
    else await api.tabs.create({ url: "https://app.dele.no/", active: true });
  });
  box.append(btn);
  results.replaceChildren(box);
}

function fmtKm(m) {
  const km = m / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1).replace(".", ",");
}

function fmtDistance(m) {
  return m >= 1000 ? `${fmtKm(m)} km` : `${Math.round(m)} m`;
}

// Et "short"-treff er boss når den lengste ledige blokken dekker en bitteliten
// del av det du faktisk trenger (f.eks. 1t av et flerdøgnsvindu). Skjul disse
// bak «Vis alle» i stedet for å fylle bunnen med ubrukelige rader.
const WEAK_RATIO = 0.4;
function isWeak(f, wish) {
  if (f.kind !== "short") return false;
  const need = wish.durationMinutes ?? (wish.latestEnd - wish.earliestStart) / 60000;
  return f.bestBlockMinutes < need * WEAK_RATIO;
}

function render(container, out, wish, searchResult) {
  container.replaceChildren();
  bucket(container, "Ledig hele tidsrommet", out.whole, wish, "ok");

  const strong = out.adjusted.filter((f) => !isWeak(f, wish));
  const weak = out.adjusted.filter((f) => isWeak(f, wish));
  bucket(container, "Passer med justering", strong, wish, "adjust", weak);

  if (out.siblings.length) bucket(container, "Lignende bil i nærheten", out.siblings, wish, "sibling");

  // Sekundærsøk: ingen perfekt treff innen valgt radius → utvid til det dobbelte
  // og vis KUN perfekte treff i ringen utenfor (samme /api/search-data, mildere
  // distansefilter). Justerte treff langt unna er sjelden verdt det.
  let widerAdded = false;
  const primaryMax = wish.filters.maxDistanceM;
  if (!out.whole.length && primaryMax && primaryMax <= WIDEN_MAX_M) {
    const widerMax = primaryMax * 2;
    const widerWish = { ...wish, filters: { ...wish.filters, maxDistanceM: widerMax } };
    const widerOut = solve(searchResult, widerWish);
    const extra = widerOut.whole.filter((f) => (f.location.distance ?? Infinity) > primaryMax);
    if (extra.length) {
      bucket(container, `Litt lenger unna (${fmtKm(primaryMax)}–${fmtKm(widerMax)} km)`, extra, wish, "wider");
      widerAdded = true;
    }
  }

  if (!out.whole.length && wish.durationMinutes == null) {
    const pairs = splitPairs(searchResult, wish);
    if (pairs.length) renderSplits(container, pairs);
  }
  if (!out.whole.length && !out.adjusted.length && !out.siblings.length && !widerAdded) {
    container.append(el("p", { class: "hint",
      text: "Ingen biler passer. Prøv et lengre tidsrom, større gangavstand eller flere biltyper." }));
  }
}

function bucketTitle(title, count) {
  return el("h2", { class: "bucket__title" }, [
    el("span", { class: "bucket__dot" }),
    el("span", { text: title }),
    el("span", { class: "bucket__count", text: String(count) }),
  ]);
}

// `weak` (valgfri): svakere treff som skjules bak en «Vis alle»-knapp.
function bucket(container, title, fits, wish, variant, weak = []) {
  if (!fits.length && !weak.length) return;
  const box = el("section", { class: `bucket bucket--${variant}` }, [
    bucketTitle(title, fits.length + weak.length),
  ]);
  for (const f of fits) box.append(carCard(f, wish));
  if (weak.length) {
    const more = el("button", { type: "button", class: "more-btn",
      text: `Vis ${weak.length} med kort ledig tid` });
    more.addEventListener("click", () => {
      for (const f of weak) box.insertBefore(carCard(f, wish), more);
      more.remove();
    });
    box.append(more);
  }
  container.append(box);
}

function carCard(f, wish) {
  const card = el("div", { class: "car" });
  card.append(el("div", { class: "car__top" }, [
    el("div", { class: "car__title" }, [
      el("span", { class: "car__model", text: f.model }),
      el("span", { class: "car__num", text: `#${f.carNumber}` }),
    ]),
    el("span", { class: "car__price", text: `${f.hourlyRate} kr/t` }),
  ]));
  card.append(el("div", { class: "car__meta", text: `${f.location.name} · ${fmtDistance(f.location.distance)} unna` }));

  if (f.kind === "short") {
    const t = Math.round((f.bestBlockMinutes / 60) * 10) / 10;
    card.append(el("div", { class: "car__note", text: `Bare ledig ~${String(t).replace(".", ",")} t i strekk` }));
  }

  card.append(timeline(f, wish));

  const foot = el("div", { class: "car__foot" });
  if (f.proposed) {
    foot.append(el("span", { class: "car__window", text: fmtRange(f.proposed.start, f.proposed.end) }));
    // Rå colon i tidsstemplene: dele.no sin ruter tolker %3A som "Invalid date".
    const url = `https://app.dele.no/findcar?start=${toLocalISO(f.proposed.start)}&end=${toLocalISO(f.proposed.end)}`;
    const label = f.coversWholeWindow ? "Åpne i dele.no →" : "Åpne justert tid →";
    foot.append(el("a", { class: "car__open", href: url, target: "_blank", rel: "noopener",
      text: label, title: `Velg «${f.location.name}» i dele.no` }));
  }
  card.append(foot);
  return card;
}

function timeline(f, wish) {
  const wrap = el("div");
  const bar = el("div", { class: "timeline" });
  const span = wish.latestEnd - wish.earliestStart;
  const pct = (ms) => `${(ms / span) * 100}%`;
  for (const s of f.segments || []) {
    const label = `${STATE_LABEL[s.state] || s.state}: ${fmtRange(s.start, s.end)}`;
    const seg = el("div", {
      class: s.state === "AVAILABLE" ? "seg available" : "seg busy",
      style: `left:${pct(s.start - wish.earliestStart)};width:${pct(s.end - s.start)}`,
    });
    seg.addEventListener("mouseenter", () => showTip(seg, label));
    seg.addEventListener("mouseleave", hideTip);
    bar.append(seg);
  }
  if (f.proposed) {
    bar.append(el("div", { class: "marker",
      style: `left:${pct(f.proposed.start - wish.earliestStart)};width:${pct(f.proposed.end - f.proposed.start)}` }));
  }
  const sameDay = wish.earliestStart.toDateString() === wish.latestEnd.toDateString();
  wrap.append(bar);
  wrap.append(el("div", { class: "timeline__axis" }, [
    el("span", { text: `${fmtDay(wish.earliestStart)} ${fmtTime(wish.earliestStart)}` }),
    el("span", { text: sameDay ? fmtTime(wish.latestEnd) : `${fmtDay(wish.latestEnd)} ${fmtTime(wish.latestEnd)}` }),
  ]));
  return wrap;
}

function renderSplits(container, pairs) {
  const box = el("section", { class: "bucket bucket--split" }, [
    el("h2", { class: "bucket__title" }, [
      el("span", { class: "bucket__dot" }),
      el("span", { text: "Del opp på to biler" }),
      el("span", { class: "bucket__count", text: String(pairs.length) }),
    ]),
  ]);
  for (const p of pairs) {
    box.append(el("div", { class: "car" }, [
      el("div", { class: "split" }, [
        el("strong", { text: `#${p.first.carNumber} ${p.first.model}` }),
        el("span", { text: ` (${p.first.location.name}) ` }),
        el("span", { class: "swap", text: `→ bytt ${fmtDay(p.handover)} ${fmtTime(p.handover)} →` }),
        el("strong", { text: ` #${p.second.carNumber} ${p.second.model}` }),
        el("span", { text: ` (${p.second.location.name})` }),
      ]),
    ]));
  }
  container.append(box);
}

init();
