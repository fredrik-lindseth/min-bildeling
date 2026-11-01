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

export function createBarChart(canvas, labels, data, label = "", { unit = "", yTitle = "" } = {}) {
  const accent = cssVar("--color-accent");
  return new Chart(canvas, {
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
  });
}

export function createLineChart(canvas, labels, data, label = "", { unit = "", yTitle = "" } = {}) {
  const accent = cssVar("--color-accent");
  return new Chart(canvas, {
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
  });
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
  return new Chart(canvas, {
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
  });
}
