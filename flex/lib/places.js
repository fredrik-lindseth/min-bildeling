// Rene hjelpere for stedsvalg. Ingen browser-API.

// /api/locations gir geojson som Point, LineString eller Polygon. Søket
// trenger ett punkt, så vi tar gjennomsnittet av hjørnene (for en gate:
// omtrent midt på strekningen).
export function representativePoint(geojson) {
  const g = typeof geojson === "string" ? safeParse(geojson) : geojson;
  if (!g || !Array.isArray(g.coordinates)) return null;
  let coords;
  if (g.type === "Point") coords = [g.coordinates];
  else if (g.type === "LineString") coords = g.coordinates;
  else if (g.type === "Polygon") coords = dropClosingPoint(g.coordinates[0] || []);
  else return null;
  const valid = coords.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (!valid.length) return null;
  const lng = valid.reduce((s, c) => s + c[0], 0) / valid.length;
  const lat = valid.reduce((s, c) => s + c[1], 0) / valid.length;
  return { lng, lat };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function dropClosingPoint(ring) {
  if (ring.length < 2) return ring;
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
}

// Stasjonslisten som steder ({ id, name, point }), alfabetisk på norsk.
// Stasjoner uten brukbar geometri droppes.
export function stationPlaces(locations) {
  const list = Array.isArray(locations) ? locations : locations?.content || [];
  return list
    .map((loc) => ({ id: `station:${loc.id}`, name: loc.name, point: representativePoint(loc.geojson) }))
    .filter((p) => p.name && p.point)
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));
}
