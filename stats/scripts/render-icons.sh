#!/bin/bash
# Rendrer ikonene fra SVG-kildene i icons/.
# Bruk: ./scripts/render-icons.sh
#
# icon.svg er for lyse verktøylinjer, icon-dark.svg for mørke. PNG-ene sjekkes
# inn, så scriptet trengs bare når SVG-ene endres. 256 px-versjonen er til
# AMO-listingen og ligger i icons/listing/, som package.sh holder utenfor zip-en.

set -euo pipefail

# Kjør alltid fra stats/-rota (skriptet ligger i stats/scripts/)
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Fant ikke rsvg-convert. Installer librsvg (brew install librsvg)." >&2
  exit 1
fi

SIZES=(16 32 48 96 128)

for variant in icon icon-dark; do
  src="icons/${variant}.svg"
  for size in "${SIZES[@]}"; do
    rsvg-convert --width "$size" --height "$size" "$src" --output "icons/${variant}-${size}.png"
  done
done

mkdir -p icons/listing
rsvg-convert --width 256 --height 256 icons/icon.svg --output icons/listing/icon-256.png

echo "Rendret ${#SIZES[@]} størrelser i lys og mørk variant, pluss icons/listing/icon-256.png."
