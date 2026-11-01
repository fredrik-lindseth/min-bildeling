/**
 * Chart.js-oppsett for dashboard og popup. Fargene kommer fra tokens.css.
 * Tokenene er skrevet med light-dark(), og getPropertyValue() gir da tilbake
 * selve light-dark(...)-teksten, som Chart.js ikke kan tegne. resolveColor()
 * løser verdien gjennom et skjult måleelement i stedet, så svaret er en
 * ferdig farge for modusen som gjelder akkurat nå.
 */

let probe = null;

/**
 * En ferdig beregnet farge for en CSS-verdi, for eksempel
 * "var(--color-chart-1)" eller "color-mix(in srgb, var(--color-accent) 40%,
 * var(--color-sunken))". Et tokennavn alene ("--color-text") går også.
 */
export function resolveColor(value) {
  if (!probe) {
    probe = document.createElement("span");
    probe.hidden = true;
    document.body.appendChild(probe);
  }
  probe.style.color = value.startsWith("--") ? `var(${value})` : value;
  return getComputedStyle(probe).color;
}

// Chart.js formaterer akser og tooltips med nettleserens språk, som kan være
// engelsk selv om resten av siden er norsk.
Chart.defaults.locale = "nb-NO";

/**
 * Setter fellesvalgene som følger tokenene: tekst, rutenett, font og tooltip.
 * Kalles ved oppstart og på nytt når fargemodusen endres.
 */
export function applyChartTheme() {
  const font = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.family = font;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = resolveColor("--color-text-tertiary");
  Chart.defaults.borderColor = resolveColor("--color-grid");
  // Diagrammene tegnes ferdige. Ingen vekst fra null, heller ikke ved første lasting.
  Chart.defaults.animation = false;

  const tooltip = Chart.defaults.plugins.tooltip;
  tooltip.backgroundColor = resolveColor("--color-surface");
  tooltip.borderColor = resolveColor("--color-border");
  tooltip.borderWidth = 1;
  tooltip.cornerRadius = 2;
  tooltip.titleColor = resolveColor("--color-text");
  tooltip.bodyColor = resolveColor("--color-text");
  tooltip.titleFont = { weight: "600" };
  tooltip.padding = 8;
  tooltip.boxPadding = 4;
}

/**
 * Akseoppsett etter designet: bare horisontale rutenettlinjer, x-aksen i
 * border-strong, aksetekst i tertiary.
 */
export function axes({ yTitle = "", horizontal = false } = {}) {
  const valueAxis = {
    beginAtZero: true,
    grid: { color: resolveColor("--color-grid") },
    border: { display: false },
    ticks: { maxRotation: 0 },
    title: yTitle ? { display: true, text: yTitle } : { display: false },
  };
  const categoryAxis = {
    grid: { display: false },
    border: { color: resolveColor("--color-border-strong") },
    ticks: { maxTicksLimit: 14, maxRotation: 0, autoSkipPadding: 4 },
  };
  if (horizontal) {
    return {
      x: { ...valueAxis, ticks: { maxRotation: 0, maxTicksLimit: 6 } },
      y: { ...categoryAxis, ticks: { autoSkip: false } },
    };
  }
  return { x: categoryAxis, y: valueAxis };
}

const defaultTooltip = {
  callbacks: {
    label: (ctx) => {
      const val = new Intl.NumberFormat("nb-NO").format(ctx.parsed.y);
      return ctx.dataset.label ? `${ctx.dataset.label}: ${val}` : val;
    },
  },
};

/**
 * Tegner et diagram. Finnes det alt et av samme type på samme canvas, byttes
 * data og innstillinger og det tegnes på nytt. Ellers lages et nytt.
 */
export function drawChart(existing, canvas, config) {
  if (existing && existing.canvas === canvas && existing.config.type === config.type) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update("none");
    return existing;
  }
  existing?.destroy();
  return new Chart(canvas, config);
}

export function barChartConfig(labels, data, label = "", { yTitle = "" } = {}) {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: resolveColor("--color-chart-1"), borderRadius: 0 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: defaultTooltip,
      },
      scales: axes({ yTitle }),
    },
  };
}

export function lineChartConfig(labels, data, label = "", { yTitle = "" } = {}) {
  return {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: resolveColor("--color-chart-1"),
        backgroundColor: resolveColor("--color-chart-1"),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        // Rette linjestykker. En glattet kurve finner opp verdier mellom
        // månedene og kan gå under null eller over det høyeste punktet.
        tension: 0,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: defaultTooltip,
      },
      scales: axes({ yTitle }),
    },
  };
}

/**
 * Søyler per måned med beløpet skrevet over hver søyle, så tallene kan leses
 * uten hover. Ingen glatting: hver søyle er én måneds faktiske sum.
 */
export function createMonthBars(canvas, labels, data, formatValue) {
  const textColor = resolveColor("--color-text-secondary");
  const font = getComputedStyle(document.body).fontFamily;
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `12px ${font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        ctx.fillText(formatValue(data[i]), bar.x, bar.y - 2);
      });
      ctx.restore();
    },
  };
  // Etikett-pluginen holder på data fra denne opptegningen, så popupen lager
  // et nytt diagram hver gang i stedet for å bruke drawChart.
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data, backgroundColor: resolveColor("--color-chart-1"), borderRadius: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 18 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: resolveColor("--color-border-strong") },
          ticks: { color: resolveColor("--color-text-tertiary"), font: { size: 12, family: font } },
        },
        y: { display: false, beginAtZero: true },
      },
    },
    plugins: [valueLabels],
  });
}

/**
 * Kaller fn når systemet bytter mellom lys og mørk modus, så diagrammene kan
 * tegnes på nytt med fargene for den nye modusen.
 */
export function onColorSchemeChange(fn) {
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", fn);
}
