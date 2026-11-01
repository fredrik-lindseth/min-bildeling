/**
 * Transport calculator module.
 *
 * CO₂ factors per transport mode (g/km, passenger), tailpipe only. Taxi and
 * bus apply to every Bilparaplyen member, not just Bergen:
 *   - Taxi: depends on the year, see taxiCO2PerKm(). Taxis for up to nine
 *     people must be zero-emission in the former Hordaland municipalities
 *     since 01.04.2024 and in the rest of Vestland since 01.04.2026
 *     (FOR-2020-03-03-2549 §§ 1, 2 and 6), and in all of Trøndelag since
 *     01.07.2025 (FOR-2021-05-27-1753 § 2; wheelchair taxis with more than
 *     seven seats are exempt). Lovdata, read 01.11.2026. Before that, 229 g
 *     CO₂-eq per driven km: fuel use and mileage reported by the Hordaland
 *     taxi fleet in 2018 (AUD-rapport 14-2019), as used in Vestland county's
 *     report for the Sogn og Fjordane regulation (footnote 11, March 2021).
 *     No Trøndelag figure was found, so the same number is used there.
 *   - Bus: SSB national figure for buses excl. coaches, 59 g/pkm in 2019, the
 *     last year before the pandemic skewed occupancy (SSB, «Mer utslipp for
 *     hver kilometer reist», figure/table 1, 13.12.2021). Electric buses,
 *     light rail and trams pull the real number down, so this is an upper
 *     estimate.
 *   - Fly: Avinor/Miljødirektoratet.
 */

import { regionForOrganization } from "./ownership-cost.js";

// Drosjeutslipp før nullutslippskravet, g CO₂-ekv. per kjørte km.
export const TAXI_CO2_BEFORE_REQUIREMENT = 229;

// Dagen kravet gjelder fra, per region i ownership-cost.js. Bergen ligger i
// gamle Hordaland. Ukjent organisasjon regnes som Bergen, som i bilregnestykket.
const TAXI_ZERO_EMISSION_FROM = {
  bergen: Date.UTC(2024, 3, 1),
  trondheim: Date.UTC(2025, 6, 1),
};

/**
 * Drosjeutslipp per km for et år, for bilkollektivet til organizationId.
 * Året kravet trer i kraft, vektes etter hvor stor del av året som var før.
 */
export function taxiCO2PerKm(year, organizationId) {
  const from = TAXI_ZERO_EMISSION_FROM[regionForOrganization(organizationId) ?? "bergen"];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const before = Math.min(1, Math.max(0, (from - start) / (end - start)));
  return TAXI_CO2_BEFORE_REQUIREMENT * before;
}

export const TRANSPORT_MODES = {
  taxi: {
    label: "Taxi",
    co2PerKm: null, // Per year, see taxiCO2PerKm()
    fields: [
      { key: "trips", label: "Antall turer", type: "number" },
      { key: "totalKm", label: "Totalt km", type: "number" },
      { key: "totalCost", label: "Totalt betalt (kr)", type: "number" },
    ],
  },
  leiebil: {
    label: "Leiebil",
    co2PerKm: 130, // Norwegian fleet average
    fields: [
      { key: "days", label: "Antall leiedager", type: "number" },
      { key: "totalKm", label: "Totalt km", type: "number" },
      { key: "totalCost", label: "Totalt betalt (kr)", type: "number" },
    ],
  },
  buss: {
    label: "Buss/bane",
    co2PerKm: 59, // Per passenger-km, SSB 2019, see top
    fields: [
      { key: "trips", label: "Antall turer", type: "number" },
      { key: "totalKm", label: "Estimert km (valgfritt)", type: "number", optional: true },
      { key: "totalCost", label: "Totalt betalt (kr)", type: "number" },
    ],
  },
  fly: {
    label: "Fly (innenriks)",
    co2PerKm: 150, // Per passenger-km, short haul (Avinor/Miljødirektoratet)
    fields: [
      { key: "trips", label: "Antall flyvninger", type: "number" },
      { key: "totalKm", label: "Estimert km", type: "number" },
      { key: "totalCost", label: "Totalt betalt (kr)", type: "number" },
    ],
  },
  egenbil: {
    label: "Egen bil",
    co2PerKm: null, // Beregnes fra valgt drivstofftype
    fields: [
      { key: "totalKm", label: "Totalt km", type: "number" },
      { key: "totalCost", label: "Totalt kostnad (kr)", type: "number", description: "Drivstoff, bompenger, parkering, etc." },
      { key: "fuelType", label: "Drivstoff", type: "select", options: [
        { value: "bensin", label: "Bensin" },
        { value: "diesel", label: "Diesel" },
        { value: "elbil", label: "Elbil" },
      ]},
    ],
  },
  sykkel: {
    label: "Sykkel/gange",
    co2PerKm: 0,
    fields: [
      { key: "totalKm", label: "Estimert km (valgfritt)", type: "number", optional: true },
    ],
  },
};

// CO₂ per km for egen bil, by fuel type
const EGENBIL_CO2 = {
  bensin: 130, // Norwegian fleet average ICE
  diesel: 120,
  elbil: 0,
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Load transport data from browser.storage.local.
 * Returns object keyed by year, e.g. { "2025": { taxi: {...}, buss: {...} } }
 */
export async function loadTransportData(storage) {
  const data = await storage.get(["transportData"]);
  return data.transportData || {};
}

/**
 * Save transport data to browser.storage.local.
 */
export async function saveTransportData(storage, data) {
  await storage.set({ transportData: data });
}

// ---------------------------------------------------------------------------
// Summary calculation (pure function)
// ---------------------------------------------------------------------------

/**
 * Build a transport summary combining bildeling stats with manually entered
 * transport data for a given year.
 *
 * @param {Object} transportData  User-entered data for one year,
 *   e.g. { taxi: { trips: 5, totalKm: 100, totalCost: 2500 }, buss: { trips: 200, totalCost: 8400 } }
 * @param {Object} sharingStats   Bildeling stats: { cost, co2Kg, km, trips }
 * @param {{year?: number, organizationId?: string}} options  Året dataene
 *   gjelder og medlemmets organisasjon, for drosjeutslippet. Uten år regnes
 *   drosje som 0 g/km, som etter kravet.
 * @returns {{ modes: Object, totals: { cost: number, co2Kg: number, km: number } }}
 */
export function transportSummary(transportData, sharingStats, { year, organizationId } = {}) {
  const modes = {};

  // Bildeling is always included when stats are provided
  if (sharingStats) {
    modes.bildeling = {
      cost: sharingStats.cost || 0,
      co2Kg: sharingStats.co2Kg || 0,
      km: sharingStats.km || 0,
      trips: sharingStats.trips || 0,
      label: "Bildeling",
    };
  }

  // Other transport modes are only included when user entered data
  for (const [mode, definition] of Object.entries(TRANSPORT_MODES)) {
    const entry = transportData[mode];
    if (!entry) continue;

    // Check if the entry has any meaningful data
    const hasData = Object.values(entry).some((v) => typeof v === "number" && v > 0);
    if (!hasData) continue;

    const km = entry.totalKm || 0;
    // Egen bil: CO₂ depends on user-selected fuel type
    let co2PerKm = definition.co2PerKm;
    if (mode === "egenbil") {
      co2PerKm = EGENBIL_CO2[entry.fuelType] || EGENBIL_CO2.bensin;
    } else if (mode === "taxi") {
      co2PerKm = year ? taxiCO2PerKm(Number(year), organizationId) : 0;
    }
    const co2Kg = (km * (co2PerKm || 0)) / 1000;

    modes[mode] = {
      cost: entry.totalCost || 0,
      co2Kg,
      km,
      trips: entry.trips || entry.days || 0,
      label: definition.label,
    };
  }

  // Totals across all modes
  const totals = { cost: 0, co2Kg: 0, km: 0 };
  for (const m of Object.values(modes)) {
    totals.cost += m.cost;
    totals.co2Kg += m.co2Kg;
    totals.km += m.km;
  }

  return { modes, totals };
}

// ---------------------------------------------------------------------------
// Methodology note
// ---------------------------------------------------------------------------

export const TRANSPORT_METHOD = {
  note:
    "CO₂-faktorer, bare utslipp fra eksos: " +
    "Taxi 0 g/km etter nullutslippskravet for drosjer (gamle Hordaland fra 1. april 2024, " +
    `Trøndelag fra 1. juli 2025), før det ~${TAXI_CO2_BEFORE_REQUIREMENT} g/km (drosjene i Hordaland 2018, brukt også for Trøndelag), ` +
    "Leiebil ~130 g/km (norsk bilparksnitt), " +
    "Egen bil: bensin ~130, diesel ~120, elbil 0 g/km (Miljødirektoratet), " +
    "Buss ~59 g/km per passasjer (SSB, buss 2019, elbuss og bane gir mindre), " +
    "Fly ~150 g/km per passasjer (Avinor/Miljødirektoratet), " +
    "Sykkel/gange = 0.",
  sources: [
    "Miljødirektoratet: Utslippsfaktorer",
    "Lovdata: miljøkrav til drosjenæringa i Vestland (FOR-2020-03-03-2549, gamle Hordaland fra 01.04.2024, resten av fylket fra 01.04.2026)",
    "Lovdata: miljøkrav til drosjer i Trøndelag (FOR-2021-05-27-1753, krav innen 01.07.2025)",
    "Vestland fylkeskommune: Miljøkrav til drosjenæringa i Vestland, utgreiing, fotnote 11 (mars 2021)",
    "SSB: Mer utslipp for hver kilometer reist, figur 1 (13.12.2021)",
    "Avinor: Innenriks luftfart utslipp",
  ],
};
