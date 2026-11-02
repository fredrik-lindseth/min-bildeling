#!/bin/bash
# Validerer de ferdige pakkene slik butikkene ser dem.
#
# Firefox: Mozillas addons-linter, samme regler som AMO-validatoren.
# Feil stopper alltid. Advarsler stopper med mindre de står i TILLATT under.
# Chrome: ingen offentlig validator finnes, så scripts/sjekk-chrome.mjs
# laster stats/dist/chrome/ i hodeløs Chrome og feiler på alt Chrome melder.
#
# Bruk: ./stats/scripts/valider.sh (etter package.sh)
#
# addons-linter hentes med npx første gang og trenger nett da.

set -euo pipefail

cd "$(dirname "$0")/.."

ADDONS_LINTER="addons-linter@10.15.0"
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
export CHROME_BIN

# Advarsler vi godtar, som fil|kode, med grunnen over hver linje.
# Ny linje her krever en grunn som tåler at AMO-revieweren leser den.
TILLATT=(
  # html2canvas bygger klonen av siden med innerHTML. Tredjepartsfil,
  # låst med sjekksum i scripts/vendor.sha256, så vi retter den ikke.
  "vendor/html2canvas.min.js|UNSAFE_VAR_ASSIGNMENT"
)

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
ZIP="dist/min-bildeling-firefox-v${VERSION}.zip"
CHROME_DIR="dist/chrome"

for f in "$ZIP" "$CHROME_DIR/manifest.json"; do
  if [ ! -e "$f" ]; then
    echo "Fant ikke stats/$f. Kjør ./stats/scripts/package.sh først." >&2
    exit 2
  fi
done
if ! command -v npx >/dev/null; then
  echo "npx mangler. Installer Node (med npm), eller pakk med --uten-validering." >&2
  exit 2
fi
if [ ! -x "$CHROME_BIN" ]; then
  echo "Fant ikke Chrome på $CHROME_BIN. Installer Google Chrome, sett CHROME_BIN, eller pakk med --uten-validering." >&2
  exit 2
fi

FEIL=0

echo "Firefox: $ADDONS_LINTER på $ZIP"
RAPPORT="$(mktemp)"
trap 'rm -f "$RAPPORT"' EXIT
# Exit-koden fra linteren er ikke nok alene: advarsler gir 0. JSON-en avgjør.
npx -y "$ADDONS_LINTER" --output json "$ZIP" > "$RAPPORT" 2>/dev/null || true
if ! node -e '
  const [rapport, ...tillatt] = process.argv.slice(1);
  let r;
  try {
    r = JSON.parse(require("node:fs").readFileSync(rapport, "utf8"));
  } catch {
    console.error("  addons-linter ga ikke JSON. Kjør npx -y addons-linter@10.15.0 for hånd for å se feilen.");
    process.exit(1);
  }
  const ok = new Set(tillatt);
  const { errors, warnings, notices } = r;
  console.log(`  ${errors.length} feil, ${warnings.length} advarsler, ${notices.length} merknader`);
  let stopp = errors.length;
  const vis = (type, m, merke) =>
    console.log(`  ${type} ${m.file ?? "-"}:${m.line ?? "-"}  ${m.code}  ${m.message}${merke}`);
  for (const m of errors) vis("feil    ", m, "");
  for (const m of warnings) {
    const godtatt = ok.has(`${m.file}|${m.code}`);
    if (!godtatt) stopp++;
    vis("advarsel", m, godtatt ? "  (godtatt)" : "");
  }
  for (const m of notices) vis("merknad ", m, "");
  process.exit(stopp > 0 ? 1 : 0);
' "$RAPPORT" "${TILLATT[@]}"; then
  echo "Firefox-pakken stoppet: feil, eller advarsler som ikke er godtatt i valider.sh." >&2
  FEIL=1
fi

echo ""
if ! node scripts/sjekk-chrome.mjs "$CHROME_DIR"; then
  FEIL=1
fi

echo ""
if [ "$FEIL" -ne 0 ]; then
  echo "Valideringen feilet. Rett funnene over og pakk på nytt." >&2
  exit 1
fi
echo "Valideringen: begge pakkene er godkjent."
