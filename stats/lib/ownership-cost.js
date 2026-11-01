import { filterDriven } from "./stats.js";

// Alle tall er årlige kroner. Hver forutsetning har kilde og dato, og alt står
// også i OWNERSHIP_METHOD, som er «Slik beregner vi» i bilregnestykket.
//
// Hovedkilde: OFV, «Kostnader ved bilhold – eksempler på beregning 2026»,
// publisert 16.06.2026 (datagrunnlag desember 2025 – mai 2026). Vi bruker
// kolonnen for 10 000 km/år, som ligger nærmest det delebilbrukere kjører.
// Faste poster hentes fra OFVs elbileksempler: OFV har ingen bensin- eller
// dieseleksempler under 550 000 kr, og nesten alle nye biler i de klassene er
// elbiler (OFV tabell «Tilbudte nye personbiler per mai 2026»).
//   depreciation: post 1 avskrivning, 3 års eiertid
//   insurance:    post 3 ansvar + kasko, 75 % bonus, Oslo-området
//   maintenance:  post 5 vedlikehold + post 8 dekk + post 9 service
//   kWhPerKm:     OFVs forbruk, kWh/mil delt på 10
// Renter på bundet kapital (OFV post 2) er ikke med, så eierkostnaden er
// heller for lav enn for høy.
const OFV_ELBIL_10K = [
  { price: 300000, depreciation: 40495, insurance: 2045 + 8322, maintenance: 3958 + 3189 + 3366, kWhPerKm: 0.152 },
  { price: 400000, depreciation: 49653, insurance: 2674 + 11007, maintenance: 5822 + 4079 + 3566, kWhPerKm: 0.156 },
  { price: 550000, depreciation: 65741, insurance: 3228 + 11720, maintenance: 7687 + 5019 + 3694, kWhPerKm: 0.168 },
];

// Vår antakelse, ikke OFVs: hvilken prisklasse hver Dele-kategori tilsvarer.
// OFV har ingen varebileksempler, så Varebil regnes som 550 000 kr-klassen.
const CATEGORY_PRICE = {
  Minibil: 300000,
  Småbil: 300000,
  Kombi: 400000,
  Stasjonsvogn: 550000,
  SUV: 550000,
  Varebil: 550000,
};

// Trafikkforsikringsavgift (tidligere årsavgift) fra 01.03.2026, 365 dager.
// Kilde: OFV kalkyle 2026 og NAF «Avgifter og kostnader for bil 2026»
// (publisert 20.01.2026, oppdatert 02.10.2026). Elbil 9,16 kr/dag,
// bensin og diesel med partikkelfilter 6,52 kr/dag.
const TRAFFIC_INSURANCE_TAX = {
  Elektrisitet: 3343,
  Bensin: 2380,
  Diesel: 2380,
};

// OFV tar ikke med parkering. Vi bruker boligsoneparkering i Bergen sone 1–8,
// 582 kr/mnd (Bergen kommune, priser fra 01.01.2025, fryst for 2026 ifølge
// byrådets budsjettforslag 22.10.2025). Det er en Bergen-pris: i Oslo indre by
// koster beboerparkering 3 850 kr (elbil 1 300 kr), i ytre by 0 kr (Oslo
// kommune, 2026-priser), og leid plass i Bergen kommunes beboeranlegg koster
// 1 257 kr/mnd (side oppdatert 13.10.2026). Med egen plass er den 0 kr.
const PARKING_PER_YEAR = 582 * 12;

// Drivstoff og strøm, OFV kalkyle 2026: bensin 20,72 kr/l og 0,61 l/mil
// (bensineksempel 1), diesel 20,35 kr/l og 0,69 l/mil (dieseleksempel 1).
// Strøm: 80 % hjemmelading til 1,05 kr/kWh (Norgespris med nettleie og
// avgifter) og 20 % hurtiglading til 5,47 kr/kWh.
const PETROL_COST_PER_KM = 20.72 * 0.061;
const DIESEL_COST_PER_KM = 20.35 * 0.069;
const ELECTRICITY_KR_PER_KWH = 0.8 * 1.05 + 0.2 * 5.47;

// Bompenger og ferje er ikke med. OFV utelater dem fordi de varierer for mye
// fra bileier til bileier, og det gjør de mellom Bilparaplyens byer også.

// Referansebil: Volvo EX40 P5 Core, veiledende pris 439 900 kr inkl. levering
// (Finn bilguiden, «Volvo EX40 oppdatert: norske priser er klare»,
// 10.09.2026). EX40 er det nye navnet på XC40 Recharge siden februar 2024,
// og C40 Recharge heter nå EC40. «EX C40» finnes ikke. Kostnadene er
// interpolert lineært mellom OFVs elbileksempler på 400 000 og 550 000 kr.
const VOLVO_EX40_PRICE = 439900;

/**
 * OFV-postene for en nybilpris, interpolert lineært mellom elbileksemplene.
 * Priser utenfor tabellen får nærmeste eksempel.
 */
function ofvCostsForPrice(price) {
  const rows = OFV_ELBIL_10K;
  if (price <= rows[0].price) return rows[0];
  if (price >= rows[rows.length - 1].price) return rows[rows.length - 1];
  const i = rows.findIndex((r) => r.price >= price);
  const lo = rows[i - 1];
  const hi = rows[i];
  const t = (price - lo.price) / (hi.price - lo.price);
  const mix = (key) => lo[key] + t * (hi[key] - lo[key]);
  return {
    price,
    depreciation: Math.round(mix("depreciation")),
    insurance: Math.round(mix("insurance")),
    maintenance: Math.round(mix("maintenance")),
    kWhPerKm: mix("kWhPerKm"),
  };
}

function fuelCostPerKm(fuelType, kWhPerKm) {
  if (fuelType === "Elektrisitet") return kWhPerKm * ELECTRICITY_KR_PER_KWH;
  if (fuelType === "Diesel") return DIESEL_COST_PER_KM;
  return PETROL_COST_PER_KM;
}

function fixedCosts(ofv, fuelType) {
  return {
    depreciation: ofv.depreciation,
    insurance: ofv.insurance,
    tax: TRAFFIC_INSURANCE_TAX[fuelType] ?? TRAFFIC_INSURANCE_TAX.Bensin,
    maintenance: ofv.maintenance,
    parking: PARKING_PER_YEAR,
  };
}

const volvoOfv = ofvCostsForPrice(VOLVO_EX40_PRICE);
const VOLVO_EX40 = {
  name: "Volvo EX40",
  price: VOLVO_EX40_PRICE,
  costs: fixedCosts(volvoOfv, "Elektrisitet"),
  fuelCostPerKm: fuelCostPerKm("Elektrisitet", volvoOfv.kWhPerKm),
};

// Tekst og kilder til «Slik beregner vi» ved eierkostnad og sparetall.
export const OWNERSHIP_METHOD = {
  note: "Eierkostnaden er et anslag for en ny bil i bilkategorien du bruker mest, " +
    "over tre års eiertid: verditap, forsikring, trafikkforsikringsavgift (tidligere årsavgift), " +
    "vedlikehold med dekk og service, parkering og drivstoff for kilometerne du kjørte. " +
    "Tallene er OFVs eksempler for 10 000 km i året. Vi har satt Minibil og Småbil " +
    "lik en bil til 300 000 kr, Kombi 400 000 kr og Stasjonsvogn, SUV og Varebil " +
    "550 000 kr. Forsikringen er snittpris i Oslo-området med 75 % bonus. " +
    "Parkering er boligsone i Bergen sone 1–8, ca. 7 000 kr i året. Bor du andre steder, " +
    "er det annerledes: i Oslo indre by koster beboerparkering 3 850 kr (elbil 1 300 kr), " +
    "i ytre by ingenting, og med egen plass blir det 0 kr. Renter på kjøpesummen, " +
    "bompenger og ferje er ikke med, så det reelle tallet er som regel høyere. " +
    "Volvo EX40 er regnet på samme måte ut fra veiledende pris 439 900 kr for P5 Core. " +
    "Bildeling er det du faktisk har betalt.",
  sources: [
    "OFV: Kostnader ved bilhold – eksempler på beregning 2026 (16.06.2026)",
    "NAF: Avgifter og kostnader for bil 2026 (oppdatert 02.10.2026)",
    "Bergen kommune: boligsoneparkering, priser fra 01.01.2025, fryst for 2026 (22.10.2025)",
    "Oslo kommune: priser for beboerparkeringstillatelse 2026",
    "Finn bilguiden: Volvo EX40 oppdatert, norske priser er klare (10.09.2026)",
  ],
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
  const ofv = ofvCostsForPrice(CATEGORY_PRICE[category] ?? CATEGORY_PRICE.Småbil);
  const categoryCosts = fixedCosts(ofv, fuelType);
  const fixedCostPerYear =
    categoryCosts.depreciation +
    categoryCosts.insurance +
    categoryCosts.tax +
    categoryCosts.maintenance +
    categoryCosts.parking;

  const costPerKm = fuelCostPerKm(fuelType, ofv.kWhPerKm);

  let sharingCost;
  let totalKm;
  let ownershipFixed;
  let ownershipFuel;

  if (year) {
    // Use the year's data directly (already represents one year)
    sharingCost = sharingCostRaw;
    totalKm = totalKmRaw;
    ownershipFixed = fixedCostPerYear;
    ownershipFuel = totalKm * costPerKm;
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
    ownershipFuel = totalKm * costPerKm;
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
 * Compare car-sharing cost against owning a new Volvo EX40 P5 Core specifically.
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

  const v = VOLVO_EX40;
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

export { VOLVO_EX40 };
