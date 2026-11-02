#!/bin/bash
# Lager en release av Min bildeling: pakker zip-ene, tagger, pusher
# main og taggen til alle konfigurerte remotes og publiserer GitHub-releasen.
#
# Bruk: ./stats/scripts/release.sh [--yes] [--title TEKST] <notatfil>
#
# Uten --yes er det en tørrkjøring: sjekkene og pakkingen kjører, men
# ingenting tagges, pushes eller publiseres. Scriptet viser i stedet
# kommandoene det ville kjørt.
#
# GitHub er kanonisk for releases (README lenker dit). Speil får bare
# main og taggen. Remotene leses fra git, så navnene på speilene står
# ikke i repoet.

set -euo pipefail

GITHUB_REPO="fredrik-lindseth/min-bildeling"

usage() {
  echo "Bruk: $0 [--yes] [--title TEKST] <notatfil>" >&2
  echo "  <notatfil>  markdown med release-notatet (påkrevd med --yes)" >&2
  echo "  --title     tittel på GitHub-releasen (standard: v<versjon>)" >&2
  echo "  --yes       tagg, push og publiser på ordentlig" >&2
  exit 2
}

YES=0
TITLE=""
NOTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --title) [ $# -ge 2 ] || usage; TITLE="$2"; shift ;;
    -h|--help) usage ;;
    -*) echo "Ukjent valg: $1" >&2; usage ;;
    *) [ -z "$NOTES" ] || usage; NOTES="$1" ;;
  esac
  shift
done

# Notatstien gjøres absolutt før cd, ellers peker en relativ sti feil.
if [ -n "$NOTES" ] && [ -e "$NOTES" ]; then
  NOTES="$(cd "$(dirname "$NOTES")" && pwd)/$(basename "$NOTES")"
fi

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"

REMOTES=()
while IFS= read -r remote; do REMOTES+=("$remote"); done < <(git remote)
# Tom liste krasjer "${REMOTES[@]}" under set -u i macOS sin bash 3.2.
[ ${#REMOTES[@]} -gt 0 ] || { echo "Stopper: ingen remotes er satt opp" >&2; exit 1; }

VERSION=$(grep '"version"' stats/manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
TAG="v${VERSION}"
ZIP="stats/dist/min-bildeling-firefox-${TAG}.zip"
CHROME_ZIP="stats/dist/min-bildeling-chrome-${TAG}.zip"
# Firefox-brukere installerer den signerte xpi-en fra AMO (amo-upload.sh --yes).
XPI="stats/dist/min-bildeling-${TAG}-signert.xpi"
TITLE="${TITLE:-$TAG}"

# I tørrkjøring samles alle problemer så de vises på én gang.
# Med --yes stopper første problem alt.
PROBLEMS=0
problem() {
  if [ "$YES" -eq 1 ]; then
    echo "Stopper: $1" >&2
    exit 1
  fi
  echo "  PROBLEM: $1"
  PROBLEMS=$((PROBLEMS + 1))
}

echo "Release av Min bildeling ${TAG}"
echo ""
echo "Sjekker:"

BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "main" ] || problem "står på '${BRANCH:-detached HEAD}', ikke main"

[ -z "$(git status --porcelain)" ] || problem "arbeidskopien har uncommittede endringer"

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && problem "taggen ${TAG} finnes alt lokalt (bump versjonen i stats/manifest.json)"

git remote get-url github >/dev/null 2>&1 || problem "remoten 'github' mangler"

for remote in "${REMOTES[@]}"; do
  if ! remote_tag="$(git ls-remote --tags "$remote" "refs/tags/${TAG}")"; then
    problem "får ikke kontakt med remoten '${remote}'"
  elif [ -n "$remote_tag" ]; then
    problem "taggen ${TAG} finnes alt på '${remote}'"
  fi
done

command -v gh >/dev/null || problem "gh er ikke installert"
gh auth status >/dev/null 2>&1 || problem "gh er ikke innlogget (gh auth login)"

if [ -z "$NOTES" ]; then
  problem "mangler notatfil med release-notatet"
elif [ ! -s "$NOTES" ]; then
  problem "notatfilen '${NOTES}' finnes ikke eller er tom"
fi

[ -f "$XPI" ] || problem "mangler ${XPI} (kjør ./stats/scripts/amo-upload.sh --yes først)"

[ "$PROBLEMS" -eq 0 ] && echo "  alt i orden"
echo ""

echo "Pakker:"
./stats/scripts/package.sh >/dev/null
for z in "$ZIP" "$CHROME_ZIP"; do
  [ -f "$z" ] || { echo "Stopper: fant ikke ${z} etter pakking" >&2; exit 1; }
  echo "  ${z} ($(du -h "$z" | cut -f1))"
done
echo ""

STEPS=(
  "git tag -a ${TAG} -m 'Min bildeling ${TAG}'"
)
for remote in "${REMOTES[@]}"; do
  STEPS+=("git push --atomic ${remote} main refs/tags/${TAG}")
done
STEPS+=("gh release create ${TAG} ${XPI} ${ZIP} ${CHROME_ZIP} --repo ${GITHUB_REPO} --verify-tag --title '${TITLE}' --notes-file '${NOTES:-<notatfil>}'")

if [ "$YES" -eq 0 ]; then
  echo "Tørrkjøring. Med --yes ville dette blitt kjørt:"
  for step in "${STEPS[@]}"; do
    echo "  $step"
  done
  echo ""
  if [ "$PROBLEMS" -gt 0 ]; then
    echo "${PROBLEMS} problem(er) må ryddes før --yes vil gå gjennom."
  fi
  exit 0
fi

git tag -a "$TAG" -m "Min bildeling ${TAG}"
for remote in "${REMOTES[@]}"; do
  echo "Pusher main og ${TAG} til ${remote}..."
  git push --atomic "$remote" main "refs/tags/${TAG}"
done
gh release create "$TAG" "$XPI" "$ZIP" "$CHROME_ZIP" \
  --repo "$GITHUB_REPO" \
  --verify-tag \
  --title "$TITLE" \
  --notes-file "$NOTES"

echo ""
echo "Ferdig: https://github.com/${GITHUB_REPO}/releases/tag/${TAG}"
