# Chart palette

Personal palette for RdM's Substack charts. It is not any employer brand.

**Chosen: D (gate G2, 2026-10-25)**: Crameri. A vik burnt-orange highlight, batlowS slots, cool greys.

The one table of hex values is `PROPOSALS["d"]` in `../assets/build_palette.py`; this file copies
it. `../assets/substack.mplstyle` is generated from it (first line: "Chosen at G2 2026-10-25: D.").

Source: Fabio Crameri, *Scientific colour maps* version 8.0 (2023-06-14),
doi:10.5281/zenodo.8035877, read through the `cmcrameri` Python package 1.10
(`uv run --with cmcrameri`). Every colour except the greys and surfaces is a published value.

## Rules

- **Highlight + grey is the default.** One series carries the message in the highlight colour.
  Every other series is the context grey. This is the McKinsey exhibit style (see `visuals.md`).
- **The message is always the highlight.** Slots 2–6 never carry the message (see "Known failures").
- **At most 3 coloured series per chart:** highlight, then slot 2 orange, then slot 5 teal. Skip
  slots 3–4 here: highlight + orange + teal is the only trio that passes the all-pairs checks in
  both modes (worst CVD ΔE 10.9, normal 19.8). Everything else is grey.
  This holds for lines, scatter, bubble and small multiples. When 2 colours are enough, prefer
  highlight + teal over highlight + orange: teal differs in hue, orange is the same hue family.
- **Never use the highlight in a chart that also uses the vik diverging ramp.** The highlight is
  a vik step (0.800), so it would read as a value on the ramp.
- **Slots 3, 4 and 6 (green, ochre, olive):** only in stacked bars or columns where the segments follow
  slot order 1–6, so only neighbours touch. Never put olive in a line chart with the highlight:
  deutan ΔE 1.6.
- **Direct-label every coloured series.** Orange and ochre are below 3:1 on white, and teal is
  below 3:1 on dark, so the label is the relief channel.
- **Text is never in a series colour.** Titles, labels and direct labels use the text greys. Identity
  comes from the coloured mark beside the label (line end, dot, swatch).
- **Direct labels at line ends replace the legend** for 4 lines or fewer. This deviates from the
  dataviz default (legend always present); every line still has a text label, so identity is not
  colour-only.
- **Post and email PNGs sit on white `#ffffff`, opaque.** Substack does not swap images between
  light and dark, and dark-mode mail apps put transparent PNGs on black. The light page surface and
  the dark set are for the companion page (N9).
- Lines 2 pt (highlight 2.25 pt, context 1.5 pt); end dot with a 2 pt ring in the surface colour.
  Gridlines hairline, y only. No top, right or left spine.
- Export 1460 px wide (7.3 in at 200 dpi = 2x the 730 px column). Text sizes meet the 1x minimums
  in `visuals.md`: title 15 pt (20.8 px), labels and ticks 10.5 pt (14.6 px), source and credit
  9 pt (12.5 px).
- Source line bottom left, ending with a period. `errediemme.substack.com` credit bottom right.
- **Social image:** at 300 px the full chart's title font is about 9 px (`../assets/preview-social.png`),
  so it does not read at feed size. Make a separate larger-type crop for the social image (N8).

Images:

- `../assets/proposal-d-swatch.png`: all colours on the three surfaces, with the batlow and vik strips.
- `../assets/proposal-d-sample.png`: sample chart, white post/email version on top, dark below.
- `../assets/preview-social.png`: the sample as a 1200×630 social card, shown 300 px wide.
- `../assets/preview-dark-email.png`: the white PNG on a black dark-mode mail page.

## Colours

| Role | Light (page and white post/email) | Dark (companion page) | Source |
|---|---|---|---|
| **Highlight** (slot 1) | `#b75a26` burnt orange (vik) | `#b75a26` | vik 204/255 (0.800), both modes |
| Slot 2 | `#f19d6b` orange | `#f19d6b` | batlowS 4 |
| Slot 3 | `#4d734d` green | `#4d734d` | batlowS 5 |
| Slot 4 | `#c09036` ochre | `#c09036` | batlowS 8 |
| Slot 5 | `#226061` teal | `#226061` | batlowS 3 |
| Slot 6 | `#828231` olive | `#828231` | batlowS 2 |
| Text | `#171b1f` | `#e6ecf2` | generated |
| Text 2 (subtitle, labels) | `#494e52` | `#b3b8be` | generated |
| Axis labels, source line | `#6a6f74` | `#8e9398` | generated |
| Context series grey | `#a0a5ab` | `#494e52` | generated |
| Baseline, ticks | `#bfc5ca` | `#393e42` | generated |
| Gridline | `#e0e5eb` | `#23272b` | generated |
| Surface | `#f8fafb` page, `#ffffff` post/email | `#14181c` | generated |

Generated greys: OKLCH hue 250, C 0.010. Hue 250 gave the widest highlight-vs-grey gap of the
four tints tried (neutral, warm 75, cool 230, blue 250).

**Highlight choice (after G2):** the author asked for a brighter red-orange, close to proposal A's
`#d23f18`. No Crameri map reaches A's chroma (0.19). I checked published positions on vik's red
arm (0.70–0.90), lajolla 0.33–0.50, bilbao, lipari and roma 0.00–0.20.

A candidate passes if all of these hold, using the same hex in light and dark:

- contrast ≥ 4.5:1 on white and ≥ 3:1 on dark;
- ΔE ≥ 10 to Claude's `#d97757`;
- worst ΔE ≥ 8 against the context grey (normal, protan, deutan and tritan) in both modes;
- the 3-colour rule still holds (highlight + orange + teal, all-pairs CVD ≥ 8).

The pick is the brightest (highest OKLCH L) that passes.

| Candidate | L / C | ΔE to A | ΔE to `#d97757` | Contrast white / dark | Worst ΔE vs grey, light / dark | Trio CVD | Result |
|---|---|---|---|---|---|---|---|
| vik 204/255 `#b75a26` | 0.572 / 0.136 | 6.3 | 10.2 | 4.66 / 3.83 | 17.9 / 13.4 | 10.9 | **chosen** (brightest pass) |
| vik 206/255 `#b55521` | 0.561 / 0.140 | 6.1 | 11.3 | 4.90 / 3.64 | 18.8 / 12.5 | 10.5 | passes, darker |
| vik 202/255 `#ba5e2a` | 0.583 / 0.135 | 6.5 | 9.1 | 4.45 / 4.01 | 17.0 / 14.2 | 11.4 | fails (Claude ΔE, white contrast) |
| lajolla 110/255 `#c24d4a` | 0.575 / 0.151 | 4.9 | 10.6 | 4.71 / 3.78 | 15.7 / 9.2 | 5.8 | fails the trio (red vs teal, protan) |
| lipari 137/255 `#b36363` | 0.591 / 0.103 | 9.4 | 9.3 | 4.30 / 4.15 | 13.2 / 12.4 | not run | fails (dusty pink, Claude ΔE) |
| roma 28/255 `#995215` | 0.514 / 0.117 | 11.1 | 16.3 | 5.88 / 3.03 | 22.5 / 11.0 | not run | previous pick; rust-brown, darker |

bilbao is not in the table: every bilbao red with chroma ≥ 0.10 is below 1.8:1 on dark.

The highlight is **burnt orange (vik), the closest to vermilion that Crameri allows**. It is still
more orange and less saturated than A's vermilion `#d23f18`: OKLCH hue 46.7° vs 34.8° (11.9°
apart) and chroma 0.136 vs 0.190. It is also the warm arm of D's diverging map (vik).

No lighter vik step: lighter positions lose chroma and move toward `#d97757`. vik 0.773 `#be6736`
is C 0.128 and ΔE 7.1 from it; vik 0.749 `#c37243` is C 0.120 and ΔE 4.8; vik 0.698 `#cd8961` is
C 0.100 and ΔE 4.3.

**Highlight vs slot 4 ochre (dark mode):** `#b75a26` vs `#c09036` is normal ΔE 13.4, CVD ΔE 10.9,
with hues 47° and 80° apart. That is below the normal-vision floor of 15, so the two are close for
full-colour readers. They are not neighbours in the slot order, and the 3-colour rule keeps ochre
out of line charts. I did not swap slot 4: the pair stays this close whatever slot ochre takes.

**Slot order:** batlowS entries 4, 5, 8, 3, 2, re-ordered. The batlowS order (2, 3, 4, 5, 8) fails
the adjacent checks (CVD 1.1 dark, normal 12.6 dark). The re-order passes: CVD 14.2, normal 18.3.
batlowS has no blue or pink inside the lightness band. Its blues are too dark (L ≤ 0.41) and its
pinks too light (L ≥ 0.83).

### Ramps

| Use | Map | Published steps (evenly spaced) |
|---|---|---|
| Sequential | batlow, 9 steps (0, 32, …, 255) | `#011959` `#114360` `#226061` `#4d734d` `#828231` `#be9035` `#f19d6b` `#fdb4b4` `#faccfa` |
| Diverging | vik, 11 steps (0, 26, …, 255) | `#001261` `#023a7b` `#116496` `#5496b7` `#a7c9da` `#ece5e0` `#e1b8a0` `#cd8961` `#b75a26` `#852206` `#590008` |

- batlow: lightness monotone and steps ≥ 0.06 apart (PASS). It is multi-hue (spread 53°), so it
  fails the dataviz one-hue rule. Its light end `#faccfa` is 1.36:1 on white.
- vik: neutral midpoint `#ece5e0` (C 0.010) and monotone arms. Chosen over roma because roma's
  midpoint `#c0eac3` is mint green (C 0.069, not neutral), and roma's red end repeats the highlight hue.

## Validator results

Tool: the `dataviz` skill's `scripts/validate_palette.js` (categorical checks) and its Python twin
(the extra checks, via `build_palette.py --validator`). ΔE is OKLab distance ×100, Machado 2009
CVD simulation. Gates: L band 0.43–0.77 light / 0.48–0.67 dark; chroma ≥ 0.10; worst adjacent CVD
ΔE ≥ 8 (target), ≥ 6 (floor); normal-vision ΔE ≥ 15; mark contrast ≥ 3:1.

### Known failures (published values, not stepped)

All 3 categorical runs exit 1. The failures concern slots 2–6 only. The highlight passes every
check by itself, so a highlight + grey chart (the default) is unaffected.

| Slot | Light page | White email | Dark |
|---|---|---|---|
| 2 orange `#f19d6b` | contrast 2.05 (WARN) | contrast 2.15 (WARN) | band FAIL (L 0.770) |
| 3 green `#4d734d` | chroma FAIL (0.073) | chroma FAIL | chroma FAIL |
| 4 ochre `#c09036` | contrast 2.75 (WARN) | contrast 2.88 (WARN) | band FAIL (L 0.683) |
| 5 teal `#226061` | chroma FAIL (0.062) | chroma FAIL | chroma FAIL, band FAIL (L 0.450), contrast 2.48 (WARN) |
| 6 olive `#828231` | pass | pass | pass |

The usage rules above are the mitigation: these slots never carry the message, and they are
always direct-labelled.

### Categorical set, adjacent pairs

| Surface | Band | Chroma | Min contrast | Protan | Deutan | Tritan | Normal |
|---|---|---|---|---|---|---|---|
| light `#f8fafb` | PASS | **FAIL** | 2.05 (WARN) | 14.2 | 18.9 | 17.2 | 18.3 |
| email `#ffffff` | PASS | **FAIL** | 2.15 (WARN) | 14.2 | 18.9 | 17.2 | 18.3 |
| dark `#14181c` | **FAIL** | **FAIL** | 2.48 (WARN) | 14.2 | 18.5 | 17.2 | 18.3 |

### Highlight against context grey (the McKinsey pair)

| Surface | Normal | Protan | Deutan | Tritan | Highlight contrast | Grey contrast |
|---|---|---|---|---|---|---|
| light / email | 20.7 | 23.2 | 17.9 | 22.6 | 4.45 / 4.66 | 2.37 / 2.48 |
| dark | 21.0 | 13.4 | 20.0 | 23.7 | 3.83 | 2.12 |

### Text greys (WCAG ratio / APCA Lc)

| Surface | Text | Text 2 | Axis labels |
|---|---|---|---|
| light | 16.5 / 101.0 | 8.04 / 85.8 | 4.85 / 71.9 |
| email | 17.3 / 104.2 | 8.42 / 89.0 | 5.07 / 75.1 |
| dark | 15.0 / −93.9 | 8.93 / −62.6 | 5.76 / −42.7 |

All text greys pass WCAG AA (4.5:1) on all surfaces.

### Commands used

```bash
V=<dataviz skill dir>/scripts/validate_palette.js
node $V "#b75a26,#f19d6b,#4d734d,#c09036,#226061,#828231" --mode light --surface "#f8fafb"
node $V "#b75a26,#f19d6b,#4d734d,#c09036,#226061,#828231" --mode light --surface "#ffffff"
node $V "#b75a26,#f19d6b,#4d734d,#c09036,#226061,#828231" --mode dark  --surface "#14181c"
# 3-colour cap (all pairs)
node $V "#b75a26,#f19d6b,#226061" --mode light --pairs all
node $V "#b75a26,#f19d6b,#226061" --mode dark --surface "#14181c" --pairs all
# sequential ramp
node $V "#011959,#114360,#226061,#4d734d,#828231,#be9035,#f19d6b,#fdb4b4,#faccfa" --ordinal
# D images, previews, mplstyle, and every number in this file (add --archive for A-C images)
uv run --with matplotlib python .claude/skills/substack-writing/assets/build_palette.py \
  --validator <dataviz skill dir>/scripts/validate_palette.py
```

## How to use in matplotlib

`../assets/substack.mplstyle` sets the white surface, Inter, text sizes, greys, gridlines, spines,
2x export (7.3 in at 200 dpi = 1460 px) and the colour cycle: highlight, orange, teal, then green,
ochre, olive (the 3-colour rule first). For stacked bars, set colours explicitly in slot order 1–6. Take the
role colours from `PROPOSALS` through `theme()`, not as hex literals.

```python
import sys
import matplotlib.pyplot as plt

sys.path.insert(0, ".claude/skills/substack-writing/assets")
from build_palette import CREDIT, LABEL_PT, SOURCE_PT, STYLE_KEY, TITLE_PT, theme

plt.style.use(".claude/skills/substack-writing/assets/substack.mplstyle")
t = theme(STYLE_KEY, "light", "#ffffff")  # highlight, context, text, text2, muted, ...

fig, ax = plt.subplots()
for name, ys in series.items():
    hl = name == "Coding agent"
    ax.plot(x, ys, color=t["highlight"] if hl else t["context"], lw=2.25 if hl else 1.5,
            zorder=3 if hl else 2)
    ax.annotate(name, (x[-1], ys[-1]), xytext=(8, 0), textcoords="offset points", va="center",
                color=t["text"] if hl else t["text2"], fontweight="bold" if hl else "normal")
fig.text(0.075, 0.95, "Action title: the one message", fontsize=TITLE_PT, fontweight="bold",
         va="top")
fig.text(0.075, 0.03, "Source: <dataset>, <period>.", fontsize=SOURCE_PT, color=t["muted"])
fig.text(0.93, 0.03, CREDIT, fontsize=SOURCE_PT, color=t["muted"], ha="right")
fig.savefig("charts/name.png")  # opaque white, 1460 px wide
```

`draw_sample()` in `build_palette.py` is a full worked example: title, subtitle, turning-point
note, direct labels, source line and credit.

**Dark PNG** (companion page only): `plt.rcParams.update(rc_for(theme(key, "dark")))`.

**Font:** the style uses the first installed font of Inter, Source Sans 3, Helvetica Neue, Arial,
DejaVu Sans. Inter 4.1 is installed for this user in `~/.local/share/fonts/Inter/` (from the
rsms/inter GitHub release). On a machine without Inter, the build falls back to DejaVu Sans,
which is wider: check that titles still fit.
`build_palette.py` writes into `substack.mplstyle` only the fonts installed on the machine that ran
it, so on a new machine rerun the build instead of copying the `.mplstyle`.

Archived G2 proposals (A Ember, B Lagoon, C Raspberry, and the comparison images) are in
`../assets/archive/`: `proposal-{a,b,c}-{swatch,sample}.png`, `compare-b-d.png`, `preview-social-g2.png`, `preview-dark-email-g2.png`.
