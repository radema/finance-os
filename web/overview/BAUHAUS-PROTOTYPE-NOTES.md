# Bauhaus UI prototype — awaiting human comparison

Question: how can the planner adopt Bauhaus geometry and hierarchy while preserving
Palette D, colour semantics, and the OE exhibit philosophy?

Run `pnpm dev` (Node 24); open `http://127.0.0.1:8717/?variant=A#/overview`.
The existing app, data fetching, navigation, charts, and controls remain in use.
Use the floating arrows or keyboard left/right to cycle; the selection survives reloads
and navigation. Exit removes the experiment. Without a variant parameter the app is
unchanged. The switcher and activation component are disabled in production builds.
This is throwaway CSS and a switcher, not an implementation to promote directly.

| Variant | Structure | Decision it tests |
| --- | --- | --- |
| A — Asymmetric studio | Oversized lead metric above four secondary metrics; unequal lower columns; serif titles | Can an editorial, asymmetric composition supply the desired character? |
| B — Modular workshop | Five equal metrics in a continuous ruled strip; numbered lower modules; sans headings | Does an explicit construction grid feel clearer and sufficiently distinctive? |
| C — Financial ledger | A vertical metric rail beside a single wide sequence of sections; sans headings | Does a ledger hierarchy work better for routine financial review? |

All use the bundled fonts, spacing tokens, square card corners, and existing light/dark
colours. The attention colour remains reserved for actual alerts. Following human feedback, A now
experiments with palette slots 2, 4 and 5 in a separate ornamental composition beside the
lead metric; this decoration is not a legend or financial encoding. Chart colours and goal
identity marks are unchanged. This is a proposed expansion of decorative colour usage,
not yet a production design rule.
FI charts are unboxed; chart code and financial calculations are unchanged.
Global shell/typography treatments can also be judged on the existing Setup and analysis
screens. Structural alternatives focus on Overview. A also applies shared component treatments
throughout the existing screens; individual workflows and layouts are unchanged. The production controls still operate normally; use synthetic sample data
for exploration, not a personal database.

## Pending verdict

Human feedback: A is the preferred structure, but the first pass was too restrained.
The user expected more icons, shapes, colours and decorations.

Second pass: keep A's serif hierarchy and asymmetry; add geometric navigation and section
icons, a teal-tinted lead metric with a separate circle/quarter-circle/square composition
in ochre, teal, peach and ink, and stronger section header treatments. Icons supplement
the existing text labels. Decoration uses CSS pseudo-elements, outside chart plots.
Human feedback on the second pass: the sidebar and Overview main card are liked.
The user requested the same enhancement on other pages and cards.

Third pass extends A across shared section cards and collapsible headers, KPI modules,
Setup tabs, table headers and totals, form controls, and exhibit headings. Cards use
ruled edges and blue-tinted headers; lead KPIs use a quiet informational tint.
Exhibits receive a geometric heading marker, with no decoration inside the plot.
The sidebar and Overview lead composition are retained. Human review is pending.

Next: define the wayfinder destination and open decisions with the user. Likely subjects
include display typography, sidebar treatment, component geometry and density, and
cross-screen adoption. These are discussion prompts, not a preapproved decision map.
The spec explicitly requires Source Serif 4 for headings/KPIs, so B/C require an approved
spec amendment before production adoption. Update DESIGN.md and tokens from that decision,
then delete these throwaway files and their App.tsx integration after implementation.

## Verification

TypeScript, Biome, and 32 focused architecture/Overview/type/colour checks passed.
The client production build passed. The full gate has not been run.
Browser verification with agent-browser is pending because the executable is unavailable
in this environment; no Playwright was used. Human visual review is pending.

Third-pass verification: TypeScript, Biome and 47 focused architecture, type, colour,
shared card and button checks passed. Browser verification remains pending.

## Munari-inspired iteration

The user requested Bruno Munari's visual language on top of the liked A direction.
A is now called Munari studio in the comparison bar. This is an interpretation of
cut-paper geometry and visual play, not a reproduction of a particular artwork.

The main card keeps its hierarchy and teal field, with overlapping discs, a negative-space
cut-out, a tilted square and a diagonal plane replacing the rigid four-part ornament.
Page titles gain a small, static paper-like motif. Collapsible card headers gain a folded
corner field and circular chevron tiles. Secondary metric cards alternate small circle,
square and semicircle corner details, using neutral ink rather than goal colours.
Exhibit headings use a divided disc; chart plots and financial encodings are unchanged.
The liked sidebar stays as it was. All decoration is noninteractive, with no animation;
large decorative motifs disappear in forced-colour mode. Existing tokens support both themes.

The interpretation awaits human visual review. TypeScript, Biome and the same 47 focused
checks pass. agent-browser is still unavailable; no browser validation is claimed.

## Latest revision — restrained A and component consistency

Human feedback: the Munari treatment was too much; prefer a return toward the prior A.
The floating label is Asymmetric studio again. Removed page-title motifs, tilted paper
composition, folded header backgrounds, circular toggle tiles and alternating KPI ornaments.
Restored the lead card's static four-part geometry and small neutral KPI corner rules.
The liked sidebar and shared card treatments remain.

Checkboxes now use one square ink control with explicit checked, unchecked, indeterminate,
disabled and existing keyboard focus states. Native checkbox semantics and label activation
are retained. Forced-colour mode uses the native checkbox. Tags/chips share small square
corners, a common spacing/type rhythm and nonshrinking marks; semantic colours and icons
are retained, including heavier text for attention states.

TypeScript, Biome and 47 focused checks pass. Browser and human review remain pending;
checkbox interaction and all states need visual checking in both themes.

## Repeated lead-card shapes

The user asked for more shapes like the Net worth card. Repeat that exact geometric
vocabulary at a smaller scale: right-aligned miniatures in collapsible section headers
and Overview's non-chart section headers, plus a small composition below the first KPI
on other screens. Use one shared prototype CSS property for all sizes, including the
original lead card. Header decorations participate in flex layout; KPI decorations follow
the content, so neither covers labels, numbers, focus rings or controls. Chart exhibits
remain undecorated. No rotations, extra title ornaments or new palette values are added.
Forced-colour mode hides the motifs. Visual review remains pending.

## Latest feedback — vary motifs and colour pairings

The user rejected repetition of the same composition. The Net worth motif is now unique.
Other cards use different silhouettes and colour combinations: peach/teal arches,
ochre/olive steps, blue/ink nested discs, and green/peach diagonal planes. Generic section
cards cycle through these by sibling position; Overview Plan and Operational have explicit
assignments. The first KPI elsewhere gets olive/teal paired semicircles. No new colours
or chart changes. Dedicated artwork spaces and forced-colour behaviour are retained.
TypeScript, Biome and 47 focused checks pass; visual review remains pending.

## Latest revision — stronger Bauhaus geometry

User feedback: retain the GBI planner mark and Overview Net worth card artwork; reject
the other motifs and make them more Bauhaus. Both retained compositions are unchanged.

Replaced the arches, staircase, nested rings and paired semicircles with modular studies
of circles, squares, triangles, quarter-discs and bisected planes. Compositions and palette
pairings vary across section cards; header artwork now has a larger dedicated 64 × 48 px
area so the construction reads clearly. Other lead KPI cards use a horizontal circle,
diagonally divided square and quarter-disc composition. No new title ornament, rotation,
colour token, chart decoration or checkbox/tag change. Human visual review remains pending.
TypeScript, Biome and 47 focused checks pass.

## Selected direction — added motifs removed

The user requested removal of the new motifs and retention of the first two: the GBI
planner brand mark and Overview Net worth artwork. All later header and secondary-KPI
artwork, motif variants and their CSS properties are deleted. The main artwork is now
self-contained again. Functional icons and the earlier neutral corner rules remain.
DESIGN.md now contains one consolidated selected-direction section rather than a running
history of rejected variants. Production integration and the wayfinder destination remain
to be defined with the user; the spec has not been amended.
