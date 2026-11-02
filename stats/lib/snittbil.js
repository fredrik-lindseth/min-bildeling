// Gjennomsnittsbilen som Klima sammenligner bildelingen med, og snittet
// «CO₂ spart» regnes mot. Alle tallene står her, med kilde og dato, så
// blokken kan gås over én gang i året. Ingen funksjoner, bare data: co2.js
// regner.
//
// Årlig oppdatering:
// 1. Utslippet kommer i SSB-tabell 13931 med novemberslippet. Spør
//    POST https://data.ssb.no/api/v0/no/table/13931 med UtslpTilLuft 5.1
//    (Personbiler), UtslpEnergivare VT0, UtslpKomp K11 (CO2), ContentsCode
//    Utslipp (1 000 tonn) og Tid top 3. Personbilraden for et nytt år finnes
//    først når novemberslippet er ute.
// 2. Kjørelengden står i SSB-tabell 12575. Spør
//    POST https://data.ssb.no/api/v0/no/table/12575 med Kjoretoytype 20
//    (Personbiler) og 15 (Personbiler i alt), Alder Ialt og ContentsCode
//    GjsnittKjorelengde (km per bil) og Kjorelengde (mill. km).
// 3. Bruk siste år som finnes i begge tabellene, og bytt year, verdiene og
//    datoene under samlet. Kjør `cd stats && node --test`.

// Kildene vises i «Slik beregnes det» med navn, lenke og dato.
export const SOURCES = {
  ssbKjorelengde: {
    name: "SSB: Kjørelengder, etter kjøretøytype (tabell 12575), personbiler",
    url: "https://www.ssb.no/statbank/table/12575",
    date: "2026-04-08",
  },
  ssbUtslipp: {
    name: "SSB: Klimagasser etter kilde (tabell 13931), veitrafikk, personbiler",
    url: "https://www.ssb.no/statbank/table/13931",
    date: "2026-06-04",
  },
};

// Utslippsregnskapets personbiler er en tolkning: de dekker trolig alle
// personbiler, også drosjer, så g/km deler på «Personbiler i alt». Km per
// bil er «Personbiler», som er det et medlem ellers ville eid. Forskjellen
// mellom de to radene er under avrundingen.
export const AVERAGE_CAR = {
  checked: "2026-11-02",
  year: 2024,
  // «Personbiler», alder i alt.
  kmPerCar: { value: 11205, source: "ssbKjorelengde", date: "2026-04-08" },
  // «Personbiler i alt», alder i alt.
  totalMillionKm: { value: 35442.9, source: "ssbKjorelengde", date: "2026-04-08" },
  // 5.1 Personbiler, CO2, 1 000 tonn. Fossil CO₂ fra solgt drivstoff, så
  // elbilene trekker snittet ned.
  co2Kilotonnes: { value: 3280, source: "ssbUtslipp", date: "2026-06-04" },
};
