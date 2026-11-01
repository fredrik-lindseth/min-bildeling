#!/bin/bash
# Byggevakt for Bildeleringen Stats: stopper en pakke som inneholder
# persondata, rot fra utviklingen eller endrede vendor-filer.
#
# Bruk: ./stats/scripts/sjekk-pakke.sh <pakke.zip | utpakket mappe>
#
# Exit 0: ren (advarsler kan forekomme). Exit 1: funn. Exit 2: feil bruk.
#
# Funn meldes som fil:linje og navnet på mønsteret, aldri med innholdet
# på linjen, så loggen ikke selv blir en lekkasje.
#
# Private mønstre (navn, adresser, arbeidsgiver) står bare i en fil
# utenfor repoet, aldri her, én utvidet regex per linje, ikke skille på store og små bokstaver:
#   ${BILDELERINGEN_PERSONDATA:-$HOME/.config/bildeleringen/persondata.txt}
#
# vendor/ hoppes over i innholdssjekken fordi den er låst med sjekksummer
# i scripts/vendor.sha256. Ny vendor-versjon: oppdater listen med
#   (cd stats && shasum -a 256 vendor/*) > stats/scripts/vendor.sha256

set -euo pipefail

# Manifestkravene for AMO: data_collection_permissions og
# strict_min_version >= 140. AMO avviser pakken uten dem, så de er feil.
MANIFEST_KRAV_ER_FEIL=1
MIN_GECKO_VERSJON=140

SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_SUMS="$SCRIPTDIR/vendor.sha256"
PRIVAT="${BILDELERINGEN_PERSONDATA:-$HOME/.config/bildeleringen/persondata.txt}"

# Offentlige forekomster som ellers ville slått ut på et privat mønster
# eller UUID-sjekken: lenken til det offentlige repoet, gecko-id-en i
# manifestet (ser ut som en e-postadresse), lisenslinjen og
# de kjente organisasjons-id-ene fra
# dele.no (Bildeleringen og Trondheim Bilkollektiv) og den oppdiktede
# medlemskaps-id-en i demodataene.
TILLATT_SED='s#github\.com/fredrik-lindseth/bildeleringen-stats##g
s#"delebil-statistikk@fredriklindseth\.no"#""#g
s#Copyright \(c\) [0-9]{4} Fredrik##g
s#3212bcbe-8e34-4c28-9439-a44e6d5cf9c0##g
s#8dba8f19-c438-f278-ed7c-912ec6537cb9##g
s#00000000-0000-0000-0000-00000000de40##g'

if [ $# -ne 1 ] || [ ! -e "$1" ]; then
  echo "Bruk: $0 <pakke.zip | utpakket mappe>" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -d "$1" ]; then
  ROOT="$(cd "$1" && pwd)"
else
  ROOT="$TMP/pakke"
  mkdir -p "$ROOT"
  unzip -q "$1" -d "$ROOT"
fi

FUNN=0
ADVARSLER=0
feil() { echo "FEIL: $*" >&2; FUNN=$((FUNN + 1)); }
advar() { echo "ADVARSEL: $*" >&2; ADVARSLER=$((ADVARSLER + 1)); }

# Speil av tekstfilene uten vendor/, med de tillatte forekomstene fjernet.
# Erstatningen skjer innenfor linjen, så linjenumrene stemmer med pakken.
SPEIL="$TMP/speil"
mkdir -p "$SPEIL"
(cd "$ROOT" && find . -type f ! -path './vendor/*') | while IFS= read -r f; do
  if grep -Iq '' "$ROOT/$f" 2>/dev/null || [ ! -s "$ROOT/$f" ]; then
    mkdir -p "$SPEIL/$(dirname "$f")"
    sed -E "$TILLATT_SED" "$ROOT/$f" > "$SPEIL/$f"
  fi
done

# skann <navn> <grep-flagg> <regex>: melder hver treffende linje.
skann() {
  local navn="$1" flagg="$2" regex="$3" linje
  while IFS= read -r linje; do
    feil "${linje#./}: $navn"
  done < <(cd "$SPEIL" && grep -rnI "$flagg" -e "$regex" . 2>/dev/null | cut -d: -f1,2 | sort -u)
}

# 1. Generiske mønstre
skann "e-postadresse" -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
# Åtte sifre i ett ord meldes bare med +47 foran eller et telefonord rett
# før, ellers slår vakten på tall-literaler som 86400000 (ms per døgn).
skann "telefonnummer" -E '(^|[^0-9A-Za-z])\+47 ?[2-9][0-9]{7}([^0-9]|$)'
skann "telefonnummer" -iE '(tlf|telefon|mobil|phone|tel)[.:]? *[2-9][0-9]{7}([^0-9]|$)'
skann "telefonnummer" -E '(^|[^0-9.,_A-Za-z])(\+47 ?)?[2-9][0-9]{2} [0-9]{2} [0-9]{3}([^0-9]|$)'
skann "telefonnummer" -E '(^|[^0-9.,_A-Za-z])(\+47 ?)?[2-9][0-9]( [0-9]{2}){3}([^0-9]|$)'
skann "koordinatpar" -E '-?[0-9]{1,3}\.[0-9]{4,} *, *-?[0-9]{1,3}\.[0-9]{4,}'
skann "koordinat" -iE '(lat|lng|lon|latitude|longitude)["'"'"']? *[:=] *-?[0-9]{1,3}\.[0-9]{4,}'
skann "token (eyJ...)" -E 'eyJ[A-Za-z0-9_-]{10,}'
skann "UUID" -iE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

# 2. Private mønstre utenfor repoet. Meldes med linjenummer i
# mønsterfilen, ikke selve mønsteret.
if [ -f "$PRIVAT" ]; then
  nr=0
  while IFS= read -r m || [ -n "$m" ]; do
    nr=$((nr + 1))
    case "$m" in ''|'#'*) continue ;; esac
    skann "privat mønster nr. $nr" -iE "$m"
  done < "$PRIVAT"
else
  advar "privat mønsterfil mangler ($PRIVAT), sjekker bare de generiske mønstrene"
fi

# 3. Filnavn og pakkehygiene
while IFS= read -r f; do
  f="${f#./}"
  case "$f" in
    */.DS_Store|.DS_Store)        feil "$f: .DS_Store" ;;
    test/*|*/test/*|*.test.js)    feil "$f: testfil" ;;
    *.svg)                        feil "$f: svg-kilde" ;;
    *listing/*)                   feil "$f: listing-materiale" ;;
    *debug*)                      feil "$f: debug-fil" ;;
    *.pdf)                        feil "$f: pdf" ;;
  esac
  case "$(basename "$f")" in
    bildeleringen-*.json) feil "$f: dataeksport (bildeleringen-*.json)" ;;
  esac
done < <(cd "$ROOT" && find . -type f)

# 4. Manifestkrav for AMO
manifest_krav() { if [ "$MANIFEST_KRAV_ER_FEIL" = 1 ]; then feil "$@"; else advar "$@"; fi; }
if [ ! -f "$ROOT/manifest.json" ]; then
  feil "manifest.json mangler i pakken"
else
  grep -q '"data_collection_permissions"' "$ROOT/manifest.json" ||
    manifest_krav "manifest.json: browser_specific_settings.gecko.data_collection_permissions mangler"
  min="$(grep -oE '"strict_min_version" *: *"[0-9]+' "$ROOT/manifest.json" | grep -oE '[0-9]+$' || true)"
  if [ -z "$min" ]; then
    manifest_krav "manifest.json: strict_min_version mangler (må være minst $MIN_GECKO_VERSJON)"
  elif [ "$min" -lt "$MIN_GECKO_VERSJON" ]; then
    manifest_krav "manifest.json: strict_min_version er $min, må være minst $MIN_GECKO_VERSJON"
  fi
fi

# 5. Vendor-sjekksummer
if command -v shasum >/dev/null; then sha() { shasum -a 256 "$@"; }; else sha() { sha256sum "$@"; }; fi
if [ ! -f "$VENDOR_SUMS" ]; then
  feil "sjekksumlisten $VENDOR_SUMS mangler"
else
  while read -r sum fil; do
    [ -n "$fil" ] || continue
    if [ ! -f "$ROOT/$fil" ]; then
      feil "$fil: står i vendor.sha256, men mangler i pakken"
    elif [ "$(sha "$ROOT/$fil" | cut -d' ' -f1)" != "$sum" ]; then
      feil "$fil: sjekksummen stemmer ikke med vendor.sha256"
    fi
  done < "$VENDOR_SUMS"
  while IFS= read -r f; do
    f="${f#./}"
    grep -qE "[[:space:]]\*?$f\$" "$VENDOR_SUMS" || feil "$f: vendor-fil uten sjekksum i vendor.sha256"
  done < <(cd "$ROOT" && find ./vendor -type f 2>/dev/null)
fi

# 6. Farger utenfor :root i CSS. Følger klammedybden, så :root inne i
# @media (prefers-color-scheme: dark) også teller som :root.
while IFS= read -r f; do
  f="${f#./}"
  while IFS= read -r linje; do
    feil "$linje: farge utenfor :root"
  done < <(awk -v fil="$f" '
    {
      linje = $0
      # Fjern kommentarer, også de som går over flere linjer.
      ut = ""
      while (length(linje) > 0) {
        if (ikommentar) {
          i = index(linje, "*/")
          if (i == 0) { linje = ""; break }
          linje = substr(linje, i + 2); ikommentar = 0
        } else {
          i = index(linje, "/*")
          if (i == 0) { ut = ut linje; break }
          ut = ut substr(linje, 1, i - 1); linje = substr(linje, i + 2); ikommentar = 1
        }
      }
      # Del linjen ved klammer. Biten foran { er en selektor (der kan
      # #id se ut som en farge), resten er deklarasjoner.
      bit = ""; flagget = 0
      for (j = 1; j <= length(ut) + 1; j++) {
        c = (j <= length(ut)) ? substr(ut, j, 1) : "\n"
        if (c != "{" && c != "}" && c != "\n") { bit = bit c; continue }
        if (c != "{" && rotdybde == 0 && !flagget && bit ~ /(#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]([0-9a-fA-F]*)?([^0-9a-zA-Z_-]|$)|rgba?\(|hsla?\()/) {
          print fil ":" NR; flagget = 1
        }
        if (c == "{") {
          dybde++
          if (rotdybde == 0 && bit ~ /:root/) rotdybde = dybde
        } else if (c == "}") {
          if (dybde == rotdybde) rotdybde = 0
          dybde--
        }
        bit = ""
      }
    }' "$ROOT/$f")
done < <(cd "$ROOT" && find . -type f -name '*.css' ! -path './vendor/*')

echo "" >&2
if [ "$FUNN" -gt 0 ]; then
  echo "Byggevakten stoppet pakken: $FUNN funn, $ADVARSLER advarsler. Se docs/publisering.md." >&2
  exit 1
fi
echo "Byggevakten: ingen funn, $ADVARSLER advarsler." >&2
