// «Slik beregnes det» i alle flatene: dashboard, popup og årsoppsummering.
//
// En metode er rene data fra lib-modulen som regner (co2.js, transport.js,
// ownership-cost.js, stats.js):
//
//   {
//     intro: "Én setning om hva som regnes.",
//     factors: [{ label, value, unit, note?, source? }],
//     notes: ["Forbehold som gjelder hele metoden."],
//     sources: { nøkkel: { name, url?, date?, dateLabel? } },
//   }
//
// value er et tall eller [lav, høy]. source er en nøkkel i sources eller en
// liste med nøkler. date er "ÅÅÅÅ-MM-DD" eller "ÅÅÅÅ-MM".
//
// methodModel() gjør metoden om til det som vises, uten DOM, så testene kan
// sjekke den. renderMethodPanel() bygger DOM-en med textContent, aldri
// innerHTML med data.

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
  "august", "september", "oktober", "november", "desember"];

const formatNumber = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 });

export function formatFactorValue(value, unit) {
  const number = Array.isArray(value)
    ? (value[0] === value[1] ? formatNumber.format(value[0]) : `${formatNumber.format(value[0])}–${formatNumber.format(value[1])}`)
    : formatNumber.format(value);
  return unit ? `${number} ${unit}` : number;
}

export function formatSourceDate(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!d) return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${d}.${m}.${y}`;
}

const asList = (source) => (source == null ? [] : [].concat(source));

/**
 * Det panelet viser: rader med ferdig formaterte verdier, fotnoter med
 * bokstav og kilder med nummer. Kildene nummereres i den rekkefølgen
 * tabellen først viser til dem, og like merknader får samme bokstav.
 */
export function methodModel(method) {
  const sourceOrder = [];
  const noteOrder = [];
  const rows = (method.factors ?? []).map((f) => {
    const sourceKeys = asList(f.source);
    for (const key of sourceKeys) {
      if (!method.sources?.[key]) throw new Error(`Ukjent kilde «${key}» for «${f.label}»`);
      if (!sourceOrder.includes(key)) sourceOrder.push(key);
    }
    if (f.note && !noteOrder.includes(f.note)) noteOrder.push(f.note);
    return {
      label: f.label,
      value: formatFactorValue(f.value, f.unit),
      noteMark: f.note ? letter(noteOrder.indexOf(f.note)) : null,
      sources: sourceKeys.map((key) => sourceOrder.indexOf(key) + 1),
    };
  });
  return {
    intro: method.intro,
    rows,
    notes: [
      ...noteOrder.map((text, i) => ({ mark: letter(i), text })),
      ...(method.notes ?? []).map((text) => ({ mark: null, text })),
    ],
    sources: sourceOrder.map((key, i) => {
      const s = method.sources[key];
      const date = formatSourceDate(s.date);
      return {
        number: i + 1,
        name: s.name,
        url: s.url ?? null,
        // En kilde uten kjent dato sier det, framfor å stå som om den var ny.
        date: date ? (s.dateLabel ? `${s.dateLabel} ${date}` : date) : "udatert",
      };
    }),
  };
}

/** All tekst panelet viser, til tester som leter etter ord som ikke skal stå der. */
export function methodText(method) {
  const m = methodModel(method);
  return [m.intro, ...m.rows.map((r) => `${r.label} ${r.value}`), ...m.notes.map((n) => n.text),
    ...m.sources.map((s) => `${s.name} ${s.date}`)].join("\n");
}

function letter(i) {
  return String.fromCharCode(97 + i);
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Fyller container med panelet. idPrefix må være unikt på siden, siden
 * fotnotelenkene peker på id-er under det. heading gir panelet en egen
 * overskrift på nivået headingLevel, når flere paneler står etter hverandre.
 */
export function renderMethodPanel(container, method, { idPrefix, heading, headingLevel = 3 } = {}) {
  const doc = container.ownerDocument;
  const model = methodModel(method);
  const sourceId = (n) => `${idPrefix}-kilde-${n}`;
  const noteId = (mark) => `${idPrefix}-merknad-${mark}`;
  const parts = [];

  if (heading) parts.push(el(doc, `h${headingLevel}`, "method-panel__heading", heading));
  parts.push(el(doc, "p", "method-panel__intro", model.intro));

  if (model.rows.length > 0) {
    const table = el(doc, "table", "method-panel__table");
    table.appendChild(el(doc, "caption", "method-panel__caption", "Forutsetninger"));
    const headRow = el(doc, "tr");
    for (const [text, cls] of [["Hva", ""], ["Verdi", "method-panel__value"], ["Kilde", "method-panel__source"]]) {
      const th = el(doc, "th", cls, text);
      th.scope = "col";
      headRow.appendChild(th);
    }
    table.appendChild(el(doc, "thead")).appendChild(headRow);

    const body = el(doc, "tbody");
    for (const row of model.rows) {
      const tr = el(doc, "tr");
      const label = el(doc, "th", "method-panel__label", row.label);
      label.scope = "row";
      if (row.noteMark) label.append(" ", footnoteLink(doc, noteId(row.noteMark), row.noteMark, `merknad ${row.noteMark}`));
      tr.appendChild(label);
      tr.appendChild(el(doc, "td", "method-panel__value", row.value));
      const source = el(doc, "td", "method-panel__source");
      if (row.sources.length === 0) {
        source.textContent = "–";
        source.setAttribute("aria-label", "ingen kilde");
      }
      row.sources.forEach((n, i) => {
        if (i > 0) source.append(", ");
        source.appendChild(footnoteLink(doc, sourceId(n), String(n), `kilde ${n}`));
      });
      tr.appendChild(source);
      body.appendChild(tr);
    }
    table.appendChild(body);
    parts.push(table);
  }

  if (model.notes.length > 0) {
    // Med fotnotetegn står tegnet i en egen kolonne, så teksten i alle
    // merknadene starter på samme linje, med eller uten tegn.
    const marked = model.notes.some((n) => n.mark);
    const list = el(doc, "ul", marked ? "method-panel__notes method-panel__notes--marked" : "method-panel__notes");
    for (const note of model.notes) {
      const li = el(doc, "li");
      if (marked) {
        const mark = el(doc, "span", "method-panel__mark", note.mark ?? "");
        if (note.mark) li.id = noteId(note.mark);
        else mark.setAttribute("aria-hidden", "true");
        li.append(mark, el(doc, "span", null, note.text));
      } else {
        li.textContent = note.text;
      }
      list.appendChild(li);
    }
    parts.push(list);
  }

  if (model.sources.length > 0) {
    parts.push(el(doc, "p", "method-panel__sources-title", "Kilder"));
    const list = el(doc, "ol", "method-panel__sources");
    for (const s of model.sources) {
      const li = el(doc, "li");
      li.id = sourceId(s.number);
      if (s.url) {
        const a = el(doc, "a", null, s.name);
        a.href = s.url;
        // Ny fane, så siden med tallene blir stående.
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.appendChild(a);
      } else {
        li.append(s.name);
      }
      if (s.date) li.append(`, ${s.date}`);
      list.appendChild(li);
    }
    parts.push(list);
  }

  const panel = el(doc, "div", "method-panel");
  panel.append(...parts);
  container.replaceChildren(panel);
}

function footnoteLink(doc, targetId, text, label) {
  const sup = el(doc, "sup", "method-panel__ref");
  const a = el(doc, "a", null, text);
  a.href = `#${targetId}`;
  a.setAttribute("aria-label", label);
  sup.appendChild(a);
  return sup;
}
