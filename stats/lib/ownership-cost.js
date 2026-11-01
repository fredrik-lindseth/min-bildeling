import { filterDriven } from "./stats.js";

// Annual fixed costs (NOK) by car category
// Sources: NAF Bilkostnadsindeks, OFV Kjøretøystatistikk
// Context: 75% av Bildeleringen-medlemmer har IKKE egen bil (TØI 1895/2022)
//          49% har latt være å kjøpe bil pga. bildeling
//          Hver delebil erstatter 10-15 privatbiler i Bergen
const CATEGORY_COSTS = {
  Småbil: { depreciation: 25000, insurance: 8000, tax: 3000, maintenance: 6000, parking: 12000 },
  Minibil: { depreciation: 22000, insurance: 7500, tax: 2800, maintenance: 5500, parking: 12000 },
  Kombi: { depreciation: 30000, insurance: 9000, tax: 3200, maintenance: 7000, parking: 12000 },
  Stasjonsvogn: { depreciation: 32000, insurance: 9500, tax: 3500, maintenance: 7500, parking: 12000 },
  SUV: { depreciation: 40000, insurance: 11000, tax: 4000, maintenance: 8500, parking: 12000 },
  Varebil: { depreciation: 35000, insurance: 10000, tax: 3800, maintenance: 8000, parking: 12000 },
};

// Tekst og kilder til «Slik beregner vi» ved eierkostnad og sparetall.
export const OWNERSHIP_METHOD = {
  note: "Eierkostnaden er snittall for bilkategorien du bruker mest: verditap, " +
    "forsikring, årsavgift, vedlikehold, parkering og drivstoff for kilometerne du kjørte. " +
    "Bildeling er det du faktisk har betalt.",
  sources: [
    "NAF: Bilkostnadsindeks",
    "OFV: Kjøretøystatistikk",
  ],
};

// Fuel cost per km (NOK)
const FUEL_COST_PER_KM = {
  Bensin: 1.2,
  Diesel: 1.0,
  Elektrisitet: 0.3,
};

// Specific reference car: Volvo EX C40 2026 (electric)
// Nypris ~470 000 kr, verditap ~15%/år første 3 år
const VOLVO_EXC40 = {
  name: "Volvo EX C40 2026",
  costs: {
    depreciation: 70000,  // ~15% av 470k
    insurance: 12000,
    tax: 0,               // elbil, fritak
    maintenance: 4000,    // lavere enn ICE
    parking: 12000,
  },
  fuelCostPerKm: 0.25,   // strøm, ~2 kWh/mil × 1.25 kr/kWh
  co2PerKm: 0,           // null utslipp fra kjøring
};

/**
 * Extract fuel type from a car object's properties array.
 * Returns "Bensin" as default if not found.
 */
export function getFuelType(car) {
  const prop = car?.properties?.find((p) => p.groupKey === "FUEL_TYPE");
  return prop?.name || "Bensin";
}

/**
 * Count trips per category from driven reservations, return the most common category.
 */
export function getMostUsedCategory(reservations) {
  const driven = filterDriven(reservations);
  if (driven.length === 0) return null;

  const counts = {};
  for (const r of driven) {
    const cat = r.car?.category || "Ukjent";
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return Object.entries(counts).sort(([, a], [, b]) => b - a)[0][0];
}

/**
 * Count trips per fuel type from driven reservations, return the most common fuel type.
 */
export function getMostUsedFuelType(reservations) {
  const driven = filterDriven(reservations);
  if (driven.length === 0) return null;

  const counts = {};
  for (const r of driven) {
    const fuel = getFuelType(r.car);
    counts[fuel] = (counts[fuel] || 0) + 1;
  }

  return Object.entries(counts).sort(([, a], [, b]) => b - a)[0][0];
}

/**
 * Estimate the cost of owning a comparable car vs. actual car-sharing spend.
 *
 * @param {Array} reservations - All reservation objects
 * @param {number|null} year - Specific year to analyze, or null for all data (annualized)
 * @returns {Object|null} Cost comparison object, or null if no data
 */
export function estimateOwnershipCost(reservations, year = null) {
  const driven = filterDriven(reservations);
  if (driven.length === 0) return null;

  const category = getMostUsedCategory(reservations);
  const fuelType = getMostUsedFuelType(reservations);

  // Filter to specific year if provided
  const filtered = year
    ? driven.filter((r) => new Date(r.start).getFullYear() === year)
    : driven;

  if (filtered.length === 0) return null;

  // Sharing cost = sum of price.total
  const sharingCostRaw = filtered.reduce((sum, r) => sum + (r.price?.total ?? 0), 0);

  // Total km driven
  const totalKmRaw = filtered.reduce((sum, r) => sum + (r.drivenKm ?? 0), 0);

  // Fixed ownership cost components
  const categoryCosts = CATEGORY_COSTS[category] || CATEGORY_COSTS.Småbil;
  const fixedCostPerYear =
    categoryCosts.depreciation +
    categoryCosts.insurance +
    categoryCosts.tax +
    categoryCosts.maintenance +
    categoryCosts.parking;

  // Fuel cost per km for most used fuel type
  const fuelCostPerKm = FUEL_COST_PER_KM[fuelType] ?? FUEL_COST_PER_KM.Bensin;

  let sharingCost;
  let totalKm;
  let ownershipFixed;
  let ownershipFuel;

  if (year) {
    // Use the year's data directly (already represents one year)
    sharingCost = sharingCostRaw;
    totalKm = totalKmRaw;
    ownershipFixed = fixedCostPerYear;
    ownershipFuel = totalKm * fuelCostPerKm;
  } else {
    // Annualize: find date range and scale to a full year
    const dates = filtered.map((r) => new Date(r.start).getTime());
    const earliest = Math.min(...dates);
    const latest = Math.max(...dates);
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const rangeInYears = (latest - earliest) / msPerYear;

    // If all trips are on the same day, treat as a fraction based on 1 day
    const effectiveYears = rangeInYears > 0 ? rangeInYears : 1 / 365.25;

    sharingCost = Math.round(sharingCostRaw / effectiveYears);
    totalKm = Math.round(totalKmRaw / effectiveYears);
    ownershipFixed = fixedCostPerYear;
    ownershipFuel = totalKm * fuelCostPerKm;
  }

  const ownershipCost = Math.round(ownershipFixed + ownershipFuel);
  sharingCost = Math.round(sharingCost);
  const savings = ownershipCost - sharingCost;
  const savingsPercent =
    ownershipCost > 0 ? Math.round((savings / ownershipCost) * 10000) / 100 : 0;

  return {
    sharingCost,
    ownershipCost,
    savings,
    savingsPercent,
    category,
    fuelType,
    totalKm,
    period: year || "year",
    breakdownOwnership: {
      depreciation: categoryCosts.depreciation,
      insurance: categoryCosts.insurance,
      tax: categoryCosts.tax,
      maintenance: categoryCosts.maintenance,
      parking: categoryCosts.parking,
      fuel: Math.round(ownershipFuel),
    },
    breakdownSharing: {
      total: sharingCost,
    },
  };
}

/**
 * Compare car-sharing cost against owning a Volvo EX C40 2026 specifically.
 */
export function estimateVolvoComparison(reservations, year = null) {
  const driven = filterDriven(reservations);
  if (driven.length === 0) return null;

  const filtered = year
    ? driven.filter((r) => new Date(r.start).getFullYear() === year)
    : driven;

  if (filtered.length === 0) return null;

  const sharingCostRaw = filtered.reduce((sum, r) => sum + (r.price?.total ?? 0), 0);
  const totalKmRaw = filtered.reduce((sum, r) => sum + (r.drivenKm ?? 0), 0);

  const v = VOLVO_EXC40;
  const fixedCostPerYear =
    v.costs.depreciation + v.costs.insurance + v.costs.tax + v.costs.maintenance + v.costs.parking;

  let sharingCost, totalKm, ownershipFuel;

  if (year) {
    sharingCost = sharingCostRaw;
    totalKm = totalKmRaw;
    ownershipFuel = totalKm * v.fuelCostPerKm;
  } else {
    const dates = filtered.map((r) => new Date(r.start).getTime());
    const earliest = Math.min(...dates);
    const latest = Math.max(...dates);
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const rangeInYears = (latest - earliest) / msPerYear;
    const effectiveYears = rangeInYears > 0 ? rangeInYears : 1 / 365.25;

    sharingCost = Math.round(sharingCostRaw / effectiveYears);
    totalKm = Math.round(totalKmRaw / effectiveYears);
    ownershipFuel = totalKm * v.fuelCostPerKm;
  }

  const ownershipCost = Math.round(fixedCostPerYear + ownershipFuel);
  sharingCost = Math.round(sharingCost);
  const savings = ownershipCost - sharingCost;
  const savingsPercent =
    ownershipCost > 0 ? Math.round((savings / ownershipCost) * 10000) / 100 : 0;

  return {
    sharingCost,
    ownershipCost,
    savings,
    savingsPercent,
    carName: v.name,
    totalKm,
    period: year || "year",
    breakdownOwnership: {
      depreciation: v.costs.depreciation,
      insurance: v.costs.insurance,
      tax: v.costs.tax,
      maintenance: v.costs.maintenance,
      parking: v.costs.parking,
      fuel: Math.round(ownershipFuel),
    },
    breakdownSharing: {
      total: sharingCost,
    },
  };
}

export { VOLVO_EXC40 };
