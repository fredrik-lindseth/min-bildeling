/**
 * Resolve a CSS custom property to its computed value.
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const defaultTooltip = {
  callbacks: {
    label: (ctx) => {
      const val = new Intl.NumberFormat("nb-NO").format(ctx.parsed.y);
      return ctx.dataset.label ? `${ctx.dataset.label}: ${val}` : val;
    },
  },
};

const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

/**
 * Tegner et diagram. Finnes det alt et av samme type på samme canvas, byttes
 * data og innstillinger og det tegnes på nytt uten animasjon. Ellers lages et
 * nytt, uten animasjon når animate er false eller brukeren har bedt om
 * redusert bevegelse. Under synk tegnes dashbordet opp hvert par sekunder, og
 * da skal ikke søylene vokse fra null hver gang.
 */
export function drawChart(existing, canvas, config, { animate = true } = {}) {
  const prepared = withMotionPreference(config, animate);
  if (existing && existing.canvas === canvas && existing.config.type === config.type) {
    existing.data = prepared.data;
    existing.options = prepared.options;
    existing.update("none");
    return existing;
  }
  existing?.destroy();
  return new Chart(canvas, prepared);
}

function withMotionPreference(config, animate = true) {
  if (animate && !reducedMotion?.matches) return config;
  return { ...config, options: { ...config.options, animation: false } };
}

export function barChartConfig(labels, data, label = "", { yTitle = "" } = {}) {
  const accent = cssVar("--color-accent");
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: accent }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: defaultTooltip,
      },
      scales: {
        x: { ticks: { maxTicksLimit: 14, maxRotation: 45, font: { size: 11 } } },
        y: {
          title: yTitle ? { display: true, text: yTitle, font: { size: 12 } } : { display: false },
        },
      },
    },
  };
}

export function lineChartConfig(labels, data, label = "", { yTitle = "" } = {}) {
  const accent = cssVar("--color-accent");
  return {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: accent,
        tension: 0.3,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: defaultTooltip,
      },
      scales: {
        x: { ticks: { maxTicksLimit: 14, maxRotation: 45, font: { size: 11 } } },
        y: {
          title: yTitle ? { display: true, text: yTitle, font: { size: 12 } } : { display: false },
        },
      },
    },
  };
}

/**
 * Søyler per måned med beløpet skrevet over hver søyle, så tallene kan leses
 * uten hover. Ingen glatting: hver søyle er én måneds faktiske sum.
 */
export function createMonthBars(canvas, labels, data, formatValue) {
  const accent = cssVar("--color-accent");
  const textColor = cssVar("--color-text-secondary");
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `11px ${getComputedStyle(document.body).fontFamily}`;
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
  return new Chart(canvas, withMotionPreference({
    type: "bar",
    data: {
      labels,
      datasets: [{ data, backgroundColor: accent }],
    },
    options: {
      responsive: true,
      aspectRatio: 2.5,
      layout: { padding: { top: 16 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
        y: { display: false, beginAtZero: true },
      },
    },
    plugins: [valueLabels],
  }));
}
