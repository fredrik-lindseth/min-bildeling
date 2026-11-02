#!/bin/bash
# Rendrer promobildet til Chrome Web Store fra icons/listing/promo.svg.
# Bruk: ./scripts/render-promo.sh
#
# PNG-en sjekkes inn, så scriptet trengs bare når SVG-en endres. Teksten
# tegnes med Helvetica Neue, som finnes på macOS. Andre maskiner faller
# tilbake til en annen font og gir et litt annet bilde. Chrome Web Store
# vil ha PNG uten alfakanal, derfor flates bildet med ImageMagick etterpå.

set -euo pipefail

# Kjør alltid fra stats/-roten (skriptet ligger i stats/scripts/)
cd "$(dirname "$0")/.."

for tool in rsvg-convert magick; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Fant ikke $tool. Installer librsvg og imagemagick (brew install librsvg imagemagick)." >&2
    exit 1
  fi
done

out=icons/listing/promo-440x280.png
rsvg-convert --width 440 --height 280 icons/listing/promo.svg |
  magick - -alpha remove -alpha off -strip -define png:exclude-chunks=date,time \
    -define png:compression-level=9 "$out"

echo "Rendret $out."
