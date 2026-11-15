# DESIGN.md

Design contract for the GBI planner UI. The selected direction is Asymmetric studio (A),
including the approved semantic two-shape motifs. It supersedes the visual treatment of
the historical `.scratch/gbi-v1/prototypes/11-ui/` reference. The prototype is a reference for decisions,
not code: copy token values and fonts, never its HTML, CSS or JS.

Where the code is: tokens in `web/tokens.css`, fonts in `web/fonts.css` and `web/fonts/`, shell in
`web/AppShell.tsx`, navigation in `web/nav.ts`.

Palette D comes from `.scratch/gbi-v1/reference/palette-substack-d.md`. The chart rules follow the OE
Data Viz exhibit rules (`reference/oe-dataviz-README.md`) with the changes listed below.

## Colour

Every colour comes from a token in `web/tokens.css`. No hex literal in a component, stylesheet or chart.
Light is the default. Dark follows `prefers-color-scheme` (a manual switch is ticket #67).

### Surfaces, text and lines

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface` | `#f8fafb` | `#14181c` | page |
| `--raised` | `#ffffff` | `#1a1f24` | cards, inputs, popovers |
| `--wash` | `#eef1f4` | `#1b2025` | quiet fill: hover, neutral chips |
| `--ink` | `#171b1f` | `#e6ecf2` | text, buttons, focus ring |
| `--ink2` | `#494e52` | `#b3b8be` | subtitles, labels |
| `--muted` | `#6a6f74` | `#8e9398` | axis labels, source line |
| `--ctx` | `#a0a5ab` | `#494e52` | context series grey |
| `--base` | `#bfc5ca` | `#393e42` | baseline, ticks, control borders |
| `--grid` | `#e0e5eb` | `#23272b` | hairline gridlines and row rules |

Text is never in a series colour. Identity comes from a coloured mark beside the label.

### Slots

Six palette slots, the same in light and dark. One fixed slot per goal. `--slot7` is the neutral grey of
goal 6 and later (an alias of `--muted`); its tint `--tint7` is `--wash`.

| Token | Value | Colour | Alias |
|---|---|---|---|
| `--slot1` | `#b75a26` | burnt orange | `--hl` (highlight) |
| `--slot2` | `#f19d6b` | orange | `--hl2` |
| `--slot3` | `#4d734d` | green | |
| `--slot4` | `#c09036` | ochre | |
| `--slot5` | `#226061` | teal | `--hl3` |
| `--slot6` | `#828231` | olive | |

### Tints

A tint is a slot colour mixed into the page surface: light 12%, dark 18%. Text on a tint stays `--ink`.
Colour lives in dots, bars, fills and 1 px borders (the slot colour at 35-42%).

| Token | Light | Dark | From |
|---|---|---|---|
| `--tint1` .. `--tint6` | `#f0e7e1` `#f7efea` `#e3eae6` `#f1ede3` `#dee8e9` `#eaece3` | `#31241e` `#3c302a` `#1e2825` `#332e21` `#172528` `#282b20` | slots 1-6 |
| `--tint1-strong` | `#e8d4c8` | `#4b2e1f` | slot 1 at 24% (dark 34%): Off track |
| `--blue` | `#116496` | `#5496b7` | vik cool arm |
| `--tint-blue-faint` | `#eaf1f5` | `#1a252c` | blue at 6% (dark 10%) |
| `--tint-blue` | `#dce8ef` | `#202f38` | blue at 12% (dark 18%) |
| `--tint-blue-strong` | `#c1d6e3` | `#28404e` | blue at 24% (dark 32%) |
| `--tint-sand` | `#efe0d7` | `#3d3836` | vik `#e1b8a0`: BTP tag |
| `--tint-pink` | `#fadedf` | `#43373a` | batlow `#fdb4b4`: pension tag |

### Meaning

- **Highlight family (`--hl`, `--hl2`, `--tint1`, `--tint1-strong`)** means attention: the exception, an old
  price, a worsened status. Marks only: bars, lines, dots, icons, rules. Never text, never a button.
- **Blue** means general information: priority tags, card headers.
- **No red and no green** for status. Status is an icon plus a word, so colour is never the only channel.
- Buttons and focus rings use `--ink`.
- **Decided by the user on #71 (2026-11-05), as written:**
  1. Highlight vs pension goal: `#b75a26` (slot 1, `--hl`) is kept for the message only (At risk / Off
     track). Goals use slots 2 to 6; Retirement moves off slot 1.
  2. Goals beyond the colour slots: grey, no cap. Goals 1-5 take slots 2-6; goal 6 and later use a
     neutral grey token with a direct label.

## Type

Source Serif 4 for page titles, exhibit action titles and KPI values (`--font-display`,
weight 500, letter-spacing -0.02em). Geist for body text, navigation, brand and card header
labels. Card header labels are sentence case, 15 px / 22 px, weight 600, without tracking;
the brand is weight 700. Geist Mono remains for KPI labels and other small mono labels.
All fonts are bundled in `web/fonts/` under OFL; no CDN. Tables/charts use tabular figures.

Responsive display ranges: page titles 40–72 px, Overview Net worth 40–72 px, secondary
Overview values 26–40 px, other KPI values 26–36 px. Exhibit action titles use 26/32 px.
These display ranges do not enlarge chart axes or table text. Long labels and amounts
must fit at supported desktop widths without obscuring artwork or controls.

The OE type scale, one step up:

| Token | Size / line | Use |
|---|---|---|
| `--t-title` | 26 / 32 px | exhibit action title  |
| `--t-body` | 16 / 24 px | body |
| `--t-sub` | 15 / 22 px | tables, subtitle, unit line |
| `--t-callout` | 14 / 20 px | callout, sidebar items |
| `--t-label` | 13 / 18 px | labels, chips, legend |
| `--t-axis` | 12 / 16 px | chart axes, small labels, source line |

The kicker (the `.tag` line above a page or exhibit title) is Geist 13 px (`--t-label`), weight 500,
`--ink2`, sentence case: no uppercase, no letter-spacing, no mono.

## Spacing

Scale: `--s1` 4, `--s2` 8, `--s3` 16, `--s4` 24, `--s5` 32, `--s6` 48 px. Every gap, padding and margin
uses one of these tokens. Allowed literals: `0`, `auto`, hairlines of 1-2 px (also negative), and the
content padding. `tools/architecture` fails the gate on any other literal margin, padding or gap in `web/`.
A page header (title, or title and unit line) sits `--s4` above the first block under it. A form is a grid of
equal columns; every field spans a label row, a control row and a hint row, and every single-line control
is `--control-h` high. KPI cards wrap in equal columns chosen from the card count. Layout is fluid and desktop-first, usable from about 1024 to
1920 px: sidebar 232 px (248 px from 1280 px), content padding `clamp(24px, 3vw, 56px)`. Mobile is v2.
The Setup screens (Products, Allocation, Cash flow, Assumptions and Glossary, all tabs of one page) sit in `.setup-column`, capped at `--setup-max` (1200 px,
in `tokens.css`), so rows stay easy to scan at 1920 px and forms keep to about five columns. Charts and
the other screens keep the full width.
Notes and callouts (`.note`, `.callout`: callouts under charts, the Next contribution note, the Pension
capital note, the Optimizer `.sub` and `.alert` lines and `.steps` panel) share one width, `--note-max`
(50ch, in `tokens.css`). `ch` is the width of "0", which is wider than an average letter in Geist, so 50ch
holds about 70 characters of body text (70ch held 96 to 100). The Optimizer control grid is 2 columns, 4
from 1600 px, so the longest Criterion name never clips.
The gap between blocks (KPI row, card, exhibit, control grid) is `--s4`, everywhere.

## Components

- **Cards and exhibits.** One container rule: inputs and tables live in cards; charts live as exhibits
  (`figure.exhibit`: tag, title, unit, chart, callout, source), with no container box. Collapsible
  sections follow the same rule: a collapsible card holds inputs or a table, never a chart. An exhibit has no
  width cap, so its chart ends where the card above or below it ends; the title, unit line and callout keep
  their own caps. Blocks sit `--s4` apart (the block gap). Where one exhibit follows another, a 1 px `--grid`
  hairline closes the first, with `--s4` above and below it.
- **Goal chip.** 2 px corners, at least 24 px high. 9 px dot in the goal's slot colour, goal name, background the goal's tint, 1 px
  border in the slot colour at 42%. Label 13 px, weight 500.
- **Need / Want / Wish tag.** 2 px radius, at least 24 px high, label 13 px weight 500. A marker plus a tint, so shape carries
  the meaning too: Need filled dot on `--tint-blue-strong`, Want half dot on `--tint-blue`, Wish ring on
  `--tint-blue-faint`. Border blue at 35%.
- **Status chip.** 2 px corners, at least 24 px high, icon plus word. On track: check in a circle on `--wash`. At risk: outline
  triangle on `--tint1`, weight 600, border highlight at 35%. Off track: filled triangle on
  `--tint1-strong`, border `--hl`.
- **Alert severity chip.** Same geometry as the status chip, icon plus word, after the alert name. Info:
  neutral ring on `--wash`. Medium: outline triangle on `--tint1`, weight 600, border highlight at 35%.
  High: filled triangle on `--tint1-strong`, border `--hl`. Colour marks only; the word stays in the text
  grey. The rule id (R2, R7) is never shown.
- **Product tag.** 2 px radius, at least 24 px high, 12 px uppercase, weight 500, 1 px `--base` border. ETF `--tint-blue`,
  BTP `--tint-sand`, Pension `--tint-pink`.
- **Price-freshness label.** 2 px corners, at least 24 px high, 13 px. Fresh: grey ring (`--ctx`) on `--wash`. Old: filled `--hl` dot,
  weight 600, `--tint1`, border highlight at 35%. An old price is flagged and still counted.
- **KPI card.** `--raised`, square corners, 1 px `--base` outline and 2 px ink top rule.
  Overview uses the lead-card/open-secondary layout defined below. Where a KPI belongs to a goal
  (the Goal detail and Pension screens), an 8 px dot in the goal's slot colour comes before the label.
  KPIs that belong to no goal (Overview, Performance, Independence levels) have no dot.
- **Section card.** `--raised`, square corners, 1 px `--base` outline and 2 px ink top rule.
  A `--tint-blue-faint` header holds the collapse control and Geist label (15 px, weight 600,
  sentence case, `--ink`). Body padding is `--s4`. Charts remain unboxed exhibits.
- **Sticky table header.** Every table header row is `position: sticky`, at the top of the scrolling
  page (below a top bar if there is one), with the surface colour behind it (`--raised` inside a card) and
  a hairline bottom border. Cards use `overflow: clip`, not `hidden`, so they are not a scroll container.
  A table that must scroll sideways sits in `.table-scroll table-scroll-sticky`: a wrapper capped at 70vh,
  so the header sticks inside it. The Cash flow table also keeps its Year column sticky on the left (`.table-cash-flow`),
  one line per cell, in whole euros.
- **Disabled button and file picker.** A disabled `.btn` has a `--wash` fill, an `--ink2` label (at least
  4.5:1), a not-allowed cursor and no hover. The shared `FilePicker` is an outlined `.btn` label, then the
  file name (or "No file chosen"); pasted text names no file.
- **Sidebar.** Seven sections: Overview; Goals (List, Detail, History); Independence; Analysis
  (Optimizer, Performance, Plan vs actual); Pension; Operations (Transactions, Import, Prices); Setup
  (Products, Allocation, Cash flow, Assumptions, Glossary). The current page has a 2 px `--ink` bar,
  weight 600 and a `--tint5` background. Section icons are geometric and monochrome;
  the sidebar divider uses ink. A page without a screen shows a "soon" tag and a placeholder page. Under 900 px of window
  height the spacing tightens (spacing tokens only) so every item shows without scrolling the sidebar.
  A fixed chevron button straddles the sidebar divider near the top (left to collapse, right to restore).
  When collapsed, it sits at the left viewport edge and content uses the full width. It remains available
  while scrolling without adding a toolbar row. The layout changes without animation.
- **Setup tab bar.** `SetupTabs` (`web/setup/SetupTabs.tsx`) is the one tab bar of the Setup screens, shared
  by Products, Allocation, Cash flow, Assumptions and Glossary; the current tab uses an ink rule and `--tint5` fill.
- **Glossary term.** A dotted-underline button that opens a popover: plain sentence first, the Italian
  term above it. No `title=` hints.

## Charts

- **Exhibit anatomy.** Tag (the kicker: Geist 13 px, sentence case), action title that holds a number, unit line, chart,
  callout (2 px `--hl` rule on the left), source line. The source line ends with a period.
- **Page title.** The `h1` is the name of the screen, never a finding (on a goal's page, the goal's
  name). A finding with a number is the action title (`h2`) of the first exhibit, or of the key
  numbers when a screen opens with them. Headings go in order: `h1`, then `h2`, then `h3`.
- **Colours come from tokens, never literals.** ECharts options read the custom properties.
- **One fixed slot colour per goal**, in every chart and beside the name in lists and chips. Goals 1-5 take
  slots 2-6 in creation order. Slot 1 is the highlight and no goal uses it. Goal 6 and later share the
  neutral grey `--slot7`; the chip and the line label carry the name.
- **Highlight plus grey is the default.** One series carries the message in `--hl`; the rest are `--ctx`.
- **Lines use at most two goal colours:** slots 2 and 5 (slot 1 is the highlight). Other goals are grey. Slots 3, 4 and 6
  appear only in stacked bars and areas, in slot order 1 to 6, with a surface-coloured edge between
  segments.
- **A compact legend on every multi-series chart**, above the chart at the top left, with swatches for
  goals or line, band, tick and dashed samples. This overrides the palette file's "direct labels replace
  the legend" rule.
- **Direct labels where they help.** Label every coloured line at its end. Orange, ochre and teal are
  weak against the surface, so the label is the relief channel. Text stays in the text greys.
- **Room for end labels.** This applies to the charts of the Goal detail, Performance, Plan vs actual and Goal history
  screens only. Every time-axis chart (line, area, bar) there uses `PLOT_GRID` (in `web/useEchart.ts`): 168 px right of
  the plot, labelled or not, so the plots of one screen end at one x. The label fits inside this room; a chart box
  itself runs to the column edge. The Independence and Pension charts keep their own right margin, and so does the
  range-of-outcomes histogram (16 px: its labels sit inside the plot). Adding a line to a chart adds one label and
  needs no layout change.
- **Marks.** Hairline gridlines on y only. No top, right or left axis line. Lines 2 pt (highlight 2.25 pt,
  context 1.5 pt); the end dot has a 2 px ring in the surface colour. Bars start at zero.
- **Scatter marks.** Sizes are tokens (`--mark-dot` 10 px, `--mark-key` 16 px). Plain dots are `--muted`, at least 3:1 on the
  surface in both themes. The suggested and the current mark carry a 2 px `--ink2` ring and a direct label. Dots that
  would stack are set side by side; the tooltip keeps the true values. One mix: a sentence, no chart.
- **Fans.** The series colour at 22% fill (30% in dark) with a 60% line; the median is solid.
- **Sizes.** Axis text 12 px, labels 13 px. Draw charts after the fonts load. Every chart resizes with its box.

## Selected layout and semantic motifs

The user approved Asymmetric studio and the simpler two-shape PNG studies.
The authoritative spec records the accepted contract; production implementation is pending.

Overview keeps its action title and five linked metrics: Net worth is a dominant teal
lead card with the retained artwork; four secondary metrics sit below in an open layout
with neutral dividers. Goals and FI span the width; Plan and Operational use a 3:2 split
where readable, falling back to one column. FI remains an unboxed exhibit. Overview's
larger section rhythm uses `--s6` vertically and `--s5` horizontally; other block gaps
retain `--s4`. Keep all financial content, page h1 names, routes and first-run behaviour.

### Retained artwork

Preserve the GBI planner brand mark and Overview Net worth artwork exactly as selected.
The brand uses ink, ochre and teal; Net worth uses ink, ochre, teal and peach on `--tint5`.
They do not encode goal identity or financial values. No derived four-part motif family.

### Additional motifs: fixed meanings

The visual references are the approved [light PNG](.scratch/gbi-ui-refinement/assets/motif-previews/two-shapes-light.png)
and [dark PNG](.scratch/gbi-ui-refinement/assets/motif-previews/two-shapes-dark.png).
Use the same relative geometry and fixed colour assignments at every occurrence.

| Meaning | Composition | Placement examples |
| --- | --- | --- |
| Target | Ochre circle inside a teal square outline (Plan / 1) | Goal target definitions |
| Allocation | Joined ochre and teal quarter-discs (Plan / 2) | Allocation weights or planned split |
| Comparison | Two equal peach and teal circles (Measurement / 1) | Performance or plan-vs-actual summary |
| Coverage | Peach square inside an ink square outline (Measurement / 2) | Funded-ratio or level coverage summary |
| Entries | Three ink, ochre and teal squares in a row (Records / 1) | Transaction/import record collections |
| Copy | Overlapping teal and ochre squares (Records / 2) | An explicit copy/duplicate context only |

Choose by the purpose of the section, never its sibling position, screen index, random
seed or numeric data. These motifs supplement explicit headings; users do not need to
learn a pictographic code to operate the app. Omit a motif where the meaning is ambiguous.
Not every motif needs an application if its meaning is absent from the current UI.

At most one motif per relevant section, in dedicated header or lead-card space. No motifs
inside chart plots/legends, table rows, chips, or loading/error states. No new page-title
ornaments, animation or tilted containers. Hide decorative artwork in forced-colour mode.
Keep small functional navigation/section icons and neutral KPI corner rules. Slot 1 / burnt
orange stays reserved for attention; palette, chart encodings and goal identity stay fixed.

### Controls

Checkboxes are 20 px square with 2 px corners, an ink fill and contrasting check when
checked, a dash when indeterminate, and a distinct disabled state. Keep native semantics,
label activation, Space-key operation and visible keyboard focus. Checkbox label rows
are at least 32 px high. Forced-colour mode uses native checkbox rendering.

Chips/tags use `--s1` / `--s2` padding, `--s2` mark gaps, 2 px corners and at least 24 px
height. Labels use 13/18 px, weight 500; product tags remain 12 px uppercase. At-risk,
off-track, medium/high severity and old-price labels retain weight 600. Preserve all
semantic dots, priority marks, status icons, tints, links and glossary popovers.
Form controls/buttons use square corners; table headers and totals use neutral rules.

### Integration status and evidence

The selected prototype remains in `web/overview/BauhausPrototype.tsx` and
`web/overview/bauhaus-prototype.css`; motif PNGs are approval studies, not app screenshots.
Rewrite the validated treatment into existing production components/styles and tokens,
then remove the variant switcher and rejected variants. These are approved design rules,
not a claim that the production build already implements them.

Follow [Adopt the selected Bauhaus UI](.scratch/gbi-ui-refinement/map.md). Visual acceptance
and rollout decisions remain open. Required integration checks: `pnpm gate`, agent-browser
review across screens and both themes, supported desktop widths, keyboard/checkbox states,
forced colours and human visual review. No Playwright. Browser verification is outstanding.
