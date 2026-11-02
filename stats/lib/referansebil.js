// Den faste bilen bilregnestykket og «Spart i år» sammenligner med. Alle
// forutsetningene står her, med kilde og dato, så blokken kan gås over én
// gang i året. Ingen funksjoner, bare data: ownership-cost.js regner.
//
// Årlig oppdatering:
// 1. Vurder om antatt pris for en vanlig utstyrt bil fortsatt er rimelig.
//    Prisen er et skjønn, ikke en prisliste, så den rundes av.
// 2. Ny OFV-kalkyle (kommer i juni). Finn de to elbileksemplene prisen ligger
//    mellom, ta kolonnen for 10 000 km og interpoler lineært med
//    t = (pris − lav) / (høy − lav). Formelen står ved hver OFV-verdi.
// 3. Trafikkforsikringsavgiften (endres 1. mars) og parkeringsprisene.
// 4. Kjør `cd stats && node --test`. ownership-cost.test.js regner
//    interpolasjonen for hånd og må følge med.

// Kildene vises i «Slik beregnes det» med navn, lenke og dato.
export const SOURCES = {
  ofv: {
    name: "OFV: Kostnader ved bilhold – eksempler på beregning 2026",
    url: "https://kommunikasjon.ntb.no/files/17848801/18952851/322829/no",
    date: "2026-06-16",
  },
  volvoPrice: {
    name: "Elbil24: Volvo EX40 oppgraderes, priser fra Volvo Norge inkl. levering",
    url: "https://www.elbil24.no/nyheter/volvo-ex40-tar-plastisk-kirurgi/85125635",
    date: "2026-09-10",
  },
  naf: {
    name: "NAF: Avgifter og kostnader for bil 2026",
    url: "https://www.naf.no/politikk-og-samfunn/privatokonomi/avgifter-og-kostnader-for-bil-2026",
    date: "2026-10-02", dateLabel: "oppdatert",
  },
  bergen: {
    name: "Bergen kommune: Boligsoneparkering, sone 1–8",
    url: "https://www.bergen.kommune.no/innbyggerhjelpen/trafikk-reiser-vei/vei-transport-og-parkering/parkering/boligsoneparkering",
    date: "2026-10-15", dateLabel: "side oppdatert",
  },
  trondheim: {
    name: "Trondheim kommune: Prisliste, boligsoneparkering",
    url: "https://www.trondheim.kommune.no/parkering/innhold/priser-og-betaling/prisliste/",
    date: "2025-12-31", dateLabel: "side oppdatert",
  },
};

// OFV-verdiene er elbil eksempel 3 (550 000 kr) og 4 (750 000 kr), kolonnen
// for 10 000 km, interpolert med t = (600 000 − 550 000) / 200 000 = 0,25.
// Datagrunnlaget er fra desember 2025 til april 2026.
export const REFERENCE_CAR = {
  checked: "2026-11-02",

  // EX40 er navnet på XC40 Recharge siden februar 2024.
  model: { value: "Volvo EX40", source: "volvoPrice", date: "2026-09-10" },
  // Antatt pris for en vanlig utstyrt bil, avrundet. Ingen bestemt utgave:
  // den billigste koster fra 439 900 kr, men få kjøper den uten tillegg.
  price: { value: 600000, source: "volvoPrice", date: "2026-11-02" },

  // Lavest kjørelengde OFV regner med. Faste poster under gjelder den.
  ofvKmPerYear: { value: 10000, source: "ofv", date: "2026-06-16" },

  // Faste kostnader, kr per år.
  // Post 1, avskrivning over 3 år: 65 741 + t × (94 002 − 65 741).
  depreciation: { value: 72806, source: "ofv", date: "2026-06-16" },
  // Post 3, ansvar + kasko, 75 % bonus, snitt for Oslo-området:
  // 3 228 − t × 177 = 3 184 og 11 720 + t × 1 798 = 12 170.
  insurance: { value: 15354, source: "ofv", date: "2026-06-16" },
  // Elbil 9,16 kr/dag fra 01.03.2026, 365 dager. Samme tall i OFV.
  trafficInsuranceTax: { value: 3343, source: "naf", date: "2026-10-02" },
  // Post 5 vedlikehold (vask, rustbeskyttelse) + post 9 service:
  // 7 687 i begge eksemplene og 3 694 + t × 414 = 3 798.
  maintenance: { value: 11485, source: "ofv", date: "2026-06-16" },

  // Variable kostnader, skaleres med kjørte km.
  // Post 8 dekk, 37 000 km levetid og to hjulskift: 0,502 + t × 0,113 kr/km.
  tyresPerKm: { value: 0.53, source: "ofv", date: "2026-06-16" },
  // Forbruk 1,68 + t × 0,15 kWh/mil.
  kWhPerKm: { value: 0.172, source: "ofv", date: "2026-06-16" },
  // 80 % hjemmelading med Norgespris inkl. nettleie og avgifter.
  homeChargingKrPerKWh: { value: 1.05, source: "ofv", date: "2026-06-16" },
  // 20 % hurtiglading, OFVs prisreferanse per mai 2026.
  fastChargingKrPerKWh: { value: 5.47, source: "ofv", date: "2026-06-16" },
  fastChargingShare: { value: 0.2, source: "ofv", date: "2026-06-16" },

  // OFV tar ikke med parkering. Boligsoneparkering for bil 1 i byen der
  // medlemmets bilkollektiv holder til, etter organizationId (se
  // docs/api/README.md). Ukjent organisasjon regnes som Bergen, der flest
  // av bilene står.
  parking: {
    "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0": {
      organization: "Bildeleringen", city: "Bergen", zone: "sone 1–8", perMonth: 582, source: "bergen", date: "2026-10-15",
    },
    "8dba8f19-c438-f278-ed7c-912ec6537cb9": {
      organization: "Trondheim Bilkollektiv", city: "Trondheim", perMonth: 785, source: "trondheim", date: "2025-12-31",
    },
  },
  defaultParkingOrganization: "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0",
};
