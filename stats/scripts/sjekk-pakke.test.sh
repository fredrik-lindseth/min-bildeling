#!/bin/bash
# Negativ test for byggevakten: planter persondata og rot i kopier og
# viser at sjekk-pakke.sh slår til med fil og linje, og at den er stille
# på en ren pakke.
#
# Bruk: ./stats/scripts/sjekk-pakke.test.sh

set -euo pipefail

SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
STATS="$(cd "$SCRIPTDIR/.." && pwd)"
REPO="$(cd "$STATS/.." && pwd)"
VAKT="$SCRIPTDIR/sjekk-pakke.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Testen skal ikke avhenge av utviklerens private mønsterfil.
# Oppdiktede strenger: et sted, et navn og en arbeidsgiver.
printf '# testmønstre\nhemmeligvei\nkari testesen\neksempelfirma\\.test\n' > "$TMP/persondata.txt"
export BILDELERINGEN_PERSONDATA="$TMP/persondata.txt"

FEILET=0
ok()   { echo "ok   $1"; }
ikke() { echo "FEIL $1"; FEILET=1; }

# Liten, ren pakke med ekte vendor-filer, så testen ikke faller på
# uavhengige feil i resten av koden.
ren_pakke() {
  local d="$1"
  mkdir -p "$d/lib" "$d/vendor"
  cp "$STATS"/vendor/* "$d/vendor/"
  cat > "$d/manifest.json" <<'EOF'
{
  "manifest_version": 3,
  "browser_specific_settings": {
    "gecko": {
      "id": "test@extension",
      "strict_min_version": "140.0",
      "data_collection_permissions": { "required": ["none"] }
    }
  }
}
EOF
  printf 'export const ORG = "3212bcbe-8e34-4c28-9439-a44e6d5cf9c0";\nexport const dag = 24 * 60 * 60 * 1000;\nexport const DAG_MS = 86400000;\n' > "$d/lib/a.js"
  printf 'export const pris = 3.5;\n' > "$d/lib/b.js"
  cat > "$d/lib/stil.css" <<'EOF'
:root {
  --c: #fff;
}
@media (prefers-color-scheme: dark) {
  :root { --c: rgba(0, 0, 0, 0.5); }
}
a:hover {
  color: var(--c); /* ikke #000 her */
}
EOF
}

# forvent_funn <beskrivelse> <mappe> <tekst som skal stå i utdata>
forvent_funn() {
  local navn="$1" dir="$2" tekst="$3" ut kode=0
  ut="$("$VAKT" "$dir" 2>&1)" || kode=$?
  if [ "$kode" -eq 1 ] && printf '%s' "$ut" | grep -qF -- "$tekst"; then
    ok "$navn"
  else
    ikke "$navn (exit $kode, ventet «$tekst»)"
    printf '%s\n' "$ut" | sed 's/^/     /'
  fi
}

# Hver sak får sin egen kopi av den rene pakken.
sak() { rm -rf "$TMP/sak"; cp -R "$TMP/ren" "$TMP/sak"; }

ren_pakke "$TMP/ren"
ut="$("$VAKT" "$TMP/ren" 2>&1)" && kode=0 || kode=$?
if [ "$kode" -eq 0 ] && ! printf '%s' "$ut" | grep -q 'ADVARSEL'; then
  ok "ren pakke gir ingen funn og ingen advarsler"
else
  ikke "ren pakke (exit $kode)"; printf '%s\n' "$ut" | sed 's/^/     /'
fi

sak; printf 'const x = 1;\nconst kontakt = "kontakt@example.com";\n' >> "$TMP/sak/lib/b.js"
forvent_funn "e-post" "$TMP/sak" "lib/b.js:3: e-postadresse"

sak; printf 'const hjem = [60.38912, 5.33241];\n' >> "$TMP/sak/lib/a.js"
forvent_funn "koordinatpar" "$TMP/sak" "lib/a.js:4: koordinatpar"

sak; printf 'const p = { lat: 60.3891 };\n' >> "$TMP/sak/lib/a.js"
forvent_funn "koordinat med nøkkel" "$TMP/sak" "lib/a.js:4: koordinat"

sak; printf 'const tlf = "+47 912 34 567";\n' >> "$TMP/sak/lib/b.js"
forvent_funn "telefonnummer" "$TMP/sak" "lib/b.js:2: telefonnummer"

sak; printf '<p>Tlf: 91234567</p>\n' > "$TMP/sak/side.html"
forvent_funn "telefonnummer med telefonord" "$TMP/sak" "side.html:1: telefonnummer"

sak; printf 'const t = "eyJhbGciOiJIUzI1NiJ9.abc";\n' >> "$TMP/sak/lib/b.js"
forvent_funn "token" "$TMP/sak" "lib/b.js:2: token"

sak; printf 'const m = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";\n' >> "$TMP/sak/lib/b.js"
forvent_funn "ukjent UUID" "$TMP/sak" "lib/b.js:2: UUID"

sak; printf 'const sted = "Hemmeligvei 3";\n' >> "$TMP/sak/lib/b.js"
forvent_funn "privat mønster (sted)" "$TMP/sak" "lib/b.js:2: privat mønster nr. 2"

sak; printf '// Laget av Kari Testesen\n' >> "$TMP/sak/lib/b.js"
forvent_funn "privat mønster (navn)" "$TMP/sak" "lib/b.js:2: privat mønster nr. 3"

sak; printf '<p>Jobber i Eksempelfirma.test</p>\n' > "$TMP/sak/side.html"
forvent_funn "privat mønster (arbeidsgiver)" "$TMP/sak" "side.html:1: privat mønster nr. 4"

sak; echo '[]' > "$TMP/sak/bildeleringen-eksport.json"
forvent_funn "dataeksport" "$TMP/sak" "bildeleringen-eksport.json: dataeksport"

sak; touch "$TMP/sak/lib/.DS_Store"
forvent_funn ".DS_Store" "$TMP/sak" "lib/.DS_Store: .DS_Store"

sak; mkdir -p "$TMP/sak/test"; echo 'x' > "$TMP/sak/test/a.test.js"
forvent_funn "testfil" "$TMP/sak" "test/a.test.js: testfil"

sak; echo '<svg/>' > "$TMP/sak/ikon.svg"
forvent_funn "svg" "$TMP/sak" "ikon.svg: svg-kilde"

sak; mkdir -p "$TMP/sak/icons/listing"; echo 'x' > "$TMP/sak/icons/listing/a.png"
forvent_funn "listing" "$TMP/sak" "icons/listing/a.png: listing-materiale"

sak; echo '/* smuglet */' >> "$TMP/sak/vendor/chart.min.js"
forvent_funn "endret vendor-fil" "$TMP/sak" "vendor/chart.min.js: sjekksummen stemmer ikke"

sak; echo 'x' > "$TMP/sak/vendor/ny.js"
forvent_funn "ukjent vendor-fil" "$TMP/sak" "vendor/ny.js: vendor-fil uten sjekksum"

sak; printf '.knapp {\n  color: #fff;\n}\n' >> "$TMP/sak/lib/stil.css"
forvent_funn "farge utenfor :root" "$TMP/sak" "lib/stil.css:11: farge utenfor :root"

sak; sed -i.bak '/data_collection_permissions/d; s/"140.0",/"140.0"/' "$TMP/sak/manifest.json"; rm "$TMP/sak/manifest.json.bak"
forvent_funn "manifest uten data_collection_permissions" "$TMP/sak" "data_collection_permissions mangler"

sak; sed -i.bak 's/"140.0"/"128.0"/' "$TMP/sak/manifest.json"; rm "$TMP/sak/manifest.json.bak"
forvent_funn "for lav strict_min_version" "$TMP/sak" "strict_min_version er 128"

# Ende til ende: package.sh på en kopi av repoet med plantet persondata
# skal stoppe og slette zip-en.
mkdir -p "$TMP/repo"
cp "$REPO/LICENSE" "$TMP/repo/"
cp -R "$STATS" "$TMP/repo/stats"
rm -rf "$TMP/repo/stats/dist"
printf '\nconst kontakt = "kontakt@example.com";\n' >> "$TMP/repo/stats/lib/stats.js"
linje="$(wc -l < "$TMP/repo/stats/lib/stats.js" | tr -d ' ')"
kode=0
ut="$("$TMP/repo/stats/scripts/package.sh" 2>&1)" || kode=$?
if [ "$kode" -ne 0 ] && printf '%s' "$ut" | grep -qF "lib/stats.js:$linje: e-postadresse" &&
   [ -z "$(ls -A "$TMP/repo/stats/dist" 2>/dev/null)" ]; then
  ok "package.sh stopper og sletter zip-en"
else
  ikke "package.sh ende til ende (exit $kode)"; printf '%s\n' "$ut" | tail -20 | sed 's/^/     /'
fi

echo ""
if [ "$FEILET" -ne 0 ]; then
  echo "Byggevakt-testen feilet." >&2
  exit 1
fi
echo "Byggevakt-testen er grønn."
