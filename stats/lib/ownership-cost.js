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

// OFV tar ikke med parkering. Vi bruker boligsoneparkering for bil 1 i byen
// der medlemmets bilkollektiv holder til, ut fra organizationId (se
// docs/api/README.md). Med egen plass er parkeringen 0 kr.
//   Bildeleringen: Bergen sone 1–8, 582 kr/mnd (Bergen kommune,
//     «Boligsoneparkering», side oppdatert 15.10.2026).
//   Trondheim Bilkollektiv: Trondheim, 785 kr/mnd (Trondheim kommune,
//     «Prisliste», side oppdatert 31.12.2025, hentet 01.11.2026).
// Ukjent organisasjon regnes som Bergen, der flest av bilene står.
const PARKING = {
  bergen: { city: "Bergen", perMonth: 582 },
  trondheim: { city: "Trondheim", perMonth: 785 },
};
const DEFAULT_REGION = "bergen";

const ORGANIZATION_REGION = {
  "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0": "bergen", // Bildeleringen
  "8dba8f19-c438-f278-ed7c-912ec6537cb9": "trondheim", // Trondheim Bilkollektiv
};

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
  };
}

/**
 * Region ("bergen" eller "trondheim") for en organizationId fra dele.no,
 * eller null når organisasjonen er ukjent.
 */
export function regionForOrganization(organizationId) {
  return ORGANIZATION_REGION[organizationId] ?? null;
}

/**
 * Organisasjonen flest av reservasjonene hører til. Reservasjonene hentes per
 * medlemskap, og et medlemskap hører til én organisasjon, så dette er
 * medlemmets eget bilkollektiv. Null når ingen har organizationId.
 */
export function homeOrganizationId(reservations) {
  const counts = {};
  for (const r of reservations) {
    if (r.organizationId) counts[r.organizationId] = (counts[r.organizationId] || 0) + 1;
  }
  const top = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
  return top ? top[0] : null;
}

/**
 * Årlig parkering for organisasjonen. Uten organizationId brukes den
 * vanligste organisasjonen i reservasjonene.
 */
export function parkingFor(reservations, organizationId) {
  const orgId = organizationId ?? homeOrganizationId(reservations);
  const region = regionForOrganization(orgId) ?? DEFAULT_REGION;
  const { city, perMonth } = PARKING[region];
  return { region, city, perMonth, perYear: perMonth * 12 };
}

const volvoOfv = ofvCostsForPrice(VOLVO_EX40_PRICE);
const VOLVO_EX40 = {
  name: "Volvo EX40",
  price: VOLVO_EX40_PRICE,
  costs: fixedCosts(volvoOfv, "Elektrisitet"),
  fuelCostPerKm: fuelCostPerKm("Elektrisitet", volvoOfv.kWhPerKm),
};

// Tekst og kilder til «Slik beregner vi» ved eierkostnad og sparetall.
// Tallene hentes fra konstantene over, så teksten følger med når de endres.
const kr = (n) => `${new Intl.NumberFormat("nb-NO").format(n)} kr`;

export const OWNERSHIP_METHOD = {
  note: "Eierkostnaden er et anslag for en ny bil i bilkategorien du bruker mest, " +
    "over tre års eiertid: verditap, forsikring, trafikkforsikringsavgift (tidligere årsavgift), " +
    "vedlikehold med dekk og service, parkering og drivstoff for kilometerne du kjørte. " +
    "Tallene er OFVs eksempler for 10 000 km i året. Vi har satt Minibil og Småbil " +
    `lik en bil til ${kr(CATEGORY_PRICE.Småbil)}, Kombi ${kr(CATEGORY_PRICE.Kombi)} og ` +
    `Stasjonsvogn, SUV og Varebil ${kr(CATEGORY_PRICE.SUV)}. ` +
    "Forsikringen er snittpris i Oslo-området med 75 % bonus. " +
    "Parkering er boligsoneparkering for bil 1 der bilkollektivet ditt holder til: " +
    `${kr(PARKING.bergen.perMonth)} i måneden i Bergen sone 1–8 (Bildeleringen) og ` +
    `${kr(PARKING.trondheim.perMonth)} i måneden i Trondheim (Trondheim Bilkollektiv). ` +
    "Med egen plass blir det 0 kr. Renter på kjøpesummen, " +
    "bompenger og ferje er ikke med, så det reelle tallet er som regel høyere. " +
    `Volvo EX40 er regnet på samme måte ut fra veiledende pris ${kr(VOLVO_EX40_PRICE)} for P5 Core. ` +
    "Bildeling er det du faktisk har betalt. For året som pågår er de faste " +
    "kostnadene tatt for den delen av året som er gått, så de møter bildelingen hittil.",
  sources: [
    {
      text: "OFV: Kostnader ved bilhold – eksempler på beregning 2026 (16.06.2026)",
      url: "https://kommunikasjon.ntb.no/pressemelding/18952851/ny-bil-koster-mer-enn-mange-tror-verditapet-er-den-storste-bilutgiften?lang=no",
    },
    {
      text: "NAF: Avgifter og kostnader for bil 2026 (oppdatert 02.10.2026)",
      url: "https://www.naf.no/politikk-og-samfunn/privatokonomi/avgifter-og-kostnader-for-bil-2026",
    },
    {
      text: "Bergen kommune: Boligsoneparkering, sone 1–8 (side oppdatert 15.10.2026)",
      url: "https://www.bergen.kommune.no/innbyggerhjelpen/trafikk-reiser-vei/vei-transport-og-parkering/parkering/boligsoneparkering",
    },
    {
      text: "Trondheim kommune: Prisliste, boligsoneparkering (side oppdatert 31.12.2025)",
      url: "https://www.trondheim.kommune.no/parkering/innhold/priser-og-betaling/prisliste/",
    },
    { text: "Finn bilguiden: Volvo EX40 oppdatert, norske priser er klare (10.09.2026)" },
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
 * Hvor stor del av året som er gått per `now`: 1 for et avsluttet år, 0 for et
 * år som ikke har begynt. Bildelingen i et år som pågår er bare kostnaden
 * hittil, så eierkostnaden må tas for like lang tid.
 */
export function yearFraction(year, now) {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * Estimate the cost of owning a comparable car vs. actual car-sharing spend.
 *
 * @param {Array} reservations - All reservation objects
 * @param {number|null} year - Specific year to analyze, or null for all data (annualized)
 * @param {{organizationId?: string, now?: Date}} options - organizationId er
 *   organisasjonen i selectedMembership. Mangler den, brukes den vanligste
 *   organisasjonen i reservasjonene. `now` avgjør hvor mye av et pågående år
 *   som er gått.
 * @returns {Object|null} Cost comparison object, or null if no data
 */
export function estimateOwnershipCost(reservations, year = null, { organizationId, now = new Date() } = {}) {
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
  const parking = parkingFor(reservations, organizationId);
  const categoryCosts = { ...fixedCosts(ofv, fuelType), parking: parking.perYear };
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

  const fraction = year ? yearFraction(year, now) : 1;

  if (year) {
    // Turene er hittil i året, så de faste kostnadene tas for samme del av året.
    sharingCost = sharingCostRaw;
    totalKm = totalKmRaw;
    ownershipFixed = fixedCostPerYear * fraction;
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
    parkingCity: parking.city,
    period: year || "year",
    yearFraction: fraction,
    breakdownOwnership: {
      depreciation: Math.round(categoryCosts.depreciation * fraction),
      insurance: Math.round(categoryCosts.insurance * fraction),
      tax: Math.round(categoryCosts.tax * fraction),
      maintenance: Math.round(categoryCosts.maintenance * fraction),
      parking: Math.round(categoryCosts.parking * fraction),
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
export function estimateVolvoComparison(reservations, year = null, { organizationId, now = new Date() } = {}) {
  const driven = filterDriven(reservations);
  if (driven.length === 0) return null;

  const filtered = year
    ? driven.filter((r) => new Date(r.start).getFullYear() === year)
    : driven;

  if (filtered.length === 0) return null;

  const sharingCostRaw = filtered.reduce((sum, r) => sum + (r.price?.total ?? 0), 0);
  const totalKmRaw = filtered.reduce((sum, r) => sum + (r.drivenKm ?? 0), 0);

  const v = VOLVO_EX40;
  const parking = parkingFor(reservations, organizationId);
  const fixedCostPerYear =
    v.costs.depreciation + v.costs.insurance + v.costs.tax + v.costs.maintenance + parking.perYear;

  let sharingCost, totalKm, ownershipFuel;

  const fraction = year ? yearFraction(year, now) : 1;
  let ownershipFixed = fixedCostPerYear;

  if (year) {
    sharingCost = sharingCostRaw;
    totalKm = totalKmRaw;
    ownershipFixed = fixedCostPerYear * fraction;
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
    carName: v.name,
    totalKm,
    parkingCity: parking.city,
    period: year || "year",
    yearFraction: fraction,
    breakdownOwnership: {
      depreciation: Math.round(v.costs.depreciation * fraction),
      insurance: Math.round(v.costs.insurance * fraction),
      tax: Math.round(v.costs.tax * fraction),
      maintenance: Math.round(v.costs.maintenance * fraction),
      parking: Math.round(parking.perYear * fraction),
      fuel: Math.round(ownershipFuel),
    },
    breakdownSharing: {
      total: sharingCost,
    },
  };
}

export { VOLVO_EX40 };
