// Helper to extract price from reservation
function getPrice(r) {
  return r.price?.total ?? null;
}

// Helper to extract car name
function getCarName(r) {
  return r.car?.model || r.car?.licensePlate || "Ukjent";
}

// Not canceled and has a price. Includes noTrips (user still paid)
export function filterValid(reservations) {
  return reservations.filter(
    (r) => r.canceled == null && getPrice(r) != null
  );
}

// Actually drove, for usage patterns and mileage
export function filterDriven(reservations) {
  return filterValid(reservations).filter((r) => !r.noTrips);
}

export function costStats(reservations) {
  const valid = filterValid(reservations);
  if (valid.length === 0) return null;

  const costs = valid.map((r) => getPrice(r));
  costs.sort((a, b) => a - b);

  // Min excludes 0 kr trips (free/no-show), find first cost > 0
  const nonZeroCosts = costs.filter((c) => c > 0);

  return {
    total: costs.reduce((sum, c) => sum + c, 0),
    average: costs.reduce((sum, c) => sum + c, 0) / costs.length,
    median: costs[Math.floor(costs.length / 2)],
    min: nonZeroCosts.length > 0 ? nonZeroCosts[0] : 0,
    max: costs[costs.length - 1],
    count: costs.length,
  };
}

export function monthlyCosts(reservations) {
  const valid = filterValid(reservations);
  const byMonth = {};

  for (const r of valid) {
    const date = new Date(r.start);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + getPrice(r);
  }

  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

export function yearlyCosts(reservations) {
  const valid = filterValid(reservations);
  const byYear = {};

  for (const r of valid) {
    const year = new Date(r.start).getFullYear();
    byYear[year] = (byYear[year] || 0) + getPrice(r);
  }

  return Object.entries(byYear)
    .sort(([a], [b]) => a - b)
    .map(([year, total]) => ({ year: Number(year), total }));
}

// Årene årsvalget i Kostnader tilbyr, stigende.
export function costYears(reservations) {
  const years = new Set(filterValid(reservations).map((r) => new Date(r.start).getFullYear()));
  return [...years].sort((a, b) => a - b);
}

// Valget brukeren har gjort står så lenge året finnes i dataene. Under synk
// tegnes siden opp på nytt hvert par sekunder, og da skal valget ikke hoppe
// tilbake til «Alle år».
export function keepSelectedYear(selected, years) {
  if (selected === "all") return "all";
  return years.includes(Number(selected)) ? String(selected) : "all";
}

export function usagePatterns(reservations) {
  const valid = filterDriven(reservations);

  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of valid) {
    const date = new Date(r.start);
    heatmap[date.getDay()][date.getHours()]++;
  }

  const carCounts = {};
  for (const r of valid) {
    const car = getCarName(r);
    carCounts[car] = (carCounts[car] || 0) + 1;
  }
  const topCars = Object.entries(carCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));

  const durations = valid.map(
    (r) => (new Date(r.end) - new Date(r.start)) / 3600000
  );
  const avgDuration =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

  const tripsPerMonth = {};
  for (const r of valid) {
    const date = new Date(r.start);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    tripsPerMonth[key] = (tripsPerMonth[key] || 0) + 1;
  }

  return { heatmap, topCars, avgDuration, tripsPerMonth };
}

export function mileageStats(reservations) {
  const withKm = filterDriven(reservations).filter(
    (r) => r.drivenKm != null && r.drivenKm > 0
  );
  if (withKm.length === 0) return null;

  const distances = withKm.map((r) => r.drivenKm);
  const total = distances.reduce((sum, d) => sum + d, 0);

  const byMonth = {};
  for (const r of withKm) {
    const date = new Date(r.start);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + r.drivenKm;
  }

  const byCar = {};
  for (const r of withKm) {
    const car = getCarName(r);
    byCar[car] = (byCar[car] || 0) + r.drivenKm;
  }

  return {
    total,
    average: total / withKm.length,
    max: Math.max(...distances),
    count: withKm.length,
    byMonth: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)),
    byCar: Object.entries(byCar).sort(([, a], [, b]) => b - a),
  };
}

// Lead time = millisekunder mellom created og start. En etikett «a–b dager»
// gjelder hele dager, så dag b er med helt til dag b + 1 begynner. Bøttene er
// halvåpne [min, max) i timer: 14 dager og 23 timer er «8–14 dager», 15 dager
// er «15–30 dager».
const HOURS_PER_DAY = 24;
const LEAD_TIME_BUCKETS = [
  { label: "<24 t",       minDays: 0,  maxDays: 1 },
  { label: "1 dag",       minDays: 1,  maxDays: 2 },
  { label: "2–3 dager",   minDays: 2,  maxDays: 4 },
  { label: "4–7 dager",   minDays: 4,  maxDays: 8 },
  { label: "8–14 dager",  minDays: 8,  maxDays: 15 },
  { label: "15–30 dager", minDays: 15, maxDays: 31 },
  { label: "31+ dager",   minDays: 31, maxDays: Infinity },
].map(({ label, minDays, maxDays }) => ({
  label,
  minHours: minDays * HOURS_PER_DAY,
  maxHours: maxDays * HOURS_PER_DAY,
}));

function getStationName(r) {
  return r.location?.name || "Ukjent stasjon";
}

export function bookingPatterns(reservations) {
  // Bruker filterValid for å se faktisk bookingatferd, inkluderer noTrips.
  // Krever created, eldre reservasjoner kan mangle feltet.
  const valid = filterValid(reservations).filter((r) => r.created != null);
  if (valid.length === 0) return null;

  const leadHours = valid.map(
    (r) => (new Date(r.start) - new Date(r.created)) / 3600000
  );

  // Negative lead times betyr at bookingen ble opprettet etter starttid
  // (rettelser eller spontan-bruk). Behandler dem som 0 t.
  const cleaned = leadHours.map((h) => Math.max(0, h));
  const sorted = [...cleaned].sort((a, b) => a - b);

  const avgHours = cleaned.reduce((sum, h) => sum + h, 0) / cleaned.length;
  const medianHours = sorted[Math.floor(sorted.length / 2)];

  const extremes = leadExtremes(valid, leadHours);

  const shortNoticeCount = cleaned.filter((h) => h < 24).length;
  const shortNoticeShare = shortNoticeCount / cleaned.length;

  // Fordeling
  const distribution = LEAD_TIME_BUCKETS.map((b) => ({
    label: b.label,
    count: cleaned.filter((h) => h >= b.minHours && h < b.maxHours).length,
  }));

  // Topp stasjoner
  const stationCounts = {};
  for (const r of valid) {
    const name = getStationName(r);
    stationCounts[name] = (stationCounts[name] || 0) + 1;
  }
  const stationsRanked = Object.entries(stationCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    count: cleaned.length,
    avgDays: avgHours / 24,
    medianDays: medianHours / 24,
    shortNoticeShare,
    uniqueStations: stationsRanked.length,
    distribution,
    stationsRanked,
    extremes,
  };
}

// Lengste og korteste bookingtid, med turen de hører til. Rå bookingtid
// sammenlignes, og visningen klampes til 0 som i histogrammet. Ved likt
// vinner den første. Med under to bookinger er det ingen ytterpunkter å vise.
function leadExtremes(valid, leadHours) {
  if (valid.length < 2) return null;
  let longest = 0;
  let shortest = 0;
  for (let i = 1; i < leadHours.length; i++) {
    if (leadHours[i] > leadHours[longest]) longest = i;
    if (leadHours[i] < leadHours[shortest]) shortest = i;
  }
  const describe = (i) => ({
    leadHours: Math.max(0, leadHours[i]),
    carModel: getCarName(valid[i]),
    start: valid[i].start,
    station: getStationName(valid[i]),
  });
  return { longest: describe(longest), shortest: describe(shortest) };
}

export function currentMonthStats(reservations) {
  const now = new Date();
  const thisMonth = reservations.filter((r) => {
    const d = new Date(r.start);
    return (
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  });
  const lastMonth = reservations.filter((r) => {
    const d = new Date(r.start);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return (
      d.getMonth() === prev.getMonth() &&
      d.getFullYear() === prev.getFullYear()
    );
  });

  return {
    thisMonth: costStats(thisMonth),
    lastMonth: costStats(lastMonth),
    tripsThisMonth: filterValid(thisMonth).length,
  };
}
