---
name: Finance OS
description: A local-first decision support system for a self-directed investor — a register of authenticated acts, not a dashboard.
colors:
  ground: "#e4e8ec"
  sheet: "#f7f8fa"
  sheet-sunken: "#eef0f4"
  ink: "#14181d"
  ink-2: "#464e57"
  ink-3: "#5a636d"
  rule: "#cfd5dc"
  rule-strong: "#b6bec7"
  rule-control: "#7b8590"
  seal: "#963029"
  seal-tint: "#f7ecea"
  bollo: "#6f5a12"
  bollo-tint: "#f5f0dd"
  verdigris: "#26624f"
  verdigris-tint: "#e7efeb"
  annot: "#5a3aa8"
  annot-tint: "#eeeaf8"
  projection: "#6b4d8f"
  series-1: "#0e6ea6"
  series-2: "#0b8f68"
  series-3: "#c07408"
  series-4: "#c33f7d"
  series-5: "#3f5cc4"
  series-void: "#7b8590"
typography:
  severity:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1, zero 1"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  designation:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  declared:
    fontFamily: "IBM Plex Serif, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  value:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "-0.01em"
    fontFeature: "tnum 1, zero 1"
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.11em"
rounded:
  none: "0"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "20px"
  sp-6: "24px"
  sp-8: "32px"
  sp-10: "40px"
  sp-12: "48px"
components:
  record:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 16px 16px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.sheet}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  outcome-fired:
    backgroundColor: "{colors.seal}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "1px 8px"
    typography: "{typography.label}"
  outcome-not-fired:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "1px 8px"
  outcome-skipped:
    backgroundColor: "{colors.bollo-tint}"
    textColor: "{colors.bollo}"
    rounded: "{rounded.none}"
    padding: "1px 8px"
  outcome-error:
    backgroundColor: "{colors.seal-tint}"
    textColor: "{colors.seal}"
    rounded: "{rounded.none}"
    padding: "1px 8px"
---

# Design System: Finance OS

> **How to read this file.** Two kinds of statement live here and they carry
> different authority:
>
> | Marker | Meaning |
> |---|---|
> | **[CORPUS]** | Mandated by the RFC corpus or an ADR. Each encodes a domain invariant. **Change the geometry freely; breaking the contract breaks a guarantee the domain went to trouble to make.** Cited inline. |
> | **[DESIGN]** | The designer's decision. Palette construction, type scale, spacing, chart theme, record geometry, copy. **A future reader may replace any of these without touching a domain guarantee** — that is exactly why the two are separated. |
>
> Tokens in the frontmatter are normative for values; this prose is normative
> for *when and why*. Light values are in the frontmatter; the dark counterpart
> of every token is in `src/financeos/web/static/css/tokens.css`, which is the
> single source of truth for both.

## Overview

**Creative North Star: "Il Repertorio"** — the notary's repertory: a numbered,
dated register of authenticated acts in which nothing is ever erased, a
correction arrives as an annotation in the margin beside the original, and the
party's own words are quoted verbatim and set apart from the notary's formula.

The world was chosen because the product's hardest ideas are already native to
it, not because a register is a pleasant metaphor. A `StrategyVersion` is
literally a frozen instrument that supersedes rather than edits, and requires a
`change_note` to be executed (RFC-0007 §7). Apportionment "appends
effective-dated rows; supersedes, never updates" (ADR-0025). Under the
correction model a reclassification rewrites history, so the same question has
different true answers depending on which act you are reading (ADR-0012) — which
is annotation in the margin, exactly. `run_id` and `as_of` are a repertory
number and a date; `input_digest` is the seal. And a real deed records the acts
it could *not* perform, in the instrument, rather than omitting them — which is
the SKIPPED discipline (ADR-0016) arriving for free.

Rendered as a **modern instrument, not an antique**. The register supplies the
structure — ruled sheets, an annotation margin, numbered clauses, three
distinguishable hands. A well-made contemporary data publication supplies the
finish: a validated five-hue categorical palette, charts as a primary way of
reading rather than decoration, real hairlines, honest hierarchy. It is
deliberately more colourful and more chart-forward than the reference mock,
whose muted-paper-plus-CSS-bars direction is the floor and not the target.

Two worlds were refused by name. The **fintech dashboard** — hero net-worth
number, allocation donut, green/red delta pills, rounded cards on a dark navy
ground — is refused because its opening move contradicts Manifest P1 in the
first thing the user sees: it makes the data the product. UX-0001 §5.3 already
withholds the net-worth hero for this reason, and the landing surface is the
findings list. The **editorial broadsheet** — cream ground, hairline rules,
italic display serif, tracked mono labels — is refused because it is what the
reference mock reached for and it is a recognisable house style rather than a
decision. The ground here is therefore cool and faintly blue, never cream.

**Key Characteristics:**

- Zero radius on every surface, control and chip. A register has no rounded corners.
- A ruled **annotation margin** down the left of every record, drawn as a 3px double rule. It is where ordinals, outcome marks and marginal references live, and the body never shifts to accommodate them.
- Cool protocol-paper neutrals with a faint blue cast. Explicitly not cream, not warm, not paper-textured.
- Four **status inks with fixed jobs**, plus five **validated series hues**. Nothing is coloured decoratively.
- **Texture, not hue, carries state.** Solid, hairline, dashed and hatched distinguish the four outcomes; colour only reinforces.
- Three faces, three voices, and the serif is reserved for the user alone.
- Density is welcome. Tables run long, panels carry many labels, the trace ladder is dense on purpose.

## Colors

Restrained by strategy — cool neutrals plus one accent — with a separate,
reserved status vocabulary and a separate validated series palette. Colour
commits at the level of a *field with a fixed meaning*, never as an accent
scattered over a neutral ground.

### Primary

- **Aniline Violet** (`#5a3aa8` light / `#b39af5` dark): the one accent, and it means exactly one thing: **a reference to another authenticated record.** Every link wears it, because in this world a link *is* a marginal reference to a later act. The Reconcile block wears it because it too points at the record that changed. `mode = HYPOTHETICAL` wears it because a hypothetical run is not an authentic act. It is also the focus ring. **[DESIGN]** — the role is derived from the world; the hue is chosen for being unmistakably not a status colour.

### Secondary — the status vocabulary (reserved; never used as a series colour)

- **Seal Carmine** (`#963029` / `#f0857a`): breach. `FIRED`, negative drift, a value short of target, the tolerance rail's index when outside the band. The dull carmine of a cancellation stamp, not a signal red. **[DESIGN]** for the hue; **[CORPUS]** that breach must be distinguishable at all.
- **Bollo Olive** (`#6f5a12` / `#d9b356`): **not evaluated.** `SKIPPED`, the soft over-apportionment warning, a negative UNASSIGNED residual, "no band on this node". The colour of an Italian revenue stamp. **[DESIGN]**.
- **Verdigris** (`#26624f` / `#64c4a0`): inside tolerance. The rail's shaded band, an index within the band, a positive delta. **[DESIGN]**.
- **Projection Violet** (`#6b4d8f` / `#a98cf0`): **reserved and unused in V1.** The Class B channel — see *Do's and Don'ts*. **[CORPUS]** that the channel must exist before a projection ships (RFC-0010 §6.4).

### Tertiary — the series palette

Five categorical hues, assigned to entities in the declared order of the
strategy tree and **never cycled**. Validated with the dataviz validator against
both surfaces: all five checks pass in both modes.

- **Azure** `#0e6ea6` / `#1e77b0` — `EQUITY_DEVELOPED`
- **Teal** `#0b8f68` / `#209871` — `EQUITY_EMERGING`
- **Amber** `#c07408` / `#ca7d1c` — `BOND_GOV_EUR`
- **Magenta** `#c33f7d` / `#cd4986` — `BOND_CORP_IG`
- **Indigo** `#3f5cc4` / `#4765ce` — `CASH`
- **Void Slate** `#7b8590` / `#62707d` + a 45° hatch — **untargeted / UNASSIGNED capital.** It gets no hue on purpose: it is capital with no target that nonetheless stays in the denominator (RFC-0007 §4.1), and reading as void rather than as another category is the honest rendering. It doubles as the texture channel for colour-blind, print and `forced-colors` readers. **[DESIGN]**, discharging a **[CORPUS]** requirement.

Sequential (magnitude, one hue, `--seq-100…700`) and diverging (signed drift;
carmine ↔ azure poles with a **neutral grey midpoint**, never a hue at the
middle) ramps are in `tokens.css`. **[DESIGN]**.

### Neutral

- **Protocol Paper** (`#e4e8ec` / `#10141a`): the page ground; the stack the record sits on. Also the rail, which is the second neutral layer.
- **Sheet** (`#f7f8fa` / `#171c23`): every record surface. **Sunken Sheet** (`#eef0f4` / `#1d232b`) for totals rows and the held step.
- **Iron-gall Ink** (`#14181d` / `#e3e7ea`) at 16.8:1, with secondary `#464e57` at 7.9:1 and register-label `#5a636d` at 5.7:1. Every step clears 4.5:1 on all three surfaces in both themes.
- **Rules**: `#cfd5dc` for table dividers, `#b6bec7` for record frames, and **`#7b8590` for control edges** at 3.5:1 — a separate token precisely because a form control's border is a non-text contrast obligation and a decorative hairline is not.

### Named Rules

**The One Meaning Rule.** Each of the five inks has exactly one job — reference,
breach, not-evaluated, in-tolerance, projection — and no ink is ever borrowed
for emphasis. If a thing needs emphasis and is not one of those five states, it
gets weight or size. **[DESIGN]**

**The Reserved Status Rule.** A status ink is never a series colour and a series
hue never signals state. Where a series hue and a status ink land in the same
hue family, the status always ships with its label and its texture, so hue is
never doing the work alone. **[DESIGN]**, following the dataviz status rule.

**The Cold Paper Rule.** The ground is cool and faintly blue. Cream, ivory,
parchment, warm grey and paper texture are all out — they are the house style
this system was chosen against, and warmth on a surface full of money reads as
reassurance the product has no right to offer. **[DESIGN]**

## Typography

**System Font:** IBM Plex Sans (variable, 100–700) — the system's voice.
**Value Font:** IBM Plex Mono (400, 500) — machine-verifiable values.
**Declared Font:** IBM Plex Serif (400, 400 italic) — the user's own words.

**Character:** three hands from one superfamily. They share metrics, x-height
and design DNA, so a change of face reads as a change of *speaker* and not as a
change of design system. That is the whole reason the triad is one superfamily
rather than three well-matched families. **IBM Plex is a training-data default
face and was still chosen deliberately**, on a reason no other face satisfies:
the three-voice contract needs a genuine Sans + Mono + Serif triad designed
together, released under a libre licence, subsettable and vendorable, with true
tabular figures in the mono cut. Very few families qualify, and Plex is named in
the corpus (UX-0001 §4.5). Operate mode's own guidance prefers workhorse UI
faces here, and a display face would actively damage the contract — see the
Three Voices rule.

### Hierarchy

- **Severity** (Mono 500, 1.75rem/28px, 1.05, −0.02em): the severity readout, and **the only number in the product allowed to be large**.
- **Title** (Sans 600, 1.375rem/22px, 1.25, −0.015em): the page title. One per page.
- **Designation** (Sans 600, 1.125rem/18px): a record's designation. Its minor variant is 0.6875rem tracked caps.
- **Declared** (Serif 400, 1rem/16px, 1.65, ≤68ch): the user's own words. Larger and airier than body because it is the one thing on the page written by a person.
- **Body** (Sans 400, 0.875rem/14px, 1.5, ≤68ch for prose): observations, notes, chrome.
- **Value** (Mono 400/500, 0.8125rem/13px, tabular): every number, every id, every trace row.
- **Label** (Sans 500, 0.6875rem/11px, 0.11em, uppercase): register labels, column heads, field labels.

The scale is **fixed rem, never fluid** — the user is at one desk at one DPI, and
a clamped heading that shrinks inside a panel looks worse, not better. Steps run
at roughly 1.125 because this surface carries many type elements and exaggerated
contrast would read as noise. Minimum type size is **11px, not the mock's
9.5px**: at 9.5px the mock's label ink measured about 2.6:1, which is a real
accessibility failure on the densest and most consequential text in the product.
**[DESIGN]**

### Named Rules

**The Three Voices Rule. [CORPUS — UX-0001 §4.5, elevated to load-bearing by
ADR-L03 §6.]** Sans is the system, Mono is a machine-verifiable value, Serif is
the user's own words. **The system never speaks in serif, and nothing else may
borrow the serif face.** Once the chrome and the user's prose are both Italian,
typography is the *only* remaining signal separating the system's arithmetic
from a restatement of the user's own prior declaration. A fourth display face
would blur exactly that distinction. This is the one aesthetic choice in the
corpus that is load-bearing.

**The Tabular Figures Rule.** Every number carries `tnum` and `zero`. Columns of
digits must align, and a transposed digit must be visible. **[DESIGN]**

**The Stored String Rule. [CORPUS — UX-0001 §4.2.]** Decimals in a trace render
exactly as stored, as strings, never formatted through a float and never passed
through a number filter. it-IT display formatting (ADR-L03 §5.2) applies to
observations and tables; it must never touch a trace value.

## Layout

A two-column shell: a **212px index rail** and the main column, capped at
1180px. The rail is paper rather than dark app chrome, so the whole surface
reads as one document instead of chrome plus content; it uses the `ground`
neutral against the records' `sheet`, which is the second neutral layer an
Operate surface wants. Rail entries are numbered, because a repertory is a
numbered list.

Spacing is a strict **4px base** with no half-steps. Rhythm is tight groups and
generous separation, with **more space above a heading than below it**. Prose
holds a 68ch measure; tables and the trace ladder are free to run denser,
because density is the point on an instrument.

Responsive behaviour is **structural, never fluid type**. At 950px the rail
becomes a horizontal band above the content and the rail foot is dropped; the
provenance bar tightens and hides its reconstructable fields (portfolio, digest,
timestamp) while `as_of` and `mode` stay visible, because those two are what
make the numbers meaningful. At 780px the trace ladder collapses from a grid to
stacked rows, keeping its order. **[DESIGN]**

## Elevation & Depth

**Flat. There are no shadows on any surface.** Depth is carried entirely by
**ruled hairlines and tonal layering** — ground behind sheet behind sunken sheet
— which is how a stack of documents actually reads. The only `box-shadow` in the
system is a 1px **surface ring**, used where two marks would otherwise touch and
merge: the tolerance rail's index marker against a band edge, and adjacent
legend swatches. That is a separation device, not elevation. Chart tooltips are
the sole exception and carry a real offset-plus-blur, because they genuinely
float above the plot.

### Named Rules

**The No-Lift Rule.** Nothing rises. If an element needs to separate from its
neighbour, it gets a rule, a tonal step, or a 1px surface ring. A drop shadow on
a record would make it a card, and a card is the container this system
deliberately does not use. **[DESIGN]**

## Shapes

**Zero radius, everywhere, without exception** — records, buttons, fields,
chips, swatches, tooltips. The form language is entirely **ruled lines**, at
three weights with three meanings:

- **1px hairline** (`rule`) — an ordinary division: a table row, a group boundary.
- **1px firm** (`rule-strong`) — a record's own frame.
- **3px double** — a **structural** boundary: the annotation margin on every record, the page-head rule, the provenance bar's lower edge, the rail's edge. The double rule is the register's own device for "this is the edge of the instrument".

Textures are structural too, and there are exactly two: a **45° hatch** meaning
*void* (untargeted capital, an unbanded tolerance rail, the skip notice's
margin, the Class B channel) and a **−45° hatch** meaning *cancelled / unusable*
(the `ERROR` chip, `mode = HYPOTHETICAL`). Both come from the way unused space
in an official form is struck through so nothing can be added to it later.
**[DESIGN]**

## Components

### The Record

The system's one container, and the reason there are no cards.

- **Shape:** a two-column grid — a 34px annotation margin, then the body. Zero radius, 1px `rule-strong` frame, 3px double rule between margin and body.
- **Background:** `sheet`. A record whose subject is a breach takes a `seal` frame and a `seal` margin rule.
- **Padding:** 12px 16px 16px on the body; a flush variant for records that contain only a table.
- **Why:** cards nest, drift and multiply; a ruled sheet does not. And the margin is load-bearing — a correction in this product is an annotation beside the original, never an edit to it.

### The Tolerance Rail **[CORPUS — UX-0001 §4.1]**

- **Geometry [DESIGN]:** a calibrated scale, 22px tall, graduated at every whole band-width from −3 to +3. Band edges (±1) are verdigris hairlines at band height; the target (0) is a full-height ink tick; the ends (±3) are hard stops. The in-tolerance zone is a filled field at 22% verdigris with hard verdigris edges. The index marker is a 3px stem with a caret, ringed in the surface colour. Overflow pins the marker at 3%/97% and draws a caret in the graduation row *below* the baseline, so marker and caret never collide.
- **Contract [CORPUS]:** `position% = clamp(3, 97, 50 + (signed_severity / 6) × 100)`. Included **unchanged** wherever it appears. It works only because severity is dimensionless (RFC-0007 §3.1), so one gauge is legible across every asset class and both tolerance kinds.
- **Graduations are a deliberate addition.** The mock had a band and a marker and no scale, so a reader could see "outside" but could not *count* band-widths — which is the only quantity the gauge encodes.
- **The unbanded state is explicit.** A legitimately null severity renders the same geometry with the band struck through and no marker, so the absence is visible rather than ambiguous (UX-0001 §6.3).
- **Accessibility:** `role="img"` with a full-sentence Italian `aria-label` carrying the same fact in words, and the numeric severity always printed adjacent in mono.

### Outcome Chips **[CORPUS — UX-0001 §4.4]**

Four outcomes, four treatments, distinguished by **texture** so that colour is
never the sole carrier:

- **`FIRED`** — solid `seal` fill, sheet-coloured text. The heaviest ink on the page.
- **`NOT_FIRED`** — no fill, hairline `rule-control` border, `ink-2` text. **The only outcome permitted to be quiet.**
- **`SKIPPED`** — `bollo` text on `bollo-tint`, **dashed** border: the record is incomplete.
- **`ERROR`** — `seal` text, solid `seal` border, **hatched** ground: void. The system does not know.
- **`PROIEZIONE`** — reserved, dashed `projection`. Unused in V1.

Every `SKIPPED` and `ERROR` chip is accompanied by its reason. A chip with no
reason is a bug: "not evaluated, cause unknown" is precisely the false
reassurance ADR-0016 exists to prevent.

### The Skip Notice **[CORPUS — UX-0001 §4.4, ADR-0016, ADR-L03 §5.3]**

Persistent, not dismissible, styled as a record with a hatched margin. Leads
with the count, then the load-bearing sentence — **«Non valutato non significa
conforme.»** — then the authored per-reason explanations. ADR-L03 §5.3 requires
this copy be authored in Italian rather than translated; a limp rendering would
quietly undo the discipline it enforces. Do not soften it, do not move it below
the reasons, and do not replace it with a neutral count. **The count alone is
the false reassurance.**

### The Trace Ladder **[CORPUS — UX-0001 §4.2]**

Monospace grids, never prose: bindings as `name · value · source`, steps as
`# · op · operands · result`. Every binding's source is a link wherever it
resolves — that walkable chain *is* P7. The terminal step is the **held step**:
sunken ground, a rule above it, its result in `seal`. Everything above reads as
an already-established premise, and every intermediate result stays visible
rather than hiding behind a hover. **[DESIGN]** for the held-step staging.

### The Provenance Bar **[CORPUS — UX-0001 §4.3]**

Sticky at the top of every screen: portfolio · `as_of` · `run_id` · `mode` ·
`input_digest`. Sheet ground, 3px double rule below. `mode` is a chip: `ACTUAL`
is solid ink; `HYPOTHETICAL` is hatched in the annotation ink because a
hypothetical run produces zero recommendations and must never be mistaken for an
authentic act. A page with no run behind it renders an explicit "nessuna
valutazione" strip — **omitting the bar is not an option**, because a silent
absence is indistinguishable from a run whose fields failed to load.

### Charts **[CORPUS: as-recorded only. DESIGN: everything visual.]**

- **Theme from tokens, read off the chart element itself.** One helper builds an ECharts theme from the CSS custom properties in scope on the element, so a chart is correct inside any themed container and cannot drift from the interface. **A server-assembled option must contain no hex colours.** Where a mark needs a specific role a theme cannot express — a target reference tick, the in-tolerance band — the option says `"token:--ink-2"` and the helper resolves it from the token layer.
- **Series identity is never colour alone:** a legend is always present for two or more series, classes are direct-labelled on the axis, stacked fills carry a 2px surface gap, and marks carry a 1px surface ring.
- **One axis, always.** Never a second y-scale. A target is a reference mark on the same axis, drawn in ink so it reads as the strategy's mark and not as another measured quantity.
- **it-IT number formatting** on value axes and tooltips by default, so a chart never prints `1.5` beside a table printing `1,5`.
- **The data table is not a fallback.** It ships in the document, open, and the helper collapses it only after a chart is successfully live. With JS off or broken, the reader keeps every number.
- **HTMX lifecycle:** init on `htmx:load`, dispose on `htmx:beforeSwap`.

### Buttons, Fields, States

- **Buttons:** zero radius, 1px border. Primary is solid ink; ghost is transparent with a `rule-control` edge. Disabled loses its fill and drops to `ink-3` on a `rule-control` edge — never a faded solid.
- **Fields:** `sheet` ground, `rule-control` edge at 3.5:1, zero radius. Invalid takes a `seal` edge plus `seal-tint` ground *and* a message naming the problem and the arithmetic that failed. A textarea for the user's own prose uses the **serif** face, because what goes in it is the user's own words.
- **Loading:** a ruled skeleton, never a spinner in the middle of content. Static under `prefers-reduced-motion`.
- **Empty:** teaches, and does not reassure. "Nessun rilievo aperto" is always followed by what was actually evaluated, when, and the explicit statement that this is not a certificate of compliance.

## Do's and Don'ts

### Do:

- **Do** include `partials/tolerance_rail.html` unchanged wherever a band position appears. Extend that one file; never fork the geometry.
- **Do** pass trace decimals as the stored strings and apply **no** filter to them.
- **Do** give every `SKIPPED` and `ERROR` its reason, every time.
- **Do** pair every hue with a label, a texture, or a shape. Assume a greyscale print and a red-green colour-blind reader on every screen.
- **Do** re-run `dataviz/scripts/validate_palette.js` against **both** surfaces after touching any series hue, and keep all five checks green.
- **Do** keep the serif face for the user's words alone.
- **Do** render `role="img"` plus a full-sentence Italian `aria-label` on every gauge, and keep the numeric value adjacent in mono.
- **Do** use the 3px double rule only for structural boundaries, and the 1px hairline for ordinary divisions.

### Don't:

- **Don't** put a net-worth hero number on the landing surface. **[CORPUS — UX-0001 §5.3, Manifest P1.]** The decisions are the product; net worth lives one click away.
- **Don't** style `SKIPPED` or `ERROR` as reassurance, and don't render a finding count without the skip notice beside it. **[CORPUS — ADR-0016.]**
- **Don't** add a fourth type face, and don't let the system speak in serif. **[CORPUS — UX-0001 §4.5 / ADR-L03 §6.]**
- **Don't** reference an off-origin URL from any template, stylesheet or asset — no CDN, no Google Fonts, no chart library from a network host. **[CORPUS — ADR-0008 Local First, ADR-L03 §4, enforced by CI.]**
- **Don't** put a hex colour in a server-assembled chart option. Use a `token:--name` reference.
- **Don't** build a dual-axis chart, a donut for allocation, or a rainbow ramp.
- **Don't** re-sort a findings list in the template. The order is `priority_rank DESC, severity DESC NULLS LAST, rule_id ASC` and the authored priority band dominates severity. **[CORPUS — RFC-0008 §3.]**
- **Don't** collapse correlated findings. One cause showing as three findings is correct. **[CORPUS — RFC-0008 §4.1.]**
- **Don't** hide a legal-but-alarming state: a negative `UNASSIGNED` residual is a signed row in the same table, so the column still totals to net worth. **[CORPUS — ADR-0025.]**
- **Don't** ship a Class B (projection) finding until it is visually distinguishable from a Class A finding, carries its assumption inline, and its severity is kept out of any column sorted against Class A severities. **[CORPUS — RFC-0010 §6.4: this is a kill criterion.]** The `--projection` token and `.record--projection` / `.outcome--projection` / `.assumption` rules are reserved for it. **Do not delete them because they are currently unreferenced.**
- **Don't** round a corner, lift a surface with a shadow, or warm the ground toward cream.
- **Don't** add a token to silence a linter. Every colour here is contrast-verified and every series hue is validator-verified; a value earns its place by legibility and by the world, never by silencing a check.
