/**
 * Transport calculator module.
 *
 * CO₂ factors per transport mode (g/km, passenger) based on Norwegian sources:
 *   - Miljødirektoratet: Utslippsfaktorer
 *   - TØI/Skyss: Kollektivtransport passasjer-km
 *   - Avinor: Innenriks luftfart utslipp
 */

export const TRANSPORT_MODES = {
  taxi: {
    label: "Taxi",
    co2PerKm: 120, // Bergen mix, increasing EV share (Miljødirektoratet)
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
    label: "Buss/bybane",
    co2PerKm: 50, // Per passenger-km, average occupancy (TØI/Skyss)
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
 * @returns {{ modes: Object, totals: { cost: number, co2Kg: number, km: number } }}
 */
export function transportSummary(transportData, sharingStats) {
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
    "CO₂-faktorer: Taxi ~120 g/km (Bergen, blandet flåte), " +
    "Leiebil ~130 g/km (norsk bilparksnitt), " +
    "Egen bil: bensin ~130, diesel ~120, elbil 0 g/km (Miljødirektoratet), " +
    "Buss ~50 g/km per passasjer (TØI/Skyss, gjennomsnittsbelegg), " +
    "Fly ~150 g/km per passasjer (Avinor/Miljødirektoratet), " +
    "Sykkel/gange = 0.",
  sources: [
    "Miljødirektoratet: Utslippsfaktorer",
    "TØI/Skyss: Kollektivtransport passasjer-km",
    "Avinor: Innenriks luftfart utslipp",
  ],
};
