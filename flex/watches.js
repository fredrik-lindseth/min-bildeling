import { parseBackendUrl, originPatternFor } from "./lib/relay.js";

const api = typeof browser !== "undefined" ? browser : chrome;

// Adressen som er lagret nå, så en gammel tilgang kan trekkes tilbake ved bytte.
let savedBackendUrl = "";

function showMsg(text, isError = false) {
  const el = document.getElementById("set-msg");
  el.textContent = text;
  el.classList.toggle("err", isError);
}

function fmtDT(iso) {
  // naiv lokal ISO uten Z → new Date tolker som lokal veggklokke.
  return new Date(iso).toLocaleString("nb-NO", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtWindow(w) {
  return `${fmtDT(w.earliestStart)} – ${fmtDT(w.latestEnd)}`;
}

function status(w) {
  // latestEnd er naiv lokal ISO uten Z → new Date() tolker den som lokal tid.
  if (new Date(w.latestEnd) <= new Date()) return " · utløpt";
  return "";
}

function fmtTime(iso) {
  // lastChecked lagres som UTC (toISOString) → vis lokal veggklokke.
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

async function render() {
  const { watches, settings } = await api.runtime.sendMessage({ type: "GET_WATCHES" });
  const ul = document.getElementById("watch-list");
  ul.innerHTML = "";
  if (!watches.length) {
    ul.innerHTML = "<li>Ingen overvåkninger. Lag en med «Overvåk dette søket» i Fleksibelt søk.</li>";
  }
  for (const w of watches) {
    const li = document.createElement("li");
    const checked = w.active ? "checked" : "";
    li.innerHTML =
      `<strong>${w.label}</strong>${status(w)}<br>` +
      `<span class="muted">${fmtWindow(w)} · minst ${w.minHours} t` +
      (w.lastChecked ? ` · sjekket ${fmtTime(w.lastChecked)}` : " · ikke sjekket") + `</span> ` +
      `<label><input type="checkbox" data-toggle="${w.id}" ${checked}> aktiv</label> ` +
      `<button data-del="${w.id}">Slett</button>`;
    ul.appendChild(li);
  }
  document.getElementById("set-url").value = settings.backendUrl || "";
  document.getElementById("set-token").value = settings.backendToken || "";
  document.getElementById("set-poll").value = settings.pollMinutes || 15;
  savedBackendUrl = settings.backendUrl || "";

  // En reinstallert utvidelse kan ha adressen i storage, men ha mistet tilgangen.
  const pattern = originPatternFor(savedBackendUrl);
  if (pattern && !(await api.permissions.contains({ origins: [pattern] }))) {
    showMsg("Mangler tilgang til backend-URL-en. Trykk Lagre.", true);
  }
}

document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { await api.runtime.sendMessage({ type: "DELETE_WATCH", id: del.dataset.del }); render(); return; }
  if (e.target.id === "poll-now") { await api.runtime.sendMessage({ type: "POLL_NOW" }); render(); }
});

document.addEventListener("change", async (e) => {
  const t = e.target.closest("[data-toggle]");
  if (t) { await api.runtime.sendMessage({ type: "TOGGLE_WATCH", id: t.dataset.toggle }); render(); }
});

document.getElementById("set-save").addEventListener("click", () => {
  let backend;
  try {
    backend = parseBackendUrl(document.getElementById("set-url").value);
  } catch (err) {
    showMsg(err.message, true);
    return;
  }
  // Firefox godtar bare permissions.request direkte fra brukerhandlingen, så
  // kallet må skje før første await i håndteren.
  const granted = backend.originPattern
    ? api.permissions.request({ origins: [backend.originPattern] })
    : Promise.resolve(true);
  granted.then(async (ok) => {
    if (!ok) {
      showMsg("Tilgang avslått. Ingenting er lagret.", true);
      return;
    }
    const oldPattern = originPatternFor(savedBackendUrl);
    await api.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: {
      backendUrl: backend.url,
      backendToken: document.getElementById("set-token").value.trim(),
      pollMinutes: Number(document.getElementById("set-poll").value) || 15,
    }});
    if (oldPattern && oldPattern !== backend.originPattern) {
      await api.permissions.remove({ origins: [oldPattern] });
    }
    savedBackendUrl = backend.url;
    document.getElementById("set-url").value = backend.url;
    showMsg("Lagret.");
  }).catch((err) => {
    console.warn("[watches] lagring feilet:", err);
    showMsg("Kunne ikke lagre. Prøv igjen.", true);
  });
});

render();
