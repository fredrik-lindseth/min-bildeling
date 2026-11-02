import { getFuelType, yearFraction } from "./ownership-cost.js";
import { filterDriven } from "./stats.js";
import { AVERAGE_CAR, SOURCES as AVERAGE_CAR_SOURCES } from "./snittbil.js";

// CO₂ emission factors (grams per km) by fuel type and car category
// Sources: Miljødirektoratet, SSB Registered Vehicle Statistics
// These are tank-to-wheel (direct) emissions only
export const CO2_PER_KM = {
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

/** Gram CO₂ per km for en norsk personbil: SSBs utslipp delt på kjørelengden. */
export function averageCarCO2PerKm(car = AVERAGE_CAR) {
  return Math.round((car.co2Kilotonnes.value * 1000) / car.totalMillionKm.value);
}

// Snittet «CO₂ spart» regnes mot, og som gjennomsnittsbilen i Klima bruker.
export const PRIVATE_CAR_AVG_CO2 = averageCarCO2PerKm();

/** Kg CO₂ en gjennomsnittlig personbil slipper ut på et helt år. */
export function averageCarKgPerYear(car = AVERAGE_CAR) {
  return (car.kmPerCar.value * averageCarCO2PerKm(car)) / 1000;
}

// Laveste og høyeste faktor for et drivstoff, over alle kategoriene.
function factorRange(fuel) {
  const values = Object.values(CO2_PER_KM[fuel]);
  return [Math.min(...values), Math.max(...values)];
}

// «Slik beregnes det» ved Klima og i årsoppsummeringen, se method-panel.js.
// Faktorene og sammenligningen er nasjonale, så de gjelder alle medlemmene i
// Bilparaplyen. TØI-rapportene i docs/research er bakgrunn, men ingen faktor
// her kommer fra dem, så de står ikke som kilde.
const BY_CATEGORY = "Faktoren følger bilkategorien, fra minibil til varebil.";
export const CO2_METHOD = {
  intro: "Utslippet for hver tur er kjørte kilometer ganger en faktor for bilens drivstoff og kategori.",
  factors: [
    { label: "Bensinbil", value: factorRange("Bensin"), unit: "g/km", note: BY_CATEGORY, source: "faktorer" },
    { label: "Dieselbil", value: factorRange("Diesel"), unit: "g/km", note: BY_CATEGORY, source: "faktorer" },
    { label: "Elbil", value: factorRange("Elektrisitet"), unit: "g/km", note: "Bare utslipp fra eksos er med.", source: "faktorer" },
    {
      label: "Snitt for norske personbiler", value: PRIVATE_CAR_AVG_CO2, unit: "g/km",
      note: `Utslippet fra personbilene delt på kjørelengden deres i ${AVERAGE_CAR.year}. Elbilene teller med. Spart utslipp er forskjellen mot dette snittet.`,
      source: ["ssbUtslipp", "ssbKjorelengde"],
    },
    {
      label: "Kjørelengde per personbil", value: AVERAGE_CAR.kmPerCar.value, unit: `km i ${AVERAGE_CAR.year}`,
      source: "ssbKjorelengde",
    },
  ],
  notes: ["Ukjent kategori regnes som småbil, og ukjent drivstoff som bensin."],
  sources: {
    faktorer: { name: "Miljødirektoratet og SSB: Utslippsfaktorer for norsk bilpark" },
    ...AVERAGE_CAR_SOURCES,
  },
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

/**
 * Året brukeren sammenlignes med gjennomsnittsbilen for: siste hele
 * kalenderår med turer, eller inneværende år hittil når det er det eneste.
 * Et delår sammenlignes aldri med et helt landsår, så fraction skalerer snittet.
 * Returnerer { year, fraction } eller null.
 */
export function comparisonYear(years, now) {
  const current = now.getFullYear();
  const past = years.filter((y) => y < current);
  if (past.length > 0) return { year: Math.max(...past), fraction: 1 };
  if (years.includes(current)) return { year: current, fraction: yearFraction(current, now) };
  return null;
}

/**
 * Brukerens kjøring og utslipp i ett år mot en gjennomsnittlig norsk
 * personbil. Tallene er per bil, ikke per innbygger, fordi brukerens tall er
 * kjørte km. dataYear er året SSB-tallene gjelder.
 */
export function averageCarComparison(reservations, { now = new Date(), car = AVERAGE_CAR } = {}) {
  const driven = filterDriven(reservations).filter((r) => r.drivenKm > 0);
  const years = [...new Set(driven.map((r) => new Date(r.start).getFullYear()))];
  const picked = comparisonYear(years, now);
  if (!picked) return null;

  const { year, fraction } = picked;
  const stats = totalCO2(driven.filter((r) => new Date(r.start).getFullYear() === year));
  if (!stats) return null;

  return {
    year,
    fraction,
    partial: fraction < 1,
    userKm: stats.totalKm,
    userCO2Kg: stats.totalKg,
    carKm: car.kmPerCar.value * fraction,
    carCO2Kg: averageCarKgPerYear(car) * fraction,
    dataYear: car.year,
  };
}
