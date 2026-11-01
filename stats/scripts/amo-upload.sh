#!/bin/bash
# Sender Bildeleringen Stats til addons.mozilla.org som unlisted, så
# Mozilla signerer den. Bruker AMO-API-et v5 med curl, openssl, jq og
# node (bare innebygd crypto), uten web-ext og npm.
#
# Bruk: ./stats/scripts/amo-upload.sh [--yes]
#
# Nøklene hentes fra addons.mozilla.org/developers/addon/api/key/ og
# leses fra miljøet, aldri fra en fil i repoet:
#   AMO_JWT_ISSUER   «JWT-utsteder» (user:12345:67)
#   AMO_JWT_SECRET   «JWT-hemmelighet»
#   AMO_API          valgfri, standard https://addons.mozilla.org
#   AMO_ENV          valgfri, standard ~/.config/bildeleringen/amo.env
# Står ikke nøklene i miljøet, leses AMO_ENV, med én NAVN=verdi per linje
# uten export. Filen skal bare være lesbar for eieren (chmod 600).
#
# Uten --yes er det en tørrkjøring: pakken bygges og sjekkes, og finnes
# nøklene, sjekkes de mot /api/v5/accounts/profile/. Ingenting lastes opp.
#
# Med --yes: last opp zip-en, vent til AMO har validert den, opprett
# tillegget første gang og ellers en ny versjon, vent på signeringen og last
# ned den signerte xpi-en til stats/dist/.

set -euo pipefail

YES=0
case "${1:-}" in
  --yes) YES=1 ;;
  "") ;;
  *) echo "Bruk: $0 [--yes]" >&2; exit 2 ;;
esac

for verktoy in curl openssl jq node; do
  command -v "$verktoy" >/dev/null || { echo "Stopper: $verktoy mangler" >&2; exit 1; }
done

STATS="$(cd "$(dirname "$0")/.." && pwd)"

# Nøkkelfilen leses bare når miljøet mangler nøklene. Innholdet skrives
# aldri ut: set -a eksporterer det rett inn i miljøet.
NOKKELFIL="${AMO_ENV:-$HOME/.config/bildeleringen/amo.env}"
if { [ -z "${AMO_JWT_ISSUER:-}" ] || [ -z "${AMO_JWT_SECRET:-}" ]; } && [ -f "$NOKKELFIL" ]; then
  if [ -n "$(find "$NOKKELFIL" -perm +077 2>/dev/null || find "$NOKKELFIL" -perm /077 2>/dev/null)" ]; then
    echo "Advarsel: $NOKKELFIL kan leses av andre enn eieren, kjør chmod 600 på den" >&2
  fi
  set -a
  # shellcheck disable=SC1090
  . "$NOKKELFIL"
  set +a
  echo "Nøkler: lest fra $NOKKELFIL"
fi

API="${AMO_API:-https://addons.mozilla.org}/api/v5"
GUID="$(jq -r '.browser_specific_settings.gecko.id' "$STATS/manifest.json")"
VERSION="$(jq -r '.version' "$STATS/manifest.json")"
ZIP="$STATS/dist/bildeleringen-stats-v${VERSION}.zip"
XPI="$STATS/dist/bildeleringen-stats-v${VERSION}-signert.xpi"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Ny JWT per kall: AMO godtar høyst fem minutter mellom iat og exp, og
# polling kan ta lenger enn det. Signaturen lages i node, som leser
# hemmeligheten fra miljøet, så den aldri står i argv og dermed i ps.
jwt() {
  local iat header payload signatur
  iat="$(date +%s)"
  header="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
  payload="$(jq -cnj --arg iss "$AMO_JWT_ISSUER" --arg jti "$(openssl rand -hex 16)" \
    --argjson iat "$iat" '{iss: $iss, jti: $jti, iat: $iat, exp: ($iat + 240)}' | b64url)"
  signatur="$(printf '%s.%s' "$header" "$payload" | node -e '
    const { createHmac } = require("node:crypto");
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(createHmac("sha256", process.env.AMO_JWT_SECRET).update(data).digest("base64url"));
    });
  ')"
  printf '%s.%s.%s' "$header" "$payload" "$signatur"
}

# amo <metode> <sti> [curl-argumenter...]: skriver svaret til stdout og
# HTTP-koden til $TMP/kode. Tokenet går via en fil, ikke argv.
amo() {
  local metode="$1" sti="$2"; shift 2
  printf 'Authorization: JWT %s\n' "$(jwt)" > "$TMP/auth"
  curl -sS -X "$metode" -H @"$TMP/auth" -o "$TMP/svar" -w '%{http_code}' "$@" "$API$sti" > "$TMP/kode"
  cat "$TMP/svar"
}
kode() { cat "$TMP/kode"; }

echo "AMO-innsending av Bildeleringen Stats v${VERSION} (${GUID}), unlisted"
echo ""

"$STATS/scripts/package.sh" >/dev/null
[ -f "$ZIP" ] || { echo "Stopper: fant ikke $ZIP etter pakking" >&2; exit 1; }
echo "Pakke: $ZIP ($(du -h "$ZIP" | cut -f1))"

if [ -z "${AMO_JWT_ISSUER:-}" ] || [ -z "${AMO_JWT_SECRET:-}" ]; then
  if [ "$YES" -eq 1 ]; then
    echo "Stopper: AMO_JWT_ISSUER og AMO_JWT_SECRET må være satt" >&2; exit 1
  fi
  echo "Nøkler: AMO_JWT_ISSUER og AMO_JWT_SECRET er ikke satt (verken i miljøet eller i $NOKKELFIL), hopper over kontosjekken"
else
  profil="$(amo GET /accounts/profile/)"
  [ "$(kode)" = 200 ] || { echo "Stopper: nøklene ble avvist (HTTP $(kode))" >&2; exit 1; }
  echo "Nøkler: gyldige for $(printf '%s' "$profil" | jq -r '.name // .username')"
  amo GET "/addons/addon/${GUID}/" >/dev/null
  case "$(kode)" in
    200) echo "Tillegget finnes på AMO, ny versjon legges til" ;;
    401|403|404) echo "Tillegget finnes ikke på AMO ennå (eller tilhører en annen konto), det opprettes" ;;
    *) echo "Stopper: uventet svar på oppslag av tillegget (HTTP $(kode))" >&2; exit 1 ;;
  esac
fi

if [ "$YES" -eq 0 ]; then
  echo ""
  echo "Tørrkjøring. Med --yes ville dette skjedd:"
  echo "  POST $API/addons/upload/  (upload=zip, channel=unlisted)"
  echo "  GET  $API/addons/upload/<uuid>/  til processed er true og valid er true"
  echo "  PUT  $API/addons/addon/${GUID}/  (nytt tillegg eller ny versjon, lisens MIT)"
  echo "  GET  versjonen til filen er signert, og last den ned til $XPI"
  exit 0
fi

echo ""
echo "Laster opp..."
opplasting="$(amo POST /addons/upload/ -F "upload=@${ZIP}" -F "channel=unlisted")"
[ "$(kode)" = 201 ] || { echo "Stopper: opplastingen feilet (HTTP $(kode)): $opplasting" >&2; exit 1; }
UUID="$(printf '%s' "$opplasting" | jq -r '.uuid')"
echo "  uuid $UUID"

echo "Venter på validering..."
for _ in $(seq 1 60); do
  status="$(amo GET "/addons/upload/${UUID}/")"
  [ "$(kode)" = 200 ] || { echo "Stopper: HTTP $(kode) ved polling" >&2; exit 1; }
  [ "$(printf '%s' "$status" | jq -r '.processed')" = true ] && break
  sleep 5
done
if [ "$(printf '%s' "$status" | jq -r '.processed')" != true ]; then
  echo "Stopper: AMO ble ikke ferdig med valideringen på fem minutter (uuid $UUID)" >&2; exit 1
fi
if [ "$(printf '%s' "$status" | jq -r '.valid')" != true ]; then
  echo "Stopper: AMO avviste pakken:" >&2
  printf '%s' "$status" | jq '.validation.messages[]? | {type, message, file}' >&2
  exit 1
fi
echo "  gyldig ($(printf '%s' "$status" | jq -r '.validation.warnings // 0') advarsler)"

# PUT på gecko-id-en oppretter tillegget første gang og legger ellers til
# en ny versjon, så samme kall dekker begge.
echo "Oppretter versjonen..."
svar="$(amo PUT "/addons/addon/${GUID}/" -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg u "$UUID" '{version: {upload: $u, license: "MIT"}}')")"
case "$(kode)" in
  200|201|202) ;;
  *) echo "Stopper: versjonen ble ikke opprettet (HTTP $(kode)): $svar" >&2; exit 1 ;;
esac
echo "  versjon $VERSION opprettet som unlisted"

echo "Venter på signering (opptil ti minutter)..."
for _ in $(seq 1 60); do
  v="$(amo GET "/addons/addon/${GUID}/versions/${VERSION}/")"
  if [ "$(kode)" = 200 ] && [ "$(printf '%s' "$v" | jq -r '.file.status')" = public ]; then
    url="$(printf '%s' "$v" | jq -r '.file.url')"
    printf 'Authorization: JWT %s\n' "$(jwt)" > "$TMP/auth"
    curl -sSfL -H @"$TMP/auth" -o "$XPI" "$url"
    echo ""
    echo "Signert: $XPI"
    exit 0
  fi
  sleep 10
done
echo ""
echo "Ikke signert ennå. Last ned xpi-en fra addons.mozilla.org/developers/addons når den er klar."
