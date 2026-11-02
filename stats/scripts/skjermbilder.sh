#!/bin/bash
# Tar skjermbildene til README og AMO-listingen fra demomodus (?demo=1).
#
# Bruk: ./stats/scripts/skjermbilder.sh [--butikk] [utmappe]   (standard: skjermbilder/ i repo-roten)
#
# Til slutt lages butikksettet i <utmappe>/butikk/: hvert bilde skalert ned
# til å passe i 1280x800 og fylt ut til nøyaktig 1280x800 med bakgrunnsfargen
# øverst til venstre. Chrome Web Store krever den størrelsen, og AMO
# tar den. README bruker bildene i full størrelse. Med --butikk lages bare
# butikksettet, fra bildene som alt ligger i utmappen.
#
# Sidene serveres over http fra stats/ på en ledig port og fotograferes med
# hodeløs Firefox, én midlertidig profil for lys og én for mørk modus.
# Firefox sin --screenshot holder ikke: den tar bildet ved load, før
# Chart.js har tegnet diagrammer som lå i skjulte elementer, og den
# fotograferer alltid fra toppen av dokumentet, så #bruksmonster gir feil
# utsnitt. skjermbilde.mjs styrer derfor Firefox over WebDriver BiDi: fast
# viewport, venter på load, fonter og to animasjonsrammer, og tar så bildet.
#
# Demodataene regnes fra dagens dato, så tallene skifter over tid. Utsnitt og
# vindusstørrelser er faste.

set -euo pipefail

STATS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$STATS_DIR/.." && pwd)"
BARE_BUTIKK=0
if [ "${1:-}" = "--butikk" ]; then
  BARE_BUTIKK=1
  shift
fi
OUT_DIR="${1:-$REPO_DIR/skjermbilder}"

lag_butikksett() {
  if ! command -v magick >/dev/null; then
    echo "Butikksettet krever ImageMagick (magick)." >&2
    exit 1
  fi
  local dest="$OUT_DIR/butikk" img name bg
  mkdir -p "$dest"
  echo "Butikksett (1280x800) i $dest:"
  for img in "$OUT_DIR"/*.png; do
    name="$(basename "$img")"
    # Noen piksler inn fra hjørnet: seksjonene kan starte med en 1 px kantlinje.
    bg="$(magick "$img" -format '%[pixel:p{4,4}]' info:)"
    # «>» skalerer bare ned. Små bilder som popupen står i full størrelse.
    # Chrome Web Store vil ha PNG uten alfakanal, derfor -alpha remove/off.
    magick "$img" -resize '1280x800>' -background "$bg" -gravity center \
      -extent 1280x800 -alpha remove -alpha off -strip -define png:exclude-chunks=date,time \
      -define png:compression-level=9 "$dest/$name"
    echo "  $name"
  done
}

if [ "$BARE_BUTIKK" = 1 ]; then
  [ -d "$OUT_DIR" ] || { echo "Fant ikke $OUT_DIR." >&2; exit 1; }
  OUT_DIR="$(cd "$OUT_DIR" && pwd)"
  lag_butikksett
  exit 0
fi

FIREFOX="${FIREFOX:-}"
if [ -z "$FIREFOX" ]; then
  if [ -x /Applications/Firefox.app/Contents/MacOS/firefox ]; then
    FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox
  elif command -v firefox >/dev/null; then
    FIREFOX="$(command -v firefox)"
  else
    echo "Fant ikke Firefox. Sett FIREFOX=/sti/til/firefox." >&2
    exit 1
  fi
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
WORK_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Ledig port: la kjernen velge, slipp den og gi den til http.server.
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
(cd "$STATS_DIR" && exec python3 -m http.server "$PORT" --bind 127.0.0.1) >"$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$PORT"

for _ in $(seq 1 50); do
  curl -sf -o /dev/null "$BASE/dashboard/dashboard.html" && break
  sleep 0.1
done
if ! curl -sf -o /dev/null "$BASE/dashboard/dashboard.html"; then
  echo "http.server svarte ikke på port $PORT:" >&2
  cat "$WORK_DIR/server.log" >&2
  exit 1
fi

# Profilene tvinger fargemodus uavhengig av systemets utseende.
# content-override: 0 = mørk, 1 = lys. Redusert bevegelse slår av myk scroll.
make_profile() {
  local name=$1 dark=$2 override=$3
  local dir="$WORK_DIR/profil-$name"
  mkdir -p "$dir"
  cat >"$dir/user.js" <<EOF
user_pref("ui.systemUsesDarkTheme", $dark);
user_pref("layout.css.prefers-color-scheme.content-override", $override);
user_pref("ui.prefersReducedMotion", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
EOF
}
make_profile lys 0 1
make_profile mork 1 0

RAW_DIR="$WORK_DIR/raa"
mkdir -p "$RAW_DIR"

# shoot <lys|mork> <navn> <bredde>x<høyde> <sti> [...]: én Firefox per modus.
shoot() {
  local mode=$1
  shift
  local args=()
  while [ $# -gt 0 ]; do
    args+=("$1" "$2" "$BASE/$3")
    shift 3
  done
  node "$STATS_DIR/scripts/skjermbilde.mjs" "$FIREFOX" "$WORK_DIR/profil-$mode" "$RAW_DIR" "${args[@]}"
}

D="dashboard/dashboard.html?demo=1"
S="summary/summary.html?demo=1"
for mode in lys mork; do
  shoot "$mode" "popup-$mode" 350x0 "popup/popup.html?demo=1"
done
# Hver seksjon i dashboardet og hvert ark i årsoppsummeringen, så alle
# visningene kan ses uten å installere. Høyde 0 med anker gir hele seksjonen.
# Ankrene står på <section>-ene i dashboard.html og summary.html.
args=()
for section in kostnader bruksmonster bookingmonster kilometer trender \
  bilregnestykket turkategorier klima transport sikkerhetskopi; do
  args+=("seksjon-$section" 1280x0 "$D#$section")
done
shoot lys "${args[@]}"
args=()
for slide in brukt kjort favorittbil travleste spart co2; do
  args+=("oppsummering-$slide" 1280x800 "$S#$slide")
done
shoot mork "${args[@]}"

echo "Skjermbilder i $OUT_DIR:"
for raw in "$RAW_DIR"/*.png; do
  name="$(basename "$raw")"
  # Uten metadata (tidsstempler) blir filen lik fra kjøring til kjøring.
  if command -v magick >/dev/null; then
    magick "$raw" -strip -define png:exclude-chunks=date,time \
      -define png:compression-level=9 "$OUT_DIR/$name"
  else
    cp "$raw" "$OUT_DIR/$name"
  fi
  echo "  $name ($(du -k "$OUT_DIR/$name" | cut -f1) kB)"
done

echo ""
lag_butikksett
