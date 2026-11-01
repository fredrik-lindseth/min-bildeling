// Relay-adressen er brukerens egen backend og står bare i storage, aldri i
// koden. Tilgangen til den gis ved kjøretid gjennom optional_host_permissions,
// så manifestet trenger ikke kjenne vertsnavnet.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

// Ren funksjon: vasker brukerens input og gir match-mønsteret som må
// innvilges. Tom input betyr at relay er av. Kaster med norsk melding ved
// ugyldig adresse, så innstillingssiden kan vise den direkte.
export function parseBackendUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return { url: "", originPattern: null };

  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Ugyldig adresse.");
  }

  const isLocal = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal)) {
    throw new Error("Bruk https. http går bare mot localhost.");
  }
  if (u.username || u.password) {
    throw new Error("Fjern brukernavn og passord fra adressen. Bruk Token-feltet.");
  }
  if (u.search || u.hash) {
    throw new Error("Fjern ? og # fra adressen.");
  }

  const path = u.pathname.replace(/\/+$/, "");
  // Match-mønstre har ikke port, så mønsteret dekker hele verten.
  return { url: `${u.origin}${path}`, originPattern: `${u.protocol}//${u.hostname}/*` };
}

// Mønsteret for en lagret adresse, eller null når den mangler eller er ugyldig.
export function originPatternFor(backendUrl) {
  try {
    return parseBackendUrl(backendUrl).originPattern;
  } catch {
    return null;
  }
}
