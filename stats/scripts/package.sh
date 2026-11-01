#!/bin/bash
# Build a distributable .zip for Bildeleringen Stats
# Usage: ./scripts/package.sh

set -e

# Kjør alltid fra stats/-rota (skriptet ligger i stats/scripts/)
cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
OUTDIR="dist"
ZIPNAME="bildeleringen-stats-v${VERSION}.zip"

echo "Packaging Bildeleringen Stats v${VERSION}..."

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

# Kontrastbrudd stopper pakkingen før noe bygges. dist/ er tømt først, så en
# gammel zip ikke blir liggende og ser gyldig ut.
if ! ./scripts/kontrast.sh; then
  echo "" >&2
  echo "Kontrastsjekken feilet. Rett fargene over og pakk på nytt." >&2
  exit 1
fi
echo ""

# Files to include in the release
cp ../LICENSE ../README.md .
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
  README.md \
  -x "*.DS_Store" \
  -x "icons/listing/*" \
  -x "icons/*.svg" \
  -x "*debug*"
rm -f LICENSE README.md

echo ""
if ! ./scripts/sjekk-pakke.sh "$OUTDIR/$ZIPNAME"; then
  rm -f "$OUTDIR/$ZIPNAME"
  echo "" >&2
  echo "Pakken er slettet. Rett funnene over og pakk på nytt." >&2
  exit 1
fi

echo ""
echo "Created: $OUTDIR/$ZIPNAME"
echo "Size: $(du -h "$OUTDIR/$ZIPNAME" | cut -f1)"
echo ""
echo "Install instructions:"
echo "  Firefox: about:debugging → Load Temporary Add-on → select zip or manifest.json"
echo "  Chrome:  Unzip → chrome://extensions → Developer mode → Load unpacked"
