import { filterDriven } from "./stats.js";
import { REFERENCE_CAR as CAR, SOURCES } from "./referansebil.js";

// Bilregnestykket og «Spart i år» sammenligner bildelingen med én fast bil.
// Forutsetningene, med kilde og dato, står i referansebil.js. Her regnes de
// om: faste kostnader per år, og variable kostnader (dekk og strøm) per
// kjørte kilometer.

const ELECTRICITY_KR_PER_KWH =
  (1 - CAR.fastChargingShare.value) * CAR.homeChargingKrPerKWh.value +
  CAR.fastChargingShare.value * CAR.fastChargingKrPerKWh.value;

const ENERGY_PER_KM = CAR.kWhPerKm.value * ELECTRICITY_KR_PER_KWH;
const TYRES_PER_KM = CAR.tyresPerKm.value;

const FIXED_COSTS = {
  depreciation: CAR.depreciation.value,
  insurance: CAR.insurance.value,
  tax: CAR.trafficInsuranceTax.value,
  maintenance: CAR.maintenance.value,
};

/**
 * Den faste sammenligningsbilen: navn, pris, faste kostnader per år uten
 * parkering, og variable kostnader per km.
 */
export const COMPARISON_CAR = {
  name: CAR.model.value,
  variant: CAR.variant.value,
  price: CAR.price.value,
  costs: FIXED_COSTS,
  tyresPerKm: TYRES_PER_KM,
  energyPerKm: ENERGY_PER_KM,
};

/**
 * Bykode ("bergen", "trondheim") for en organizationId fra dele.no, eller
 * null når organisasjonen er ukjent.
 */
export function regionForOrganization(organizationId) {
  return CAR.parking[organizationId]?.city.toLowerCase() ?? null;
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
  const { city, perMonth } = CAR.parking[orgId] ?? CAR.parking[CAR.defaultParkingOrganization];
  return { city, perMonth, perYear: perMonth * 12 };
}

// «Slik beregnes det» ved bilregnestykket, «Spart i år» og årsoppsummeringen,
// se method-panel.js. Verdiene og kildene er de samme oppføringene i
// referansebil.js som regnestykket bruker, så tabellen følger med når de
// endres.
const defaultCity = CAR.parking[CAR.defaultParkingOrganization].city;
const percent = (share) => `${Math.round(share * 100)}\u00a0%`;
const factor = (label, entry, unit, note) => ({ label, value: entry.value, unit, source: entry.source, note });

export const OWNERSHIP_METHOD = {
  intro: `Det du har betalt for bildeling, sammenlignes med å eie en ny ${CAR.model.value} ${CAR.variant.value}, ` +
    "uansett hvilke biler du har brukt.",
  factors: [
    { ...factor("Pris, ny bil", CAR.price, "kr", "Tidligere XC40 Recharge."), source: [CAR.price.source, "finn"] },
    factor("Verditap over tre år", CAR.depreciation, "kr/år"),
    factor("Forsikring med 75\u00a0% bonus", CAR.insurance, "kr/år"),
    factor("Trafikkforsikringsavgift", CAR.trafficInsuranceTax, "kr/år"),
    factor("Vedlikehold og service", CAR.maintenance, "kr/år"),
    ...Object.values(CAR.parking).map((p) => ({
      label: `Boligsoneparkering i ${[p.city, p.zone].filter(Boolean).join(", ")}`,
      value: p.perMonth, unit: "kr/mnd", source: p.source,
      note: `Bil 1 i byen til bilkollektivet ditt. Ukjent bilkollektiv regnes som ${defaultCity}.`,
    })),
    factor("Dekk", CAR.tyresPerKm, "kr/km"),
    factor("Strømforbruk", CAR.kWhPerKm, "kWh/km"),
    factor(`Hjemmelading, ${percent(1 - CAR.fastChargingShare.value)} av ladingen`, CAR.homeChargingKrPerKWh, "kr/kWh"),
    factor(`Hurtiglading, ${percent(CAR.fastChargingShare.value)} av ladingen`, CAR.fastChargingKrPerKWh, "kr/kWh"),
    factor("Kjørelengde i OFV-tallene", CAR.ofvKmPerYear, "km/år",
      "Kjører du mindre, blir verditap og forsikring i virkeligheten noe lavere."),
  ],
  notes: [
    "Bildeling er det du faktisk har betalt.",
    "«Spart i år» tar de faste kostnadene for den delen av året som er gått.",
    "Renter på kjøpesummen, bompenger og ferje er ikke med.",
  ],
  sources: SOURCES,
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
 * Bildelingen mot å eie den faste sammenligningsbilen.
 *
 * @param {Array} reservations - Alle reservasjoner
 * @param {number|null} year - Ett år, eller null for alle data omregnet til ett år
 * @param {{organizationId?: string, now?: Date}} options - organizationId er
 *   organisasjonen i selectedMembership. Mangler den, brukes den vanligste
 *   organisasjonen i reservasjonene. `now` avgjør hvor mye av et pågående år
 *   som er gått.
 * @returns {Object|null} Sammenligningen, eller null uten kjørte turer
 */
export function estimateOwnershipCost(reservations, year = null, { organizationId, now = new Date() } = {}) {
  const driven = filterDriven(reservations);
  const filtered = year
    ? driven.filter((r) => new Date(r.start).getFullYear() === year)
    : driven;
  if (filtered.length === 0) return null;

  const sharingCostRaw = filtered.reduce((sum, r) => sum + (r.price?.total ?? 0), 0);
  const totalKmRaw = filtered.reduce((sum, r) => sum + (r.drivenKm ?? 0), 0);

  // Et år gir faktiske tall hittil i året, og de faste kostnadene tas for
  // like stor del av året. Uten år regnes alt om til ett helt år.
  let sharingCost = sharingCostRaw;
  let totalKm = totalKmRaw;
  let fraction = 1;
  if (year) {
    fraction = yearFraction(year, now);
  } else {
    const dates = filtered.map((r) => new Date(r.start).getTime());
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const rangeInYears = (Math.max(...dates) - Math.min(...dates)) / msPerYear;
    // Alle turer samme dag regnes som én dag.
    const effectiveYears = rangeInYears > 0 ? rangeInYears : 1 / 365.25;
    sharingCost = sharingCostRaw / effectiveYears;
    totalKm = Math.round(totalKmRaw / effectiveYears);
  }

  const parking = parkingFor(reservations, organizationId);
  const fixed = { ...FIXED_COSTS, parking: parking.perYear };
  const breakdownOwnership = {};
  for (const [key, perYear] of Object.entries(fixed)) {
    breakdownOwnership[key] = Math.round(perYear * fraction);
  }
  const fixedCost = Object.values(fixed).reduce((a, b) => a + b, 0) * fraction;
  const tyres = totalKm * TYRES_PER_KM;
  const energy = totalKm * ENERGY_PER_KM;
  breakdownOwnership.tyres = Math.round(tyres);
  breakdownOwnership.energy = Math.round(energy);

  const ownershipCost = Math.round(fixedCost + tyres + energy);
  sharingCost = Math.round(sharingCost);
  const savings = ownershipCost - sharingCost;
  const savingsPercent =
    ownershipCost > 0 ? Math.round((savings / ownershipCost) * 10000) / 100 : 0;

  return {
    sharingCost,
    ownershipCost,
    savings,
    savingsPercent,
    carName: COMPARISON_CAR.name,
    totalKm,
    parkingCity: parking.city,
    period: year || "year",
    yearFraction: fraction,
    breakdownOwnership,
    breakdownSharing: { total: sharingCost },
  };
}
