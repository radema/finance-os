"""Solve World B's palette by search. No hex in this repo is hand-picked.

    uv run python docs/design/palette_search.py

WHY THIS FILE EXISTS
--------------------
The product owner's verdict on the three candidate worlds was "'vetro-sommerso'
is the best one even if the colour palette are rather similar and in my opinion
they can be improved." The palettes read as similar because the dataviz
accessibility gates pin every series hue into a narrow lightness/chroma band, so
three independent attempts converged. The honest levers are therefore the
GROUND and the MARK, and the way to widen the range without losing the gates is
to SEARCH the space rather than nudge hexes by eye.

So this script owns every colour value in the system. It re-implements, in
Python, exactly the maths that `dataviz/scripts/validate_palette.js` computes —
sRGB<->linear, OKLab/OKLCH, WCAG contrast, the Machado-Oliveira-Fernandes 2009
CVD transforms at severity 1.0, and Euclidean OKLab dE x100 — and then:

  1. lays the three glass grounds down on a chosen lightness ladder at the
     highest chroma the sRGB gamut allows at that lightness (the "push");
  2. SOLVES the ink ladder by bisection so each step lands on its WCAG target
     against the sheet it is read on, in both schemes;
  3. SOLVES the reserved status inks inside declared hue windows, maximising
     chroma subject to text contrast;
  4. SEARCHES the five series hues (shared across schemes) plus a per-scheme
     lightness ladder and chroma fraction, maximising the worst adjacent CVD
     separation subject to every gate INCLUDING a minimum separation from each
     reserved ink -- which is the structural fix that keeps a status colour
     from ever impersonating a datum;
  5. solves the sequential and diverging ramps against the ordinal gates.

Everything is measured on the QUANTISED hex, never on the requested OKLCH, so
the numbers reported are the numbers that ship.

The design decisions (which are mine, and are the world) are the ground hue,
the lightness ladders, and the four reserved hue WINDOWS. Everything chromatic
below them is computed. `DESIGN.md` marks the split.

Outputs, all committed as the audit trail:
    docs/design/palette.json           every token, both schemes, plus the report
    docs/design/tokens.generated.css   the two token blocks, ready to diff
"""

from __future__ import annotations

import functools
import json
import math
import pathlib
import random
from dataclasses import dataclass, field
from typing import Literal

HERE = pathlib.Path(__file__).resolve().parent
Scheme = Literal["light", "dark"]

# ---------------------------------------------------------------------------
# GATES — copied from dataviz/scripts/validate_palette.js. Do not "improve".
# ---------------------------------------------------------------------------
BAND: dict[str, tuple[float, float]] = {"light": (0.43, 0.77), "dark": (0.48, 0.67)}
CHROMA_FLOOR = 0.10       # validator floor
CVD_TARGET = 8.0          # min(protan, deutan) OKLab dE x100
NORMAL_FLOOR = 15.0       # unsimulated vision, hard gate
CONTRAST_MARK = 3.05      # a mark against its surface (3.0 + rounding margin)
CONTRAST_TEXT = 4.5       # an ink used as text

# --- OUR gates, tighter than the validator's, and each one is a decision -----
# CHROMA_PUSHED  the floor is 0.10, which is where a hue starts to read as grey.
#                A palette sitting ON the floor is what made three worlds look
#                alike, so the floor is raised.
# CHROMA_CEILING jewel glass, not neon. Above ~0.20 an sRGB hue reads as a
#                highlighter pen, which is not what a register of authenticated
#                acts sounds like.
# HUE_MIN_SEP    the validator gates ADJACENT pairs, because only neighbours
#                touch in a bar. A first run of this search exploited that and
#                handed back two indistinguishable violets in non-adjacent
#                slots -- which is precisely the "they read too similar"
#                complaint, arrived at by machine. So all-pairs separation
#                becomes a HARD gate on NORMAL vision, plus a minimum hue
#                distance between any two slots.
#
#                All-pairs *CVD* is deliberately NOT a gate and NOT the
#                objective. It cannot be: any 5-hue set wide enough to look
#                varied contains a red/green pair, and those collapse under
#                protanopia by construction (the skill's own documented default
#                clears all-pairs with three slots only, and no ordering of
#                eight can pass). Optimising for it was tried, and it pushes the
#                answer straight back to a blues-and-violets set -- the thing
#                being fixed. The applicable gate for bars, stacks and lines is
#                the ADJACENT pairlist, which is what is maximised; all-pairs
#                CVD is measured, reported, and discharged by the mandatory
#                secondary encoding (legend + direct axis labels + the luminous
#                leading edge + the void hatch + position). The consequence is
#                recorded in DESIGN.md: a scatter, bubble or choropleth in this
#                product may carry at most THREE series.
CHROMA_PUSHED = 0.125
CHROMA_CEILING = 0.20
# Minimum hue distance between two series slots: the chromatic-range gate. The
# widest value the rest of the gates admit is taken, tried in order — 40 deg is
# infeasible (it forces a slot into the green, where sRGB has no chroma left at
# the lightness the light-mode contrast cap allows), so the run settles itself
# rather than having a number picked for it.
HUE_SEP_CANDIDATES = (40.0, 36.0, 34.0, 32.0)
HUE_MIN_SEP = HUE_SEP_CANDIDATES[-1]
HUE_STATUS_MARGIN = 30.0  # between a series slot and a reserved status window
# The validator's 15.0 normal-vision floor applies to the ACTIVE pairlist,
# which for bars/stacks/lines is the adjacent one — and it is enforced at 15
# there. This second, softer floor is ours, applied to every non-adjacent pair
# as well: it is what forbids "two violets", without demanding the impossible
# geometry that a 15.0 all-pairs floor would (five hues + two reserved inks all
# 46 deg apart does not fit on the wheel at this chroma).
ALLPAIRS_NORMAL_FLOOR = 12.0
# CVD_COMFORT    the skill's target is 8.0. A first feasible solve came back at
#                14.4 with mean chroma 0.169 — i.e. it was spending headroom on
#                separation nobody asked for while the owner asked for colour.
#                So 10.0 becomes a hard floor (25% margin over the target, so a
#                future re-step cannot silently slide into the 6-8 warn band) and
#                CHROMA becomes the objective. That is the owner's instruction,
#                made mechanical.
CVD_COMFORT = 10.0

MACHADO: dict[str, list[list[float]]] = {
    "protan": [[0.152286, 1.052583, -0.204868],
               [0.114503, 0.786281, 0.099216],
               [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968],
               [0.280085, 0.672501, 0.047413],
               [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779],
               [-0.078411, 0.930809, 0.147602],
               [0.004733, 0.691367, 0.303900]],
}

# ---------------------------------------------------------------------------
# colour maths
# ---------------------------------------------------------------------------


def _s2lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lin2s(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_lin(h: str) -> tuple[float, float, float]:
    s = h.lstrip("#")
    r, g, b = (int(s[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return _s2lin(r), _s2lin(g), _s2lin(b)


def lin_to_oklab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = rgb
    ll = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    mm = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    ss = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (
        0.2104542553 * ll + 0.7936177850 * mm - 0.0040720468 * ss,
        1.9779984951 * ll - 2.4285922050 * mm + 0.4505937099 * ss,
        0.0259040371 * ll + 0.7827717662 * mm - 0.8086757660 * ss,
    )


def oklab_to_lin(lab: tuple[float, float, float]) -> tuple[float, float, float]:
    ll, a, b = lab
    l_ = (ll + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (ll - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (ll - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def oklab(h: str) -> tuple[float, float, float]:
    return lin_to_oklab(hex_to_lin(h))


def oklch(h: str) -> tuple[float, float, float]:
    ll, a, b = oklab(h)
    return ll, math.hypot(a, b), (math.degrees(math.atan2(b, a)) % 360)


def in_gamut(lab: tuple[float, float, float]) -> bool:
    return all(-1e-6 <= c <= 1 + 1e-6 for c in oklab_to_lin(lab))


def oklch_hex(ll: float, c: float, hue: float) -> str:
    rad = math.radians(hue)
    lab = (ll, c * math.cos(rad), c * math.sin(rad))
    rgb = oklab_to_lin(lab)
    return "#" + "".join(f"{round(_lin2s(v) * 255):02x}" for v in rgb)


@functools.lru_cache(maxsize=1 << 18)
def _max_chroma(ll: float, hue: float) -> float:
    rad = math.radians(hue)
    lo, hi = 0.0, 0.45
    for _ in range(40):
        mid = (lo + hi) / 2
        lab = (ll, mid * math.cos(rad), mid * math.sin(rad))
        if in_gamut(lab):
            lo = mid
        else:
            hi = mid
    return lo


def max_chroma(ll: float, hue: float) -> float:
    """Largest in-gamut sRGB chroma at this lightness and hue.

    Quantised on a fixed grid so the whole search is cacheable and every run
    reproduces the same hexes.
    """
    return _max_chroma(round(ll, 4), round(hue, 2))


def rel_lum(h: str) -> float:
    r, g, b = hex_to_lin(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((rel_lum(a), rel_lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _simulate(h: str, kind: str) -> tuple[float, float, float]:
    r, g, b = hex_to_lin(h)
    m = MACHADO[kind]
    return tuple(  # type: ignore[return-value]
        max(0.0, min(1.0, m[i][0] * r + m[i][1] * g + m[i][2] * b)) for i in range(3)
    )


_DE_CACHE: dict[tuple[str, str, str], float] = {}


def delta_e(h1: str, h2: str, kind: str = "") -> float:
    """Euclidean OKLab distance x100; kind='' is unsimulated vision."""
    key = (h1, h2, kind)
    hit = _DE_CACHE.get(key)
    if hit is not None:
        return hit
    a = lin_to_oklab(_simulate(h1, kind) if kind else hex_to_lin(h1))
    b = lin_to_oklab(_simulate(h2, kind) if kind else hex_to_lin(h2))
    d = 100 * math.dist(a, b)
    _DE_CACHE[key] = d
    return d


def cvd_sep(h1: str, h2: str) -> float:
    return min(delta_e(h1, h2, "protan"), delta_e(h1, h2, "deutan"))


def solve_lightness(
    target: float, bg: str, hue: float, chroma: float, direction: int
) -> str:
    """Least-extreme lightness whose contrast against `bg` reaches `target`.

    direction +1 searches lighter than the background, -1 darker. "Least
    extreme" means the dimmest ink that still passes, so nothing is louder than
    the ratio it owes.
    """
    lo, hi = (oklch(bg)[0], 1.0) if direction > 0 else (0.0, oklch(bg)[0])
    for _ in range(28):
        mid = (lo + hi) / 2
        c = min(chroma, max_chroma(mid, hue))
        ok = contrast(oklch_hex(mid, c, hue), bg) >= target
        if direction > 0:
            # contrast rises with lightness: keep the dimmest passing step
            if ok:
                hi = mid
            else:
                lo = mid
        elif ok:
            # contrast rises as lightness falls: keep the lightest passing step
            lo = mid
        else:
            hi = mid
    ll = hi if direction > 0 else lo
    return oklch_hex(ll, min(chroma, max_chroma(ll, hue)), hue)


# ---------------------------------------------------------------------------
# THE WORLD'S DECLARED PARAMETERS  — these are the design decisions. [DESIGN]
# Everything below them is computed against the gates.
# ---------------------------------------------------------------------------

GLASS_HUE = 265.0     # deep cobalt-glass blue: the ground of the whole world
GLASS_COOL = 252.0    # the paler cast the light scheme takes
LIGHT_HUE = 215.0     # the single light source: the luminous leading edge

# One reserved hue WINDOW per job. The window is the decision; the step inside
# it is searched. Alarm and caution are held OUT of the series set entirely
# (§5.1) so a status colour can never impersonate a datum.
WINDOWS: dict[str, tuple[float, float]] = {
    "alarm": (8.0, 34.0),        # cancellation crimson -> vermilion
    "caution": (66.0, 96.0),     # brass / amber: not evaluated
    "annot": (205.0, 225.0),     # the light source: a reference to another act
    "projection": (300.0, 330.0),  # Class B channel, reserved and unused in V1
}

# The lightness band each reserved ink is solved inside.
#
# Alarm, caution and projection sit at mid lightness, where a hue holds the most
# chroma. THE REFERENCE INK DOES NOT. A first solve put it at mid lightness in
# the cyan-blue window and it immediately competed with the data for hue space —
# the search could not place five classes AND keep 12 dE from it.
#
# The fix is the world's own logic rather than a loosened gate: in a glass world
# a reference is not another colour, it is THE LIGHT. So the reference ink is
# solved at an extreme lightness — near-white in dark, near-black in light — the
# same light source the cane's leading edge is cut from. It separates from every
# series by lightness (dL >= 0.25) instead of by hue, which hands the whole cool
# half of the wheel back to the data. Links also always carry an underline, so
# the reference is never signalled by colour alone in the first place.
RESERVED_L: dict[str, dict[str, tuple[float, float]]] = {
    "alarm": {"dark": (0.52, 0.80), "light": (0.38, 0.62)},
    "caution": {"dark": (0.52, 0.82), "light": (0.38, 0.62)},
    "annot": {"dark": (0.84, 0.94), "light": (0.24, 0.38)},
    "projection": {"dark": (0.55, 0.82), "light": (0.34, 0.60)},
}

# Minimum chroma per reserved ink. A status ink must read as a hue. The
# reference ink must NOT: it is the light, so a cast is enough, and at the
# extreme lightness it is solved at, sRGB has little chroma left to give.
RESERVED_C_MIN: dict[str, float] = {
    "alarm": 0.11,
    "caution": 0.11,
    "annot": 0.040,
    "projection": 0.11,
}

# Ground ladders. Dark first: B is a dark-first world. Chroma fraction is how
# much of the gamut maximum each layer takes — the deepest layer is the most
# saturated, because in sommerso the thickest glass carries the most colour.
GROUNDS: dict[Scheme, dict[str, tuple[float, float, float]]] = {
    # token: (lightness, chroma fraction, hue)
    "dark": {
        "ground": (0.125, 0.92, GLASS_HUE),
        "sheet": (0.185, 0.70, GLASS_HUE),
        "sheet-sunken": (0.245, 0.58, GLASS_HUE),
        "band": (0.275, 0.42, GLASS_HUE),
    },
    "light": {
        "ground": (0.905, 0.72, GLASS_COOL),
        "sheet": (0.975, 0.34, GLASS_COOL),
        "sheet-sunken": (0.855, 0.72, GLASS_COOL),
        "band": (0.900, 0.62, GLASS_COOL),
    },
}

# Ink ladder: (token, WCAG target against --sheet, chroma).
# A faint glass cast, never enough to tint the letterform.
INKS: list[tuple[str, float, float]] = [
    ("ink", 13.0, 0.014),
    ("ink-2", 7.0, 0.018),
    ("ink-3", 4.6, 0.022),
    ("rule-control", 3.05, 0.026),
    ("rule-strong", 1.90, 0.030),
    ("rule", 1.32, 0.030),
    ("band-edge", 3.05, 0.055),
    ("chart-axis", 1.90, 0.030),
    ("chart-grid", 1.26, 0.030),
    ("series-void", 3.05, 0.030),
]

SERIES_N = 5
SERIES_LABELS = [
    "EQUITY_DEVELOPED",
    "EQUITY_EMERGING",
    "BOND_GOV_EUR",
    "BOND_CORP_IG",
    "CASH",
]

# Separation a reserved ink must keep from every series slot, as
# (normal dE, CVD dE). Alarm and caution sit beside data constantly and are
# gated at the full categorical bar. Annot and projection never appear inside a
# plot, so they carry a declared, lower bar — recorded rather than hidden.
#
# THE STRUCTURAL GATE, and the one that gives this world its palette.
# ---------------------------------------------------------------------------
# §5.1 requires the alarm hue to be held OUT of the series set. A numeric dE
# gate alone does not deliver that: a run of this search duly parked a series
# slot at hue 13.6 — a crimson, one lightness step off the crimson alarm ink —
# and passed every measured check at exactly the threshold. Measurably distinct,
# and still wrong: it is the alarm colour carrying a datum.
#
# So the hue WINDOWS of the two status inks are excluded from the series set
# outright, with the same 32 deg margin used between series. What falls out is
# the rule the whole world now rests on:
#
#     THE WARM HALF OF THE WHEEL BELONGS TO STATUS. DATA LIVES IN THE COOL HALF.
#
# 336..128 deg (crimson through brass) is reserved; 128..336 deg (green through
# cyan, blue, violet, magenta) carries the five classes. A reader never has to
# ask whether a warm mark is a measurement — it never is. Annot and projection
# are chrome, never appear inside a plot, and are gated numerically only.
SERIES_HUE_EXCLUDE = ("alarm", "caution")

RESERVED_SEPARATION: dict[str, tuple[float, float]] = {
    "alarm": (NORMAL_FLOOR, CVD_TARGET),
    "caution": (NORMAL_FLOOR, CVD_TARGET),
    "annot": (12.0, 6.0),
    "projection": (12.0, 6.0),
}


# ---------------------------------------------------------------------------
# 1 + 2 — grounds and inks
# ---------------------------------------------------------------------------


def solve_grounds(scheme: Scheme) -> dict[str, str]:
    out: dict[str, str] = {}
    for name, (ll, frac, hue) in GROUNDS[scheme].items():
        out[name] = oklch_hex(ll, frac * max_chroma(ll, hue), hue)
    return out


def solve_inks(scheme: Scheme, sheet: str) -> dict[str, str]:
    hue = GLASS_HUE if scheme == "dark" else GLASS_COOL
    direction = 1 if scheme == "dark" else -1
    return {
        name: solve_lightness(target, sheet, hue, chroma, direction)
        for name, target, chroma in INKS
    }


# ---------------------------------------------------------------------------
# 3 — reserved status inks, and their tints
# ---------------------------------------------------------------------------


def solve_reserved(scheme: Scheme, sheet: str, ink: str) -> dict[str, str]:
    """Most chromatic step inside each hue window that still reads as text.

    A reserved ink is used as an 11px chip label, so the gate is the WCAG TEXT
    ratio, not the mark ratio — and it is measured against BOTH the sheet and
    its own tint, because a chip sets its label on the tint.
    """
    out: dict[str, str] = {}
    for name, (h_lo, h_hi) in WINDOWS.items():
        tint_l = 0.205 if scheme == "dark" else 0.945
        tint_hue = (h_lo + h_hi) / 2
        tint = oklch_hex(tint_l, 0.38 * max_chroma(tint_l, tint_hue), tint_hue)
        lo, hi = RESERVED_L[name][scheme]
        best: tuple[float, str, str] | None = None
        for hue in [h_lo + i * (h_hi - h_lo) / 12 for i in range(13)]:
            steps = 60
            for i in range(steps + 1):
                ll = lo + (hi - lo) * i / steps
                cmax = max_chroma(ll, hue)
                for cfrac in (1.0, 0.94, 0.88, 0.80):
                    hexv = oklch_hex(ll, cfrac * cmax, hue)
                    lch = oklch(hexv)
                    if lch[1] < RESERVED_C_MIN[name]:
                        continue
                    if contrast(hexv, sheet) < CONTRAST_TEXT:
                        continue
                    if contrast(hexv, tint) < CONTRAST_TEXT:
                        continue
                    # the tint must also still hold the body ink
                    if contrast(ink, tint) < CONTRAST_TEXT:
                        continue
                    score = lch[1]
                    if best is None or score > best[0]:
                        best = (score, hexv, tint)
        if best is None:  # pragma: no cover - a window with no legible step
            raise RuntimeError(f"no legible step in window {name} ({scheme})")
        out[name] = best[1]
        out[f"{name}-tint"] = best[2]
    return out


# ---------------------------------------------------------------------------
# 4 — the five series hues
# ---------------------------------------------------------------------------


@dataclass
class SeriesState:
    """Hues are shared across schemes (a class keeps its identity); the
    lightness ladder and chroma fraction are per scheme, because dark is a
    selected set and never an automatic flip."""

    hues: list[float]
    lightness: dict[str, list[float]] = field(default_factory=dict)
    cfrac: dict[str, list[float]] = field(default_factory=dict)

    def hexes(self, scheme: Scheme) -> list[str]:
        """Quantised on a fixed grid (L 0.001, hue 0.1 deg, fraction 0.01) so the
        search space is finite, the caches hit, and a rerun reproduces the same
        hexes exactly."""
        out = []
        for i in range(SERIES_N):
            ll = round(self.lightness[scheme][i], 3)
            hue = round(self.hues[i], 1)
            cf = round(self.cfrac[scheme][i], 2)
            out.append(oklch_hex(ll, cf * max_chroma(ll, hue), hue))
        return out

    def copy(self) -> SeriesState:
        return SeriesState(
            hues=list(self.hues),
            lightness={k: list(v) for k, v in self.lightness.items()},
            cfrac={k: list(v) for k, v in self.cfrac.items()},
        )


def _hue_gap(hue: float, window: str) -> float:
    """Angular distance from `hue` to a reserved hue window; 0 when inside it."""
    lo, hi = WINDOWS[window]
    if lo <= hue <= hi:
        return 0.0
    return min(
        min(abs(hue - edge) % 360, 360 - abs(hue - edge) % 360) for edge in (lo, hi)
    )


def penalty_breakdown(
    hexes: list[str], scheme: Scheme, sheet: str, reserved: dict[str, str]
) -> dict[str, float]:
    """Named violation terms, all zero when the palette is legal. Named rather
    than summed so an infeasible run says WHICH gate binds instead of just how
    far off it is — that diagnostic is what found the real trade-off."""
    lo, hi = BAND[scheme]
    out: dict[str, float] = {}

    def add(key: str, amount: float) -> None:
        if amount > 0:
            out[key] = out.get(key, 0.0) + amount

    for h in hexes:
        ll, c, hue = oklch(h)
        for name in SERIES_HUE_EXCLUDE:
            add(
                f"in_{name}_hue_window",
                max(0.0, HUE_STATUS_MARGIN - _hue_gap(hue, name)) * 4,
            )
        add("lightness_band", max(0.0, lo - ll) * 100 + max(0.0, ll - hi) * 100)
        add("chroma_floor", max(0.0, CHROMA_PUSHED - c) * 400)
        add("chroma_ceiling", max(0.0, c - CHROMA_CEILING) * 400)
        add("contrast_vs_sheet", max(0.0, CONTRAST_MARK - contrast(h, sheet)) * 20)

    adj = [(i, i + 1) for i in range(SERIES_N - 1)]
    allp = [(i, j) for i in range(SERIES_N) for j in range(i + 1, SERIES_N)]

    add(
        "adjacent_cvd",
        max(0.0, CVD_COMFORT - min(cvd_sep(hexes[i], hexes[j]) for i, j in adj)) * 6,
    )
    add(
        "adjacent_normal",
        max(0.0, NORMAL_FLOOR - min(delta_e(hexes[i], hexes[j]) for i, j in adj)) * 6,
    )
    for i, j in allp:
        add("allpairs_normal", max(0.0, ALLPAIRS_NORMAL_FLOOR - delta_e(hexes[i], hexes[j])) * 6)
        dh = abs(oklch(hexes[i])[2] - oklch(hexes[j])[2]) % 360
        add("pairwise_hue", max(0.0, HUE_MIN_SEP - min(dh, 360 - dh)) * 2)

    for name, (nor_gate, cvd_gate) in RESERVED_SEPARATION.items():
        ink = reserved[name]
        for h in hexes:
            add(f"vs_{name}_normal", max(0.0, nor_gate - delta_e(h, ink)) * 6)
            add(f"vs_{name}_cvd", max(0.0, cvd_gate - cvd_sep(h, ink)) * 6)
    return out


def _series_penalty(
    hexes: list[str], scheme: Scheme, sheet: str, reserved: dict[str, str]
) -> tuple[float, float, float, float]:
    """(violation, min adjacent CVD, min all-pairs CVD, min normal adjacent)."""
    adj = [(i, i + 1) for i in range(SERIES_N - 1)]
    allp = [(i, j) for i in range(SERIES_N) for j in range(i + 1, SERIES_N)]
    return (
        sum(penalty_breakdown(hexes, scheme, sheet, reserved).values()),
        min(cvd_sep(hexes[i], hexes[j]) for i, j in adj),
        min(cvd_sep(hexes[i], hexes[j]) for i, j in allp),
        min(delta_e(hexes[i], hexes[j]) for i, j in adj),
    )


def score_series(
    state: SeriesState, sheets: dict[str, str], reserved: dict[str, dict[str, str]]
) -> tuple[float, float, float, float]:
    """Lexicographic: feasibility first (which already holds adjacent CVD at
    >= CVD_COMFORT), then MEAN CHROMA — the owner's "push the palette" made
    scoreable — then adjacent CVD, then all-pairs CVD as a last tie-break."""
    violation = 0.0
    min_adj = 99.0
    min_all = 99.0
    chroma = 0.0
    for scheme in ("light", "dark"):
        hexes = state.hexes(scheme)  # type: ignore[arg-type]
        v, a, p, _ = _series_penalty(
            hexes, scheme, sheets[scheme], reserved[scheme]  # type: ignore[index]
        )
        violation += v
        min_adj = min(min_adj, a)
        min_all = min(min_all, p)
        chroma += sum(oklch(h)[1] for h in hexes)
    return (-violation, round(chroma / 10, 3), round(min_adj, 1), round(min_all, 2))


def search_series(
    sheets: dict[str, str],
    reserved: dict[str, dict[str, str]],
    *,
    restarts: int = 60,
    steps: int = 5000,
    seed: int = 20260728,
) -> tuple[SeriesState, tuple[float, float, float, float]]:
    rng = random.Random(seed)
    best: tuple[tuple[float, float, float, float], SeriesState] | None = None

    def perturb(state: SeriesState) -> SeriesState:
        cand = state.copy()
        move = rng.randrange(7)
        i = rng.randrange(SERIES_N)
        if move == 0:
            cand.hues[i] = (cand.hues[i] + rng.uniform(-22, 22)) % 360
        elif move == 1:
            scheme = rng.choice(("light", "dark"))
            lo, hi = BAND[scheme]
            cand.lightness[scheme][i] = min(
                hi, max(lo, cand.lightness[scheme][i] + rng.uniform(-0.05, 0.05))
            )
        elif move == 2:
            scheme = rng.choice(("light", "dark"))
            cand.cfrac[scheme][i] = min(
                1.0, max(0.60, cand.cfrac[scheme][i] + rng.uniform(-0.1, 0.1))
            )
        elif move == 3:
            j = rng.randrange(SERIES_N)
            scheme = rng.choice(("light", "dark"))
            ls = cand.lightness[scheme]
            ls[i], ls[j] = ls[j], ls[i]
        elif move == 5:
            # resample one slot outright: single-coordinate moves plateau in a
            # local optimum where every neighbour is worse but a fresh slot is
            # not. This is the move that reached feasibility.
            cand.hues[i] = rng.uniform(0, 360)
            for scheme in ("light", "dark"):
                lo, hi = BAND[scheme]
                cand.lightness[scheme][i] = rng.uniform(lo, hi)
                cand.cfrac[scheme][i] = rng.uniform(0.70, 1.0)
        elif move == 6:
            # slide a whole scheme's ladder: fixes a contrast shortfall across
            # the set instead of one slot at a time
            scheme = rng.choice(("light", "dark"))
            lo, hi = BAND[scheme]
            d = rng.uniform(-0.04, 0.04)
            cand.lightness[scheme] = [
                min(hi, max(lo, v + d)) for v in cand.lightness[scheme]
            ]
        else:
            j = rng.randrange(SERIES_N)
            cand.hues[i], cand.hues[j] = cand.hues[j], cand.hues[i]
            for scheme in ("light", "dark"):
                for arr in (cand.lightness[scheme], cand.cfrac[scheme]):
                    arr[i], arr[j] = arr[j], arr[i]
        return cand

    def random_state() -> SeriesState:
        hues = sorted(rng.uniform(0, 360) for _ in range(SERIES_N))
        rng.shuffle(hues)
        st = SeriesState(hues=hues)
        for scheme in ("light", "dark"):
            lo, hi = BAND[scheme]
            st.lightness[scheme] = [rng.uniform(lo, hi) for _ in range(SERIES_N)]
            st.cfrac[scheme] = [rng.uniform(0.75, 1.0) for _ in range(SERIES_N)]
        return st

    # PHASE 1 — repair, by annealing on the violation alone. A plain descent
    # stalls a hair short of legal (0.04 of a contrast ratio, in practice),
    # because the gates interact: fixing a contrast breaks a separation and
    # back again. Accepting the occasional worse state closes that last gap.
    feasible: list[SeriesState] = []
    best_infeasible: tuple[float, SeriesState] | None = None
    for _ in range(restarts):
        cur = random_state()
        cur_v = -score_series(cur, sheets, reserved)[0]
        for step_i in range(steps):
            if cur_v <= 0:
                break
            temp = 2.0 * (0.0005 / 2.0) ** (step_i / steps)
            cand = perturb(cur)
            cand_v = -score_series(cand, sheets, reserved)[0]
            delta = cand_v - cur_v
            if delta <= 0 or rng.random() < math.exp(-delta / temp):
                cur, cur_v = cand, cand_v
        if cur_v <= 0:
            feasible.append(cur)
        elif best_infeasible is None or cur_v < best_infeasible[0]:
            best_infeasible = (cur_v, cur)
    if not feasible:
        assert best_infeasible is not None
        detail: dict[str, float] = {}
        for scheme in ("light", "dark"):
            for k, v in penalty_breakdown(
                best_infeasible[1].hexes(scheme),  # type: ignore[arg-type]
                scheme,  # type: ignore[arg-type]
                sheets[scheme],
                reserved[scheme],
            ).items():
                detail[f"{scheme}.{k}"] = round(v, 2)
        raise RuntimeError(
            "no feasible series palette. Binding gates on the closest state "
            f"(total {best_infeasible[0]:.2f}): {detail}"
        )

    # PHASE 2 — optimise inside the feasible region, never leaving it.
    for seed_state in feasible:
        cur = seed_state
        cur_score = score_series(cur, sheets, reserved)
        for _ in range(steps):
            cand = perturb(cur)
            cand_score = score_series(cand, sheets, reserved)
            if cand_score[0] < 0:
                continue
            if cand_score >= cur_score:
                cur, cur_score = cand, cand_score
        if best is None or cur_score > best[0]:
            best = (cur_score, cur)
    assert best is not None
    print(f"series search: {len(feasible)}/{restarts} restarts reached feasibility")
    return best[1], best[0]


# ---------------------------------------------------------------------------
# 5 — ramps
# ---------------------------------------------------------------------------


def solve_sequential(scheme: Scheme, sheet: str) -> list[str]:
    """One hue, seven steps, monotone lightness, adjacent dL >= 0.06, and the
    pale end still >= 2:1 on the surface. In light 100 is the lightest step; in
    dark the anchor flips, exactly as the ordinal gate permits."""
    hue = GLASS_HUE
    if scheme == "light":
        end = solve_lightness(2.05, sheet, hue, 0.09, -1)
        top = oklch(end)[0]
        ladder = [top - 0.07 * i for i in range(7)]
    else:
        end = solve_lightness(2.05, sheet, hue, 0.09, 1)
        low = oklch(end)[0]
        ladder = [low + 0.07 * i for i in range(7)]
    return [oklch_hex(ll, min(0.13, 0.92 * max_chroma(ll, hue)), hue) for ll in ladder]


def solve_diverging(scheme: Scheme, alarm: str, annot: str, sheet: str) -> list[str]:
    """Signed drift. Two poles plus a NEUTRAL GREY midpoint, never a hue at the
    middle. Under-target wears the alarm family because falling short of a
    declared target is this product's core finding."""
    warm = oklch(alarm)[2]
    cool = oklch(annot)[2]
    mid_l = oklch(sheet)[0] + (0.10 if scheme == "dark" else -0.10)
    hue = GLASS_HUE if scheme == "dark" else GLASS_COOL
    mid = oklch_hex(mid_l, min(0.012, max_chroma(mid_l, hue)), hue)
    base = 0.62 if scheme == "dark" else 0.58
    out: list[str] = []
    for k in (3, 2, 1):
        ll = base - 0.055 * (k - 1) if scheme == "dark" else base - 0.075 * (k - 1)
        out.append(oklch_hex(ll, min(0.16, 0.95 * max_chroma(ll, warm)), warm))
    out.append(mid)
    for k in (1, 2, 3):
        ll = base - 0.055 * (k - 1) if scheme == "dark" else base - 0.075 * (k - 1)
        out.append(oklch_hex(ll, min(0.16, 0.95 * max_chroma(ll, cool)), cool))
    return out


def solve_edge(scheme: Scheme, series: list[str]) -> str:
    """The one light source. In dark it is the highlight where light catches the
    glass; in light the same edge reads as the deep edge of the cane. Gated on
    lightness distance from every series core, so the leading edge is legible on
    every cane — which is what lets the exact current value be read to 1px
    without colour."""
    target = 2.2
    direction = 1 if scheme == "dark" else -1
    lo, hi = (0.60, 0.99) if scheme == "dark" else (0.05, 0.40)

    def step(ll: float) -> str:
        return oklch_hex(ll, min(0.035, max_chroma(ll, LIGHT_HUE)), LIGHT_HUE)

    def ok(ll: float) -> bool:
        h = step(ll)
        return min(contrast(h, s) for s in series) >= target

    for _ in range(30):
        mid = (lo + hi) / 2
        if direction > 0:
            if ok(mid):
                hi = mid
            else:
                lo = mid
        elif ok(mid):
            lo = mid
        else:
            hi = mid
    ll = hi if direction > 0 else lo
    hexv = step(ll)
    worst = min(contrast(hexv, s) for s in series)
    if worst < target - 0.05:  # pragma: no cover - the bisection guarantees it
        raise RuntimeError(f"no legible leading edge ({worst:.2f}:1)")
    return hexv


# ---------------------------------------------------------------------------
# report + emit
# ---------------------------------------------------------------------------


def tonal_ramp(hexv: str) -> list[str]:
    ll, c, hue = oklch(hexv)
    steps = [0.10, 0.22, 0.34, 0.46, 0.58, 0.70, 0.82, 0.93]
    return [oklch_hex(s, min(c, max_chroma(s, hue)), hue) for s in steps]


def build() -> dict[str, object]:
    palette: dict[str, dict[str, str]] = {}
    reserved: dict[str, dict[str, str]] = {}
    sheets: dict[str, str] = {}

    for scheme in ("light", "dark"):
        grounds = solve_grounds(scheme)  # type: ignore[arg-type]
        inks = solve_inks(scheme, grounds["sheet"])  # type: ignore[arg-type]
        res = solve_reserved(scheme, grounds["sheet"], inks["ink"])  # type: ignore[arg-type]
        palette[scheme] = {**grounds, **inks, **res}
        reserved[scheme] = res
        sheets[scheme] = grounds["sheet"]

    global HUE_MIN_SEP
    state: SeriesState | None = None
    score: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    for sep in HUE_SEP_CANDIDATES:
        HUE_MIN_SEP = sep
        try:
            state, score = search_series(sheets, reserved)
        except RuntimeError as exc:
            print(f"hue separation {sep:.0f} deg: infeasible ({exc})".split(". Bind")[0])
            continue
        print(f"hue separation {sep:.0f} deg: FEASIBLE — taken")
        break
    if state is None:
        raise RuntimeError("no feasible series palette at any hue separation")

    report: dict[str, object] = {
        "series_score": list(score),
        "hue_min_separation_deg": HUE_MIN_SEP,
    }
    for scheme in ("light", "dark"):
        hexes = state.hexes(scheme)  # type: ignore[arg-type]
        for i, h in enumerate(hexes, start=1):
            palette[scheme][f"series-{i}"] = h
        seq = solve_sequential(scheme, sheets[scheme])  # type: ignore[arg-type]
        for i, h in enumerate(seq):
            palette[scheme][f"seq-{(i + 1) * 100}"] = h
        div = solve_diverging(
            scheme,  # type: ignore[arg-type]
            palette[scheme]["alarm"],
            palette[scheme]["annot"],
            sheets[scheme],
        )
        for name, h in zip(
            ["div-under-3", "div-under-2", "div-under-1", "div-mid",
             "div-over-1", "div-over-2", "div-over-3"],
            div,
            strict=True,
        ):
            palette[scheme][name] = h
        palette[scheme]["edge"] = solve_edge(scheme, hexes)  # type: ignore[arg-type]

        v, adj, allp, nor = _series_penalty(
            hexes, scheme, sheets[scheme], reserved[scheme]  # type: ignore[arg-type]
        )
        tri = min(
            delta_e(hexes[i], hexes[i + 1], "tritan") for i in range(SERIES_N - 1)
        )
        report[scheme] = {
            "violation": round(v, 4),
            "series_min_adjacent_cvd": round(adj, 2),
            "series_min_allpairs_cvd": round(allp, 2),
            "series_min_adjacent_normal": round(nor, 2),
            "series_min_adjacent_tritan": round(tri, 2),
            "series_chroma": [round(oklch(h)[1], 3) for h in hexes],
            "series_lightness": [round(oklch(h)[0], 3) for h in hexes],
            "series_hue": [round(oklch(h)[2], 1) for h in hexes],
            "series_min_allpairs_normal": round(
                min(
                    delta_e(hexes[i], hexes[j])
                    for i in range(SERIES_N)
                    for j in range(i + 1, SERIES_N)
                ),
                2,
            ),
            "series_min_pairwise_hue_deg": round(
                min(
                    min(
                        abs(oklch(hexes[i])[2] - oklch(hexes[j])[2]) % 360,
                        360 - abs(oklch(hexes[i])[2] - oklch(hexes[j])[2]) % 360,
                    )
                    for i in range(SERIES_N)
                    for j in range(i + 1, SERIES_N)
                ),
                1,
            ),
            "series_contrast_vs_sheet": [
                round(contrast(h, sheets[scheme]), 2) for h in hexes
            ],
            "ground_chroma": {
                k: round(oklch(palette[scheme][k])[1], 3)
                for k in ("ground", "sheet", "sheet-sunken", "band")
            },
            "ink_contrast_vs_sheet": {
                k: round(contrast(palette[scheme][k], sheets[scheme]), 2)
                for k, _, _ in INKS
            },
            "reserved_text_contrast": {
                k: round(contrast(palette[scheme][k], sheets[scheme]), 2)
                for k in WINDOWS
            },
            "reserved_on_tint_contrast": {
                k: round(contrast(palette[scheme][k], palette[scheme][f"{k}-tint"]), 2)
                for k in WINDOWS
            },
            "reserved_vs_series": {
                k: {
                    "normal": round(min(delta_e(h, palette[scheme][k]) for h in hexes), 1),
                    "cvd": round(min(cvd_sep(h, palette[scheme][k]) for h in hexes), 1),
                }
                for k in WINDOWS
            },
            "sequential_dl": [
                round(abs(oklch(seq[i + 1])[0] - oklch(seq[i])[0]), 3) for i in range(6)
            ],
            "sequential_light_end_contrast": round(
                min(contrast(s, sheets[scheme]) for s in seq), 2
            ),
            "edge_vs_series_contrast": round(
                min(contrast(palette[scheme]["edge"], h) for h in hexes), 2
            ),
        }
    return {"palette": palette, "report": report, "series_labels": SERIES_LABELS}


CSS_ORDER = [
    ("grounds", ["ground", "sheet", "sheet-sunken"]),
    ("inks", ["ink", "ink-2", "ink-3"]),
    ("rules", ["rule", "rule-strong", "rule-control"]),
    ("reserved", ["alarm", "alarm-tint", "caution", "caution-tint",
                  "annot", "annot-tint", "projection", "projection-tint"]),
    ("glass", ["edge", "band", "band-edge"]),
    ("series", [f"series-{i}" for i in range(1, 6)] + ["series-void"]),
    ("sequential", [f"seq-{i * 100}" for i in range(1, 8)]),
    ("diverging", ["div-under-3", "div-under-2", "div-under-1", "div-mid",
                   "div-over-1", "div-over-2", "div-over-3"]),
    ("chart chrome", ["chart-grid", "chart-axis"]),
]


def emit_css(palette: dict[str, dict[str, str]]) -> str:
    out = ["/* GENERATED by docs/design/palette_search.py — do not hand-edit. */"]
    for scheme in ("light", "dark"):
        out.append(f"\n/* ---- {scheme.upper()} ---- */")
        for group, names in CSS_ORDER:
            out.append(f"  /* {group} */")
            for n in names:
                out.append(f"  --{n}: {palette[scheme][n]};")
    return "\n".join(out) + "\n"


def main() -> None:
    data = build()
    palette = data["palette"]
    assert isinstance(palette, dict)
    (HERE / "palette.json").write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (HERE / "tokens.generated.css").write_text(emit_css(palette), encoding="utf-8")
    print(json.dumps(data["report"], indent=2, sort_keys=True))
    print(f"\nwrote {HERE / 'palette.json'}")
    print(f"wrote {HERE / 'tokens.generated.css'}")
    print("\nvalidate with:")
    for scheme in ("light", "dark"):
        s = ",".join(palette[scheme][f"series-{i}"] for i in range(1, 6))
        print(
            f'  node validate_palette.js "{s}" --mode {scheme} '
            f'--surface "{palette[scheme]["sheet"]}"'
        )


if __name__ == "__main__":
    main()
