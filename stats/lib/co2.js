import { getFuelType } from "./ownership-cost.js";
import { filterDriven } from "./stats.js";

// CO₂ emission factors (grams per km) by fuel type and car category
// Sources: Miljødirektoratet, SSB Registered Vehicle Statistics
// These are tank-to-wheel (direct) emissions only
const CO2_PER_KM = {
  Bensin: {
    Småbil: 120, Minibil: 110, Kombi: 140,
    Stasjonsvogn: 150, SUV: 180, Varebil: 190,
  },
  Diesel: {
    Småbil: 100, Minibil: 95, Kombi: 120,
    Stasjonsvogn: 130, SUV: 160, Varebil: 170,
  },
  Elektrisitet: {
    Småbil: 0, Minibil: 0, Kombi: 0,
    Stasjonsvogn: 0, SUV: 0, Varebil: 0,
  },
};

// Norwegian registered passenger car fleet average: ~110 g/km (tank-to-wheel)
// Used only in co2Comparison() for reference. Not shown prominently in UI.
const PRIVATE_CAR_AVG_CO2 = 110;

// Methodology note for UI display. Factors and the comparison are national,
// so they hold for every Bilparaplyen member. TØI 1895/2022 «Bildeling i
// Bergen» is background in docs/research, but no number here comes from it,
// so it is not listed as a source.
export const CO2_METHOD = {
  note: "Utslippet per tur regnes fra bilens drivstoff og kategori. " +
    "Elbil teller 0 g/km, siden bare direkte utslipp er med.",
  comparison: `Spart utslipp er regnet mot snittet for norske privatbiler, ${PRIVATE_CAR_AVG_CO2} g/km.`,
  sources: [
    "TØI: Bildelingens miljøkonsekvenser (Julsrud)",
    "Miljødirektoratet / SSB: Utslippsfaktorer norsk bilpark",
  ],
};

/**
 * Calculate CO2 emissions for a single reservation.
 * Returns { co2Grams, fuelType, category, km } or null if no km data.
 */
export function tripCO2(reservation) {
  const km = reservation.drivenKm;
  if (!km) return null;

  const fuelType = getFuelType(reservation.car);
  const category = reservation.car?.category || "Småbil";

  const fuelTable = CO2_PER_KM[fuelType] || CO2_PER_KM.Bensin;
  const gPerKm = fuelTable[category] ?? fuelTable.Småbil;

  return {
    co2Grams: km * gPerKm,
    fuelType,
    category,
    km,
  };
}

/**
 * Aggregate CO2 emissions across all driven reservations.
 * Returns totals, averages, and breakdowns by fuel type and category,
 * or null if no km data exists.
 */
export function totalCO2(reservations) {
  const driven = filterDriven(reservations);
  const trips = driven.map(tripCO2).filter(Boolean);

  if (trips.length === 0) return null;

  const totalGrams = trips.reduce((sum, t) => sum + t.co2Grams, 0);
  const totalKm = trips.reduce((sum, t) => sum + t.km, 0);

  const byFuelType = {};
  const byCategory = {};

  for (const t of trips) {
    // By fuel type
    if (!byFuelType[t.fuelType]) {
      byFuelType[t.fuelType] = { kg: 0, km: 0, trips: 0 };
    }
    byFuelType[t.fuelType].kg += t.co2Grams / 1000;
    byFuelType[t.fuelType].km += t.km;
    byFuelType[t.fuelType].trips += 1;

    // By category
    if (!byCategory[t.category]) {
      byCategory[t.category] = { kg: 0, km: 0, trips: 0 };
    }
    byCategory[t.category].kg += t.co2Grams / 1000;
    byCategory[t.category].km += t.km;
    byCategory[t.category].trips += 1;
  }

  return {
    totalKg: totalGrams / 1000,
    totalKm,
    avgPerKm: totalKm > 0 ? totalGrams / totalKm : 0,
    tripCount: trips.length,
    byFuelType,
    byCategory,
  };
}

/**
 * Compare CO2 from car sharing vs hypothetical private car ownership.
 * Returns null if no km data exists.
 */
export function co2Comparison(reservations) {
  const stats = totalCO2(reservations);
  if (!stats) return null;

  const sharingCO2Kg = stats.totalKg;
  const privateCO2Kg = (stats.totalKm * PRIVATE_CAR_AVG_CO2) / 1000;
  const savedKg = privateCO2Kg - sharingCO2Kg;
  const savedPercent = privateCO2Kg > 0 ? (savedKg / privateCO2Kg) * 100 : 0;

  return {
    sharingCO2Kg,
    privateCO2Kg,
    savedKg,
    savedPercent,
    totalKm: stats.totalKm,
    avgGPerKm: stats.avgPerKm,
    fleetAvgGPerKm: PRIVATE_CAR_AVG_CO2,
  };
}

/**
 * Monthly CO2 emissions, sorted chronologically.
 * Returns array of { month: "YYYY-MM", co2Kg }.
 */
export function monthlyCO2(reservations) {
  const driven = filterDriven(reservations);
  const byMonth = {};

  for (const r of driven) {
    const trip = tripCO2(r);
    if (!trip) continue;

    const date = new Date(r.start);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + trip.co2Grams / 1000;
  }

  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, co2Kg]) => ({ month, co2Kg }));
}
