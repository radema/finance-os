# Motif approval previews

These PNGs visualize the proposed semantic family: shape placement, fixed colour mapping,
and a compact header-size treatment. They are schematic design studies, not screenshots
or a change to the two retained artworks in the running prototype. Font labels use local
DejaVu for export; production retains the bundled project fonts. Colours are read directly
from `web/tokens.css` for each theme.

- [Light comparison](comparison-light.png)
- [Dark comparison](comparison-dark.png)
- [Capital](capital-light.png), [dark](capital-dark.png)
- [Plan](plan-light.png), [dark](plan-dark.png)
- [Measurement](measurement-light.png), [dark](measurement-dark.png)
- [Records](records-light.png), [dark](records-dark.png)

The quarter-circle and quadrant are illustrated as curved primitives for review. Final
implementation must preserve the approved original Net worth artwork; its CSS gradient
construction is not replaced by this schematic export without visual approval.

Regenerate with Python 3.12 and Pillow installed in `/tmp/gbi-png-tools`:
`python3.12 .scratch/gbi-ui-refinement/assets/motif-previews/render.py`.
Pillow is an export tool only; no application dependencies were changed.

## Composition alternatives — latest review

The first four-tile permutations did not convince the user. These alternatives retain
all four primitives and Palette D while varying scale, spacing, orientation and silhouette.
Brand and Overview Net worth artwork are untouched. The same three proposed meanings
appear in each column, so composition and meaning can be judged separately.

- [Light comparison](alternatives-light.png)
- [Dark comparison](alternatives-dark.png)
- A — Open balance: [light](alternative-a-light.png), [dark](alternative-a-dark.png)
- B — Linear rhythm: [light](alternative-b-light.png), [dark](alternative-b-dark.png)
- C — Architectural: [light](alternative-c-light.png), [dark](alternative-c-dark.png)

Shape colours are fixed in these studies to isolate the composition decision: ochre circle,
ink square, teal quarter-disc and peach quadrant. Each category has a fixed arrangement;
these are candidates, not randomly generated variations. No category assignments or new
UI artwork are approved yet. All generated PNGs were exported at 2× and downsampled;
the light comparison was visually inspected for clipping and layout.

Regenerate: `python3.12 .scratch/gbi-ui-refinement/assets/motif-previews/alternatives.py`.

## Two-shape studies — latest review

The user requested new combinations or repetitions of two shapes rather than requiring
all four primitives in each motif. The two approved main artworks remain untouched.

- [Light PNG](two-shapes-light.png)
- [Dark PNG](two-shapes-dark.png)

Six candidates explore containment, comparison, repetition, assembly and overlap. Each
includes a small-size sample and a proposed semantic association. These are alternative
candidates for three families, not six additional mandatory decorations. All use Palette D.
No UI or final meaning assignment has changed. The previous four-primitive requirement
is superseded by this exploration; meaning and composition still need human approval.

Regenerate with `python3.12 .scratch/gbi-ui-refinement/assets/motif-previews/two-shapes.py`.
