#!/bin/bash
# Bygger zip-ene til Min bildeling: én for Firefox (AMO) og én for
# Chrome Web Store. Chrome-pakken er de samme filene med et manifest uten
# Firefox-nøklene, laget av scripts/chrome-manifest.mjs.
# Bruk: ./scripts/package.sh

set -e

# Kjør alltid fra stats/-rota (skriptet ligger i stats/scripts/)
cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
OUTDIR="dist"
ZIPNAME="min-bildeling-v${VERSION}.zip"
CHROME_ZIPNAME="min-bildeling-chrome-v${VERSION}.zip"
# Utpakket Chrome-utgave, til «Last inn upakket» på chrome://extensions.
CHROME_DIR="$OUTDIR/chrome"

echo "Packaging Min bildeling v${VERSION}..."

# Signerte xpi-er fra AMO kan ikke bygges på nytt, så de blir liggende.
mkdir -p "$OUTDIR"
find "$OUTDIR" -mindepth 1 -maxdepth 1 ! -name '*-signert.xpi' -exec rm -rf {} +

# Kontrastbrudd stopper pakkingen før noe bygges. dist/ er tømt først, så en
# gammel zip ikke blir liggende og ser gyldig ut.
if ! ./scripts/kontrast.sh; then
  echo "" >&2
  echo "Kontrastsjekken feilet. Rett fargene over og pakk på nytt." >&2
  exit 1
fi
echo ""

# Stilreglene fra docs/design.md: farger bare i lib/tokens.css, ingen
# skygger, ett hjørne og ingen !important.
if ! ./scripts/sjekk-stil.sh; then
  echo "" >&2
  echo "Stilsjekken feilet. Rett bruddene over og pakk på nytt." >&2
  exit 1
fi
echo ""

# Files to include in the release
# README er ikke med: den viser skjermbilder fra repoet, som ikke er i pakken.
cp ../LICENSE .
zip -r "$OUTDIR/$ZIPNAME" \
  manifest.json \
  background.js \
  content.js \
  popup/ \
  dashboard/ \
  summary/ \
  lib/ \
  vendor/ \
  icons/ \
  LICENSE \
  -x "*.DS_Store" \
  -x "icons/listing/*" \
  -x "icons/*.svg" \
  -x "*debug*"
rm -f LICENSE

echo ""
if ! ./scripts/sjekk-pakke.sh "$OUTDIR/$ZIPNAME"; then
  rm -f "$OUTDIR/$ZIPNAME"
  echo "" >&2
  echo "Pakken er slettet. Rett funnene over og pakk på nytt." >&2
  exit 1
fi

# Chrome: pakk ut Firefox-zip-en, bytt manifestet og pakk på nytt, så
# filutvalget står ett sted.
mkdir -p "$CHROME_DIR"
unzip -q "$OUTDIR/$ZIPNAME" -d "$CHROME_DIR"
node scripts/chrome-manifest.mjs manifest.json "$CHROME_DIR/manifest.json"
(cd "$CHROME_DIR" && zip -qr "../$CHROME_ZIPNAME" .)

echo ""
if ! ./scripts/sjekk-pakke.sh --chrome "$OUTDIR/$CHROME_ZIPNAME"; then
  find "${OUTDIR:?}" -mindepth 1 -maxdepth 1 ! -name '*-signert.xpi' -exec rm -rf {} +
  echo "" >&2
  echo "Pakkene er slettet. Rett funnene over og pakk på nytt." >&2
  exit 1
fi

echo ""
for z in "$ZIPNAME" "$CHROME_ZIPNAME"; do
  echo "Laget $OUTDIR/$z ($(du -h "$OUTDIR/$z" | cut -f1))"
done
echo ""
echo "Prøv dem:"
echo "  Firefox: about:debugging, «Last inn midlertidig tillegg», velg Firefox-zip-en"
echo "  Chrome:  chrome://extensions, Utviklermodus, «Last inn upakket», velg stats/$CHROME_DIR"
