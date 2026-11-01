#!/bin/bash
# Håndhever stilreglene i docs/design.md for stats/:
#   - fargeverdier (#rgb, #rrggbb, rgb(), rgba(), hsl(), hsla()) bare i
#     lib/tokens.css
#   - ingen box-shadow eller text-shadow med annen verdi enn none
#   - border-radius bare som var(--radius) eller 0
#   - ingen !important
# Går gjennom .css, .html og .js under stats/, unntatt vendor/, test/ og dist/.
# I HTML ses det bare i <style> og style-attributter, så ankerlenker som
# href="#bad" ikke slår ut. Funn meldes som fil:linje: regel.
#
# Bruk: stats/scripts/sjekk-stil.sh

set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 -I - <<'PY'
import pathlib
import re
import sys

TOKENS = pathlib.Path("lib/tokens.css")
SKIP = ("vendor", "test", "dist", "node_modules")

COLOR = re.compile(
    r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])"
    r"|\b(?:rgba?|hsla?)\("
)
SHADOW = re.compile(r"\b(?:box|text)-shadow\s*:\s*(?!none\s*[;}\"'])", re.I)
SHADOW_JS = re.compile(r"\b(?:boxShadow|textShadow)\s*=\s*[\"'`](?!none[\"'`])")
RADIUS = re.compile(r"\bborder-radius\s*:\s*([^;}\"']+)", re.I)
RADIUS_OK = {"var(--radius)", "0"}
IMPORTANT = re.compile(r"!\s*important", re.I)


def strip_css_comments(text):
    # Kommentarer byttes med like mange linjeskift, så linjenumrene står.
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def strip_js_comments(text):
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", text)


def html_style_regions(text):
    """Gir teksten med alt utenom <style> og style-attributter blanket ut."""
    out = [c if c == "\n" else " " for c in text]
    for m in re.finditer(r"<style[^>]*>(.*?)</style>", text, flags=re.S | re.I):
        out[m.start(1):m.end(1)] = strip_css_comments(m.group(1))
    for m in re.finditer(r"\sstyle\s*=\s*(\"[^\"]*\"|'[^']*')", text, flags=re.I):
        out[m.start(1):m.end(1)] = m.group(1)
    return "".join(out)


funn = []


def check(path, text, kind):
    for nr, line in enumerate(text.splitlines(), 1):
        where = f"{path}:{nr}"
        if path != TOKENS and COLOR.search(line):
            funn.append(f"{where}: fargeverdi utenfor lib/tokens.css")
        if IMPORTANT.search(line):
            funn.append(f"{where}: !important")
        if kind in ("css", "html") and SHADOW.search(line):
            funn.append(f"{where}: skygge")
        if kind == "js" and SHADOW_JS.search(line):
            funn.append(f"{where}: skygge")
        if kind in ("css", "html"):
            for m in RADIUS.finditer(line):
                if m.group(1).strip() not in RADIUS_OK:
                    funn.append(f"{where}: border-radius {m.group(1).strip()}")


for path in sorted(pathlib.Path(".").rglob("*")):
    if not path.is_file() or any(part in SKIP for part in path.parts):
        continue
    suffix = path.suffix.lower()
    if suffix not in (".css", ".html", ".js"):
        continue
    text = path.read_text(encoding="utf-8")
    if suffix == ".css":
        check(path, strip_css_comments(text), "css")
    elif suffix == ".html":
        check(path, html_style_regions(text), "html")
    else:
        check(path, strip_js_comments(text), "js")

for f in funn:
    print(f"FEIL: {f}", file=sys.stderr)
if funn:
    print(f"\nStilsjekken fant {len(funn)} brudd. Se docs/design.md.", file=sys.stderr)
    sys.exit(1)
print("Stilsjekken: ingen brudd.")
PY
