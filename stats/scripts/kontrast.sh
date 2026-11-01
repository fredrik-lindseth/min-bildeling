#!/bin/bash
# Måler WCAG 2-kontrast for fargeparene som brukes sammen i stats/.
# Leser :root i lys modus og :root under prefers-color-scheme: dark (eller
# light-dark(a, b)) i hver CSS-fil, og feiler under 4.5:1 for tekst og 3:1
# for UI (kanter, fremdrift, diagramelementer).
#
# Bruk: stats/scripts/kontrast.sh
# Nye par legges i PARS under. Format: fil, forgrunn, bakgrunn, krav, beskrivelse.

set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 -I - <<'PY'
import re
import sys

TEKST = 4.5
UI = 3.0

PARS = [
    # Dashboard: header
    ("dashboard/dashboard.css", "--color-text", "--color-header-bg", TEKST, "headertekst"),
    ("dashboard/dashboard.css", "--color-text-secondary", "--color-header-bg", TEKST, "synketidspunkt i header"),
    # Dashboard: synkbanner og fremdrift
    ("dashboard/dashboard.css", "--color-text", "--color-surface", TEKST, "tekst i synkbanner"),
    ("dashboard/dashboard.css", "--color-progress-fill", "--color-progress-bg", UI, "fremdrift mot spor"),
    ("dashboard/dashboard.css", "--color-progress-fill", "--color-surface", UI, "fremdrift mot banner"),
    ("dashboard/dashboard.css", "--color-warning-text", "--color-warning-bg", TEKST, "ikke innlogget og feil"),
    ("dashboard/dashboard.css", "--color-accent-text", "--color-accent", TEKST, "primærknapp og banner-handling"),
    ("dashboard/dashboard.css", "--color-accent-text", "--color-accent-hover", TEKST, "primærknapp, hover"),
    # Dashboard: tom tilstand og første synk
    ("dashboard/dashboard.css", "--color-text", "--color-bg", TEKST, "tom tilstand, første linje"),
    ("dashboard/dashboard.css", "--color-text-secondary", "--color-bg", TEKST, "tom tilstand, forklaring"),
    ("dashboard/dashboard.css", "--color-link", "--color-bg", TEKST, "lenke i tom tilstand"),
    # Dashboard: knapper
    ("dashboard/dashboard.css", "--color-btn-sync-text", "--color-btn-sync-bg", TEKST, "sekundærknapp"),
    ("dashboard/dashboard.css", "--color-btn-sync-text", "--color-btn-sync-hover", TEKST, "sekundærknapp, hover"),
    ("dashboard/dashboard.css", "--color-disabled-text", "--color-disabled-bg", TEKST, "deaktivert knapp"),
    # Popup
    ("popup/popup.css", "--color-text", "--color-bg", TEKST, "brødtekst"),
    ("popup/popup.css", "--color-text-secondary", "--color-bg", TEKST, "tidsstempel"),
    ("popup/popup.css", "--color-text", "--color-surface", TEKST, "tekst i synkbanner"),
    ("popup/popup.css", "--color-accent", "--color-surface", UI, "fremdrift mot banner"),
    ("popup/popup.css", "--color-accent", "--color-border", UI, "fremdrift mot spor"),
    ("popup/popup.css", "--color-warning-text", "--color-warning-bg", TEKST, "ikke innlogget og feil"),
    ("popup/popup.css", "--color-accent-text", "--color-accent", TEKST, "primærknapp"),
    ("popup/popup.css", "--color-accent-text", "--color-accent-hover", TEKST, "primærknapp, hover"),
    ("popup/popup.css", "--color-btn-secondary-text", "--color-btn-secondary-bg", TEKST, "sekundærknapp"),
    ("popup/popup.css", "--color-btn-secondary-text", "--color-btn-secondary-hover", TEKST, "sekundærknapp, hover"),
    ("popup/popup.css", "--color-disabled-text", "--color-disabled-bg", TEKST, "deaktivert knapp"),
]


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def blocks(css):
    """Gir (prelude-stakk, innhold) for hver regel med deklarasjoner."""
    out, stack, buf = [], [], ""
    for ch in css:
        if ch == "{":
            stack.append(buf.strip())
            buf = ""
        elif ch == "}":
            if stack:
                out.append((list(stack), buf))
                stack.pop()
            buf = ""
        else:
            buf += ch
    return out


def tokens(path):
    light, dark = {}, {}
    for stack, body in blocks(strip_comments(open(path, encoding="utf-8").read())):
        if stack[-1] != ":root":
            continue
        outer = " ".join(stack[:-1])
        if "prefers-color-scheme" in outer and "dark" in outer:
            target = dark
        elif outer == "":
            target = light
        else:
            continue
        for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body):
            target[name] = value.strip()
    resolved_light, resolved_dark = {}, {}
    for name, value in light.items():
        m = re.fullmatch(r"light-dark\((.+),(.+)\)", value)
        if m:
            resolved_light[name], resolved_dark[name] = m.group(1).strip(), m.group(2).strip()
        else:
            resolved_light[name] = value
            resolved_dark.setdefault(name, value)
    resolved_dark.update(dark)
    return {"lys": resolved_light, "mørk": resolved_dark}


def lookup(table, name, seen=()):
    if name not in table:
        raise KeyError(f"{name} finnes ikke")
    value = table[name]
    m = re.fullmatch(r"var\((--[\w-]+)\)", value)
    if m:
        if m.group(1) in seen:
            raise KeyError(f"sirkulær var() i {name}")
        return lookup(table, m.group(1), seen + (name,))
    return value


def parse(value):
    v = value.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", v)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    if re.fullmatch(r"#[0-9a-f]{4}|#[0-9a-f]{8}|rgba\(.*\)|hsla?\(.*\)", v):
        raise ValueError(f"{value} har alfa eller ukjent format, kan ikke måles")
    m = re.fullmatch(r"rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)", v)
    if m:
        return tuple(int(x) for x in m.groups())
    if v in ("white", "#fff"):
        return (255, 255, 255)
    raise ValueError(f"{value} er ikke en farge scriptet kan lese")


def luminance(rgb):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


cache = {}
fails = 0
print(f"{'fil':<24} {'modus':<5} {'par':<58} {'krav':>4} {'målt':>6}")
for path, fg, bg, need, label in PARS:
    if path not in cache:
        cache[path] = tokens(path)
    for mode, table in cache[path].items():
        pair = f"{fg} på {bg}"
        try:
            r = ratio(parse(lookup(table, fg)), parse(lookup(table, bg)))
            ok = r >= need
            shown = f"{r:6.2f}"
        except (KeyError, ValueError) as e:
            ok, shown = False, f"  FEIL ({e})"
        if not ok:
            fails += 1
        mark = "" if ok else "  <-- for lav"
        print(f"{path:<24} {mode:<5} {pair:<58} {need:>4} {shown}{mark}  {label}")

if fails:
    print(f"\n{fails} par under kravet.", file=sys.stderr)
    sys.exit(1)
print("\nAlle par holder.")
PY
