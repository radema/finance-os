---
name: Finance OS
description: A local-first decision support system for a self-directed investor — a register of authenticated acts, not a dashboard.
colors:
  ground: "#cfe2f8"
  sheet: "#f1f8ff"
  sheet-sunken: "#bbd2ed"
  ink: "#272c33"
  ink-2: "#4e555f"
  ink-3: "#67717d"
  rule: "#cbdaec"
  rule-strong: "#a8b7c9"
  rule-control: "#838f9e"
  alarm: "#931b1f"
  alarm-tint: "#f4eaea"
  caution: "#9b5d00"
  caution-tint: "#f4ecde"
  annot: "#004a5f"
  annot-tint: "#e1f0f4"
  edge: "#173239"
  band: "#d0e0f2"
  band-edge: "#7690af"
  projection: "#621e76"
  projection-tint: "#f1eaf4"
  series-1: "#ab2890"
  series-2: "#507dff"
  series-3: "#1fa31e"
  series-4: "#0099cc"
  series-5: "#8c4ace"
  series-void: "#818fa0"
  seq-100: "#8caef9"
  seq-200: "#7297ea"
  seq-300: "#5e81d2"
  seq-400: "#4a6cbb"
  seq-500: "#3757a4"
  seq-600: "#25438e"
  seq-700: "#142f78"
  div-under-3: "#94151c"
  div-under-2: "#ad3231"
  div-under-1: "#c74b47"
  div-mid: "#d1d7de"
  div-over-1: "#1787a8"
  div-over-2: "#126f8b"
  div-over-3: "#0c586f"
  chart-grid: "#d0dff2"
  chart-axis: "#a8b7c9"
typography:
  severity:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1, zero 1"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  designation:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  declared:
    fontFamily: "Faustina, Georgia, Times New Roman, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  value:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "-0.01em"
    fontFeature: "tnum 1, zero 1"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
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
    backgroundColor: "{colors.alarm}"
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
    backgroundColor: "{colors.caution-tint}"
    textColor: "{colors.caution}"
    rounded: "{rounded.none}"
    padding: "1px 8px"
  outcome-error:
    backgroundColor: "{colors.alarm-tint}"
    textColor: "{colors.alarm}"
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
> for *when and why*. **The frontmatter carries the LIGHT scheme only. The dark
> counterpart of every token lives in
> `src/financeos/web/static/css/tokens.css`, which is the single source of truth
> for both** — this world is dark-first, so `:root` there carries dark and light
> is the override. Neither scheme is a flip of the other: every ink and every
> series step is separately solved against its own surface.
>
> **No hex in this file was picked by hand.** Every value is produced by
> `docs/design/palette_search.py` and re-verified against every gate on each
> run. To change a colour, change a gate or a declared parameter and re-run the
> solver. Do not edit a hex here or in `tokens.css`.

## Overview

**Creative North Star: "Vetro Sommerso"** — Murano *sommerso*: a piece built as
submerged layers of glass, a deep coloured ground with luminous canes read
against it, one light source, and hard cut edges.

The world was not chosen as a mood. **Sommerso is the technique of casing one
colour inside another, and that is *literally* what an apportioned allocation
is**: a declared shape (the frozen strategy's target) with an actual quantity
sitting inside it. So the palette question and the chart-form question stop
being two decisions and become one — the mark that carries an allocation is a
*cased cane*, and the ground it is read against is the same glass. That
identity, not the hues, is why this world beat "a bar chart with nicer
colours". **[DESIGN]**

**Dark is the base declaration, not a preference.** `:root` carries the dark
scheme and light is the override, because this world is a deep ground with light
coming through it; a reader with no stated preference gets the world as
designed. The light scheme is the same piece on a bright table — separately
solved, equally gated. **[DESIGN]**

Three worlds are refused by name.

- The **fintech dashboard** — hero net-worth number, allocation donut, green/red
  delta pills, rounded cards — is refused because its opening move contradicts
  Manifest P1 in the first thing the user sees: it makes the data the product.
  UX-0001 §5.3 already withholds the net-worth hero, and the landing surface is
  the findings list. **[CORPUS]** for the withholding; **[DESIGN]** for the rest.
- The **editorial broadsheet** — cream ground, hairline rules, italic display
  serif, tracked mono labels — is refused because it is a recognisable house
  style rather than a decision, and it is what the reference mock reached for.
- **The archival register is now anti-reference, not a reference (P12).** The
  first identity built here was a coherent Italian archival document — sealing
  wax, revenue-stamp ochre, verdigris, annotation violet, paper grounds — and
  its chart ramp reverted to the stock BI categorical palette, so the chrome
  committed to an identity and the charts abandoned it. The owner's verdict was
  "generic, no identity", and the resolution chosen was *replace*, not polish.
  **Do not reintroduce sealing wax, revenue-stamp ochre, verdigris, paper
  texture or a cream ground: each one is a named rejection.**

What survives from that first build is **structure, not identity**: the record
with its annotation margin, the numbered index rail, the four outcome
treatments, the trace ladder, the provenance bar, the skip notice. Those are
corpus shapes and they were never the problem.

**Key Characteristics:**

- **Zero radius on every surface, control and chip.** Cut glass has hard edges.
- **One light source for the whole world.** `--edge` is it: the cane's luminous leading edge, the rail's index marker, the field's focus edge. Depth is `--lift`, an inset luminous hairline — never a drop shadow.
- **Grounds carry real chroma, and the deepest layer carries the most**, because in sommerso the thickest glass does. Cool cobalt glass at hue 265°, never cream and never neutral grey.
- **The warm half of the wheel belongs to status; data lives in the cool half.** A warm mark in this interface is never a measurement.
- **Two reserved status inks with fixed jobs** (alarm, caution), a **reference ink that is the light** (`--annot`), and **five solved series canes**. Nothing is coloured decoratively.
- **In-tolerance is neutral, not green.** The system reports; it does not congratulate.
- **Geometry, not hue, carries polarity.** A shortfall is unfilled casing; an overshoot is a protrusion. The chart reads with no colour at all.
- **Texture, not hue, carries state.** Solid, hairline, dashed and hatched distinguish the four outcomes; colour only reinforces.
- **Three faces, three voices, and the serif is reserved for the user alone.**
- Density is welcome. Tables run long, the trace ladder is dense on purpose.

## Colors

### No hex here was chosen. All of them were solved.

`docs/design/palette_search.py` owns every colour in the system. It
re-implements, in Python, exactly the maths of `dataviz/scripts/validate_palette.js`
— sRGB↔linear, OKLab/OKLCH, WCAG contrast, Machado–Oliveira–Fernandes 2009 CVD
simulation at severity 1.0, Euclidean OKLab ΔE×100 — and solves grounds, inks,
reserved inks and the five series slots, in **both schemes**, against these
gates:

| Gate | Value | Why it is there |
|---|---|---|
| OKLCH lightness band | 0.43–0.77 light · 0.48–0.67 dark | a cane must read as a cane on its own surface |
| chroma **floor** | **0.125** (the validator's is 0.10) | sitting on the validator's floor is what made three candidate worlds look alike |
| chroma **ceiling** | **0.20** | jewel glass, not neon |
| adjacent CVD ΔE | **≥ 10.0** (target is 8.0) | the margin stops a future re-step sliding into the 6–8 warn band |
| adjacent normal-vision ΔE | ≥ 15 | |
| all-pairs normal-vision ΔE | ≥ 12 | |
| minimum pairwise hue | ≥ 34° | forbids "two violets" |
| contrast vs. own sheet | ≥ 3.05:1 | a mark against its surface, non-text AA plus rounding margin |
| separation from every reserved ink | 15 normal / 8 CVD | a status ink may never impersonate a datum |

**The solution is recorded as data (`SOLVED_SERIES`) and re-verified against
every gate on each run.** Changing a gate, a ground or a reserved ink therefore
*fails the run* rather than silently invalidating the palette. Re-run with
`--search` (~2 min of annealing) and paste the answer back. Confirmed
independently with the real validator: all checks PASS in both modes, plus the
sequential ramps under `--ordinal`. **[DESIGN]** for the construction;
**[CORPUS]**-adjacent only in that series identity must be distinguishable at
all.

### The rule the whole palette rests on

**The Warm Half Rule. THE WARM HALF OF THE WHEEL BELONGS TO STATUS; DATA LIVES
IN THE COOL HALF.** The two reserved status hue *windows* — alarm 8–34°, caution
66–96° — are excluded from the series set **outright**, not merely separated by
a distance metric, with a further 30° margin between any series slot and either
window.

**This came out of a failure, not out of taste.** A run that was only
distance-gated parked a series slot at hue **13.6°**, one lightness step off the
crimson alarm ink, and passed every measured check at exactly the threshold:
measurably distinct, and still the alarm colour carrying a datum. A metric that
can be satisfied at its own boundary is not a rule. So the windows are excluded
categorically — and the consequence is a gain, because the reserved amber and
crimson now read as *meaning* warmth. **[DESIGN]**

### Grounds — three thicknesses of glass

- **`--ground`** `#cfe2f8` light / `#000223` dark — the page, and the index rail: the bottom of the piece.
- **`--sheet`** `#f1f8ff` / `#06102c` — every record surface.
- **`--sheet-sunken`** `#bbd2ed` / `#151f38` — an inset: totals rows, the held step.

**A ground owes contrast to *text* only, never to a series, so it is the one
surface with real chromatic headroom — and this is where the palette was
pushed.** Chroma is a stated target, not a fraction of the gamut: 0.075 / 0.058
/ 0.050 in dark at hue 265°, against **0.028** in the candidate proof. The
deepest layer carries the most colour. **Rejected:** taking 92% of the sRGB gamut
at the deepest step, which returned a pure ultramarine black that reads as a
colour field rather than as a ground. **[DESIGN]**

### The reserved status vocabulary (never a series colour)

- **`--alarm`** `#931b1f` / `#ff8178` — **breach.** `FIRED`, negative drift, a value short of target, the rail's index when outside the band. 8.1:1 / 7.8:1 as text on its own sheet, and ≥ 7.4:1 on its own tint. **[DESIGN]** for the hue; **[CORPUS]** that breach must be distinguishable at all.
- **`--caution`** `#9b5d00` / `#d79700` — **not evaluated.** `SKIPPED`, the soft over-apportionment warning, a negative `UNASSIGNED` residual, "no band on this node". 5.0:1 / 7.4:1 as text, 4.5:1 on its own tint. **[DESIGN]**
- **`--projection`** `#621e76` / `#cb96fb` — **reserved and unused in V1.** The Class B channel; see *Do's and Don'ts*. **[CORPUS]** that the channel must exist before a projection ships (RFC-0010 §6.4).

Both status inks clear 4.5:1 as text against **both** the sheet and their own
tint in **both** schemes — which is the check that decides whether `SKIPPED` and
`ERROR` read as caution or as reassurance.

**Rejected: no chroma ceiling on the reserved inks.** The first solve returned
`#ff046f`, `#00ecfe`, `#fa00fe` — legible, gated, entirely correct, and a rave.
A status ink is a stamp.

### The reference ink is the light

**`--annot`** `#004a5f` / `#a4eefb` — a reference to another authenticated
record. Every link wears it, because in this world a link *is* a marginal
reference to a later act; the Reconcile block wears it; `mode = HYPOTHETICAL`
wears it; it is also the focus ring. 9.1:1 / 14.5:1.

It is solved at an **extreme lightness** — near-black in light, near-white in
dark — in the same hue family (205–225°) as `--edge`, not as a mid-lightness
cyan. **Rejected:** mid-lightness cyan. It competed with the data for hue space,
and the search could not place five classes while holding 12 ΔE from it. Solving
the reference by *lightness* separates it from every series by ΔL ≥ 0.25 and
hands the whole cool half of the wheel back to the data. Links also always carry
an underline, so the reference is never colour-alone anyway. **[DESIGN]**

**`--edge`** `#173239` / `#c1e0e8` — **the single light source of the world.**
One token, not a lighter step per hue: the cane's luminous leading edge, the
rail's index marker, the focus edge on a field. Where you see `--edge`, you are
reading an exact value. **[DESIGN]**

### In-tolerance is neutral, not green

**`--band`** `#d0e0f2` / `#1e273b` with **`--band-edge`** `#7690af` / `#526282`
(3.1:1 non-text). **`--verdigris` is deleted, and its role with it.** The system
reports; it does not congratulate, and being inside your own declared band is
the *absence* of a finding, not an achievement. Only a departure from a declared
target takes colour.

The rail's band is therefore the **casing** drawn in the ground's own glass, and
its index marker is drawn in `--edge` — the same token as a cane's luminous
edge, because both answer "where do I read the exact value". One geometry, two
states; the `--breach` modifier is all that changes. `.value--positive` no longer
takes a "good" colour; it is `--ink`. **[DESIGN]**

### The series palette — five canes

Five categorical hues, assigned to entities in the declared order of the
strategy tree and **never cycled**, not even when a filter changes the series
count.

| Token | Light | Dark | Hue | Class (L05 fixture) |
|---|---|---|---|---|
| `--series-1` | `#ab2890` | `#dd5bbe` | 338° | `EQUITY_DEVELOPED` |
| `--series-2` | `#507dff` | `#3056d5` | 266° | `EQUITY_EMERGING` |
| `--series-3` | `#1fa31e` | `#009105` | 143° | `BOND_GOV_EUR` |
| `--series-4` | `#0099cc` | `#1a9ed1` | 231° | `BOND_CORP_IG` |
| `--series-5` | `#8c4ace` | `#833fc4` | 304° | `CASH` |
| `--series-void` | `#818fa0` | `#596273` | — | untargeted / `UNASSIGNED` |

**`--series-void` gets no hue on purpose.** It is capital with no declared target
that nonetheless stays in the denominator (RFC-0007 §4.1), so it reads as *void*
rather than as a sixth category: neutral plus a 45° hatch decal drawn inside the
canvas. It doubles as the texture channel dataviz requires for CVD, print and
`forced-colors`. **[DESIGN]**, discharging a **[CORPUS]** requirement.

**A sixth *targeted* class is not a generated hue.** Fold to "altro" or facet the
chart. Mean series chroma is **0.184**, against ~0.10 (on the floor) in the
candidate proof.

### The measured numbers, and what covers them

| | Candidate proof | **Now** |
|---|---|---|
| worst adjacent CVD, dark | **7.6 protan** — a WARN, 6–8 band | **10.6 protan** |
| worst adjacent CVD, light | — | **10.8 deutan** |
| worst adjacent normal-vision ΔE | — | 24.2 dark / 21.9 light |
| worst adjacent **tritan** ΔE | — | 8.3 dark / **4.8 light** |
| worst **all-pairs** CVD ΔE | — | **3.4 dark** / 8.4 light |
| mean series chroma | ~0.10 | **0.184** |
| minimum pairwise hue | — | 34° |

**The 7.6 protan warn is gone.** Two numbers still need covering, and they are
covered unconditionally — never by a promise:

- **Tritan 4.8 in light.** The validator *reports* tritan and does not gate it.
  It is not dismissable here either.
- **All-pairs CVD 3.4.** This one cannot be fixed and **must not be chased**: any
  five-hue set wide enough to look varied contains a red/green pair, and those
  collapse under protanopia by construction. Optimising for all-pairs was tried,
  and it pushes the answer straight back to a blues-and-violets set — the exact
  thing the owner rejected. The applicable gate for bars, stacks and lines is the
  **adjacent** pairlist, because only neighbours are compared.

**Secondary encoding is therefore mandatory, unconditional and shipped:** a
legend is always present; every class is **also** direct-labelled on the axis
(wrapped, never truncated); every fill carries a 2px surface gap; the void cane
carries a hatch decal; the luminous leading edge marks the value without colour;
and the cased cane's polarity is **geometric**. **Never colour alone.**

**Recorded consequence that binds a future screen. [DESIGN]** A scatter, bubble
or choropleth in this product may carry at most **three** series, because those
forms put any two marks side by side and so need *all-pairs* separation, and
three is what five hues can deliver. Fold to "altro" or facet — never re-hue.

### Ramps

**Sequential** (`--seq-100…700`, magnitude such as severity over runs): one hue,
monotone lightness, ΔL ≈ 0.07 per step, light end 2.0:1, passing the ordinal
gates in both schemes. **Diverging** (`--div-under-3…--div-over-3`, signed drift
around a target): two poles and a **neutral midpoint**, never a hue at the
middle. Under-target wears the alarm family, because falling short of a declared
target is this product's core finding. **[DESIGN]**

### Ink ladder and rules

- **`--ink`** `#272c33` / `#d2d7e1` at **13.1:1 / 13.0:1** on its own sheet, **`--ink-2`** at 7.0 / 7.1:1, **`--ink-3`** at 4.6:1. Solved by bisection onto their contrast targets, not sampled.
- **Rules:** `--rule` (table dividers, decorative), `--rule-strong` (record frames), and **`--rule-control` at 3.06 / 3.07:1** — a separate token precisely because a form control's border is a non-text contrast obligation and a decorative hairline is not.
- Contrast was verified **by computation, not by eye**, in both schemes. See `docs/design/palette.json` → `report`.

### Named Rules

**The One Meaning Rule.** Each reserved ink has exactly one job — breach,
not-evaluated, reference, projection — and no ink is ever borrowed for emphasis.
If a thing needs emphasis and is not one of those states, it gets weight or
size. **[DESIGN]**

**The Reserved Status Rule.** A status ink is never a series colour and a series
hue never signals state. This is enforced upstream by excluding the status hue
windows from the search, not downstream by review. **[DESIGN]**, following the
dataviz status rule.

**The Cold Glass Rule.** The ground is cool cobalt glass. Cream, ivory,
parchment, warm grey and paper texture are all out — they are the house style
this system was chosen against, and warmth on a surface full of money reads as
reassurance the product has no right to offer. **[DESIGN]**

## Typography

**System Font:** **Archivo** (variable, 100–700) — the system's voice.
**Value Font:** **IBM Plex Mono** (400, 500) — machine-verifiable values.
**Declared Font:** **Faustina** (variable 400–600, **upright**) — the user's own words.

### The cross-graft, taken by half

The three-voice contract is corpus-mandated; the faces are not. When the world
was replaced, the candidate proof's type pairing was re-examined and **adopted by
half**, on measurement rather than preference:

- **Archivo — yes.** It was the strongest single asset of any candidate world, and one variable file serves 400–700, so the whole system voice costs one request.
- **Martian Mono — no.** Its advance width is roughly **40% wider** than IBM Plex Mono's, and the mono voice carries the trace ladder: the densest and most load-bearing text in the product. A wrapped derivation is a worse explanation, and no amount of character is worth that. Plex Mono stays, with true tabular figures. **If Plex Mono is ever dropped, `LICENSE-IBM-Plex.txt` must change with it.**
- **Faustina — yes, but upright, not the italic cut the candidate proof used.** The declared voice carries a whole authored `change_note` and fills a textarea the user types into; a full paragraph of italic serif, in a field, is affectation at the cost of legibility.

The three faces are **not** one superfamily, which is a deliberate trade: the
first identity chose a superfamily so that a change of face would read as a
change of *speaker*, and the cost was that the whole product read as one
undifferentiated default. Archivo / Plex Mono / Faustina are separated by
*structure* — grotesque, mono, and a serif with a high x-height that sits
comfortably beside them — so the three voices are still unmistakable, and none
of them is a training-data default. All three are libre-licensed, subsetted and
vendored locally; `fonts/FONTS.txt` carries the OFL copyright and Reserved Font
Name for each. **[DESIGN]**

### Hierarchy

- **Severity** (Archivo 500, 1.75rem/28px, 1.05, −0.02em, tabular): the severity readout, and **the only number in the product allowed to be large**.
- **Title** (Archivo 600, 1.375rem/22px, 1.25, −0.015em): the page title. One per page.
- **Designation** (Archivo 600, 1.125rem/18px): a record's designation. Its minor variant is 0.6875rem tracked caps.
- **Declared** (Faustina 400, 1rem/16px, 1.65, ≤68ch): the user's own words. Larger and airier than body because it is the one thing on the page written by a person.
- **Body** (Archivo 400, 0.875rem/14px, 1.5, ≤68ch for prose): observations, notes, chrome.
- **Value** (Plex Mono 400/500, 0.8125rem/13px, 1.7, tabular): every number, every id, every trace row.
- **Label** (Archivo 500, 0.6875rem/11px, 0.11em, uppercase): register labels, column heads, field labels.

The scale is **fixed rem, never fluid** — the user is at one desk at one DPI, and
a clamped heading that shrinks inside a panel looks worse, not better. Steps run
at roughly 1.125, because this surface carries many type elements and
exaggerated contrast would read as noise. Minimum type size is **11px, not the
mock's 9.5px**: at 9.5px the mock's label ink measured about 2.6:1, a real
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
corpus that is load-bearing. **The faces are [DESIGN] and replaceable; the
three-voice split is not.**

**The Tabular Figures Rule.** Every number carries `tnum` and `zero`. Columns of
digits must align, and a transposed digit must be visible. **[DESIGN]**

**The Stored String Rule. [CORPUS — UX-0001 §4.2.]** Decimals in a trace render
exactly as stored, as strings, never formatted through a float and never passed
through a number filter. it-IT display formatting (ADR-L03 §5.2) applies to
observations, tables and charts; it must never touch a trace value.

## Layout

A two-column shell: a **212px index rail** and the main column, capped at
1180px. The rail is the **deepest layer of the piece** — it takes `--ground`
against the records' `--sheet` — so the whole surface reads as one object
submerged in one glass rather than as dark chrome plus content. Rail entries are
numbered, because an index is a numbered list. It is separated by the same 3px
double rule that defines every record's margin.

Spacing is a strict **4px base** with no half-steps. Rhythm is tight groups and
generous separation, with **more space above a heading than below it**. Prose
holds a 68ch measure; tables and the trace ladder run denser, because density is
the point on an instrument.

Responsive behaviour is **structural, never fluid type**. At 950px the rail
becomes a horizontal band above the content and the rail foot is dropped; the
provenance bar tightens and hides its reconstructable fields (portfolio, digest,
timestamp) while `as_of` and `mode` stay visible, because those two are what
make the numbers meaningful. At 780px the trace ladder collapses from a grid to
stacked rows, keeping its order. **[DESIGN]**

## Elevation & Depth

**One named elevation level: `--lift`.** It is an *inset luminous hairline*
along the top of a surface — `inset 0 1px 0 0 var(--lift-ink)`, where
`--lift-ink` is `--edge` at 10% (light) / 14% (dark). It reads as the top face of
a layer of glass catching the single light source, which is the only kind of
depth this world has.

**Nothing casts a shadow, because a submerged layer does not.** Depth otherwise
comes from tonal layering — ground behind sheet behind sunken sheet — and from
ruled hairlines.

**The one exception is the chart tooltip**, which carries a real offset-plus-blur
because it genuinely floats above its plot.

The 1px **surface ring** (`0 0 0 1px var(--sheet)`) is not elevation and is not
an exception: it is a *separation* device, used where two marks would otherwise
touch and merge — the rail's index marker against a band edge, adjacent legend
swatches, a mark against its own fill.

### Named Rules

**The One Light Rule.** There is exactly one light source, and it is `--edge`.
Every luminous mark in the product — the cane's leading edge, the rail's index,
a focus edge, `--lift` — is cut from it. A second highlight colour, or a
per-hue lighter step, breaks the world. **[DESIGN]**

**The No-Shadow Rule.** Nothing rises. If an element needs to separate from its
neighbour it gets a rule, a tonal step, a surface ring, or `--lift`. A drop
shadow on a record would make it a card, and a card is the container this system
deliberately does not use. **[DESIGN]**

## Shapes

**Zero radius, everywhere, without exception** — records, buttons, fields,
chips, swatches, tooltips. Cut glass has hard edges. The form language is
**ruled lines**, at three weights with three meanings:

- **1px hairline** (`--rule`) — an ordinary division: a table row, a group boundary.
- **1px firm** (`--rule-strong`) — a record's own frame.
- **3px double** — a **structural** boundary: the annotation margin on every record, the page-head rule, the provenance bar's lower edge, the rail's edge.

Textures are structural too, and there are exactly two: a **45° hatch** meaning
*void* (untargeted capital, an unbanded tolerance rail, the Class B channel) and
a **−45° hatch** meaning *cancelled / unusable* (the `ERROR` chip, `mode =
HYPOTHETICAL`, the skip notice's margin). **[DESIGN]**

## Components

### The Record

The system's one container, and the reason there are no cards.

- **Shape:** a two-column grid — a 34px annotation margin, then the body. Zero radius, 1px `--rule-strong` frame, 3px double rule between margin and body, `--lift` along the top.
- **Background:** `--sheet`. A record whose subject is a breach takes an `--alarm` frame and an `--alarm` margin rule.
- **Padding:** 12px 16px 16px on the body; a flush variant for records that contain only a table.
- **Why:** cards nest, drift and multiply; a ruled sheet does not. And the margin is load-bearing — a correction in this product is an annotation beside the original, never an edit to it (ADR-0012).

### The Tolerance Rail **[CORPUS — UX-0001 §4.1]**

- **Geometry [DESIGN]:** a calibrated scale, 22px tall, graduated at every whole band-width from −3 to +3. The in-tolerance zone is the **casing**: a filled field in `--band` with hard `--band-edge` edges — neutral, because being inside your band is not an achievement. The target (0) is a full-height ink tick; the ends (±3) are hard stops. The index marker is a 3px stem with a caret, drawn in `--edge` and ringed in the surface colour; the `--breach` modifier — and nothing else — swaps it to `--alarm`. Overflow pins the marker at 3%/97% and draws its caret in the graduation row *below* the baseline, so marker and caret never collide.
- **Contract [CORPUS]:** `position% = clamp(3, 97, 50 + (signed_severity / 6) × 100)`. Included **unchanged** wherever it appears. It works only because severity is dimensionless (RFC-0007 §3.1), so one gauge is legible across every asset class and both tolerance kinds.
- **Graduations are a deliberate addition.** The mock had a band and a marker and no scale, so a reader could see "outside" but could not *count* band-widths — which is the only quantity the gauge encodes.
- **The unbanded state is explicit.** A legitimately null severity renders the same geometry with the band struck through and no marker, so the absence is visible rather than ambiguous (UX-0001 §6.3).
- **Accessibility:** `role="img"` with a full-sentence Italian `aria-label` carrying the same fact in words, and the numeric severity always printed adjacent in mono.

### Outcome Chips **[CORPUS — UX-0001 §4.4]**

Four outcomes, four treatments, distinguished by **texture** so that colour is
never the sole carrier:

- **`FIRED`** — solid `--alarm` fill, sheet-coloured text. The heaviest ink on the page.
- **`NOT_FIRED`** — no fill, hairline `--rule-control` border, `--ink-2` text. **The only outcome permitted to be quiet.**
- **`SKIPPED`** — `--caution` text on `--caution-tint`, **dashed** border: the record is incomplete.
- **`ERROR`** — `--alarm` text, solid `--alarm` border, **hatched** ground: void. The system does not know.
- **`PROIEZIONE`** — reserved, dashed `--projection`. Unused in V1.

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
sunken ground, a rule above it, its result in `--alarm`. Everything above reads
as an already-established premise, and every intermediate result stays visible
rather than hiding behind a hover. **[DESIGN]** for the held-step staging.

### The Provenance Bar **[CORPUS — UX-0001 §4.3]**

Sticky at the top of every screen: portfolio · `as_of` · `run_id` · `mode` ·
`input_digest`. Sheet ground, 3px double rule below. `mode` is a chip: `ACTUAL`
is solid ink; `HYPOTHETICAL` is hatched in the annotation ink, because a
hypothetical run produces zero recommendations and must never be mistaken for an
authentic act. A page with no run behind it renders an explicit "nessuna
valutazione" strip — **omitting the bar is not an option**, because a silent
absence is indistinguishable from a run whose fields failed to load.

### Buttons, Fields, States

- **Buttons:** zero radius, 1px border. Primary is solid ink; ghost is transparent with a `--rule-control` edge. Disabled loses its fill and drops to `--ink-3` on a `--rule-control` edge — never a faded solid.
- **Fields:** `--sheet` ground, `--rule-control` edge at 3.1:1, zero radius. Focus is a 2px `--focus` outline at 2px offset, and `--focus` is `--annot` — a focus ring is a reference to where you are. Invalid takes an `--alarm` edge plus `--alarm-tint` ground *and* a message naming the problem and the arithmetic that failed. A textarea for the user's own prose uses the **Faustina** face, because what goes in it is the user's own words.
- **Loading:** a ruled skeleton, never a spinner in the middle of content. Static under `prefers-reduced-motion`.
- **Empty:** teaches, and does not reassure. "Nessun rilievo aperto" is always followed by what was actually evaluated, when, and the explicit statement that this is not a certificate of compliance.

## The Chart Language

**[CORPUS: as-recorded only. DESIGN: everything visual.]** This is a *system*,
not a set of recoloured defaults: axis, grid, tooltip, legend, mark roles, empty
and single-point states are all decided once, in
`src/financeos/web/static/js/charts.js`, so every future chart inherits them.
The first identity failed precisely because chrome committed to a world and the
charts did not (P12).

### The theme is read off the chart element

One helper builds an ECharts **theme object** from the CSS custom properties
**in scope on the chart element itself** — not a globally registered theme name,
which would bake one scheme in at first init. So one option renders correctly in
both schemes with no second code path, and a chart is correct inside any themed
container.

**A server-assembled option must contain no hex colours.** Where a mark needs a
specific role a theme cannot express — a target reference tick, the in-tolerance
band, the void fill — the option says **`"token:--name"`** and the helper
resolves it from the token layer. `docs/design/audit_offline.mjs` **fails the
build** on a hex in a server option, and on a `token:` reference that does not
resolve in *both* schemes.

### Axis, grid, tooltip, legend

- **Axis and grid are recessive by construction:** a 1px axis line in `--chart-axis`, **no ticks**, labels in `--ink-3` at 11px in the mono face, and split lines on the **value axis only** — there is nothing to measure between two categories, so a category grid is decoration.
- **One axis, always. Never a second y-scale.** A target is a reference mark on the *same* axis, drawn in `--ink-2` so it reads as the strategy's mark and not as another measured quantity.
- **Tooltip:** `--sheet` ground, 1px `--chart-axis` border, zero radius, mono text, and the world's only real shadow.
- **Legend is always present for two or more series, and ECharts' own is off**: the partial renders an HTML legend, because two legends for one chart is a defect rather than redundancy. It is laid out as a **grid, not a flex row**, so one 41-character entry cannot leave a ragged hole.
- **Class labels are direct-labelled on the axis and wrap at a fixed width — never truncated.** A truncated class name is not an identity, and identity may never rest on hue alone. The layout is sized for `Obbligazioni corporate investment grade`.
- **The legend explains the cane, not just the classes.** It carries three extra entries — casing, core, edge — plus the target tick, because the allocation mark is three marks and a reader who has not been told which is which cannot use it. Those entries are part of the chart, not decoration.

### The five mark roles

A series names its **role** and the helper supplies the geometry, so the mark
language is inherited rather than retyped at each call site. The audit fails if
any `mark` key survives into the final option.

| role | what it is |
|---|---|
| `casing` | the **target** extent — translucent (alpha 0.30), no border, behind everything: the shape the frozen strategy declared |
| `core` | the **current** quantity — opaque, 55% of the cane's height, 2px surface gap |
| `edge` | the luminous leading edge — 3px, `--edge`, one light source for the world |
| `void` | untargeted capital — no hue, a hatch decal, **and no casing** |
| `segment` | a stacked part of a nested whole |

**The cased cane reads with no colour at all**, which is the whole point:

- a core **short of its casing** is a **shortfall** — visible unfilled casing;
- a core **past the target tick** is an **overshoot** — a protrusion.

**Polarity is geometry; hue is identity only.** That is what lets the palette be
pushed hard without colour becoming load-bearing (P9). Plus a target tick in
`--ink-2` on the same axis.

**The void cane says "no target was declared" without a word:** it gets no
casing, because there is nothing to case.

**The nested cane** renders a whole against its parts — net worth as its Buckets
plus the unassigned residual — **in euro, not percent**, because a percentage
would hide a rounding gap. It is built only from numbers that already reconcile;
a zero-width segment is a fact, not a gap, and no cross-tab may be invented to
fill one.

### Empty and single-point states

- **One point is never a line. [DESIGN, enforced in code]** A line series with a single datum is forced by the helper to a labelled dot, because a one-point line draws a trend the data does not contain — and enforcing it in the helper means no caller can forget.
- **No series is not a zero.** An absent series renders **server-side as a state block**, correct with JavaScript off. An empty plot frame implies a measurement of zero, and that is a different claim from "nothing was measured".
- **The data table is not a fallback. [CORPUS — ADR-L03 §4.]** It ships in the document, **open**, and the helper collapses it only after a chart is successfully live. With JS off or broken, the reader keeps every number.

### Formatting and lifecycle

- **it-IT number formatting** on value axes and tooltips by default, so a chart never prints `1.5` beside a table printing `1,5` for the same number. Locale formatting is presentation and lives in the helper, never in core (ADR-L03 §5.2). A caller that sets its own formatter keeps it. **The trace ladder is exempt: its decimals are stored strings.**
- **HTMX lifecycle:** init on `htmx:load` for the swapped fragment, dispose on `htmx:beforeSwap`, so repeated fragment swaps never leak instances. Animation is off under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:

- **Do** include `partials/tolerance_rail.html` unchanged wherever a band position appears. Extend that one file; never fork the geometry.
- **Do** pass trace decimals as the stored strings and apply **no** filter to them.
- **Do** give every `SKIPPED` and `ERROR` its reason, every time.
- **Do** pair every hue with a label, a texture, or a shape. Assume a greyscale print and a red-green colour-blind reader on every screen.
- **Do** change a *gate* and re-run `docs/design/palette_search.py` when a colour must move — never edit a hex. Then re-run `dataviz/scripts/validate_palette.js` against **both** surfaces and keep every check green.
- **Do** run `node docs/design/audit_offline.mjs` after touching a template, a token or a chart option. It is the only browser-free proof that the pages are offline-clean and every option still renders.
- **Do** keep the serif face for the user's words alone.
- **Do** render `role="img"` plus a full-sentence Italian `aria-label` on every gauge, and keep the numeric value adjacent in mono.
- **Do** use the 3px double rule only for structural boundaries, and the 1px hairline for ordinary divisions.
- **Do** name a **role** (`casing` / `core` / `edge` / `void` / `segment`) on a chart series and let the helper supply the geometry.

### Don't:

- **Don't** put a net-worth hero number on the landing surface. **[CORPUS — UX-0001 §5.3, Manifest P1.]** The decisions are the product; net worth lives one click away.
- **Don't** style `SKIPPED` or `ERROR` as reassurance, and don't render a finding count without the skip notice beside it. **[CORPUS — ADR-0016.]**
- **Don't** add a fourth type face, and don't let the system speak in serif. **[CORPUS — UX-0001 §4.5 / ADR-L03 §6.]**
- **Don't** reference an off-origin URL from any template, stylesheet or asset — no CDN, no Google Fonts, no chart library from a network host. **[CORPUS — ADR-0008 Local First, ADR-L03 §4, enforced by CI and by `audit_offline.mjs`.]**
- **Don't put a hex colour in a chart option.** Use a `token:--name` reference. The offline audit fails the build on one.
- **Don't let a warm hue carry a datum.** The warm half of the wheel is status. A series slot inside or within 30° of the alarm (8–34°) or caution (66–96°) hue window is not "close enough"; it is the alarm colour carrying a measurement.
- **Don't draw a line through one point.** A single datum is a labelled dot.
- **Don't render an empty plot frame for an absent series.** An empty frame implies a measured zero; render the server-side state block instead.
- **Don't truncate a class label.** Wrap it. A truncated class name is not an identity, and identity may never rest on hue alone.
- **Don't build a dual-axis chart, a donut for allocation, or a rainbow ramp.**
- **Don't** put more than **three** series in a scatter, bubble or choropleth. Those forms need all-pairs CVD separation, which five hues cannot deliver. Fold to "altro" or facet.
- **Don't** re-sort a findings list in the template. The order is `priority_rank DESC, severity DESC NULLS LAST, rule_id ASC` and the authored priority band dominates severity. **[CORPUS — RFC-0008 §3.]**
- **Don't** collapse correlated findings. One cause showing as three findings is correct. **[CORPUS — RFC-0008 §4.1.]**
- **Don't** hide a legal-but-alarming state: a negative `UNASSIGNED` residual is a signed row in the same table, so the column still totals to net worth. **[CORPUS — ADR-0025.]**
- **Don't** ship a Class B (projection) finding until it is visually distinguishable from a Class A finding, carries its assumption inline, and its severity is kept out of any column sorted against Class A severities. **[CORPUS — RFC-0010 §6.4: this is a kill criterion.]** The `--projection` token and the `.record--projection` / `.outcome--projection` / `.assumption` rules are reserved for it. **Do not delete them because they are currently unreferenced.** Note before that day comes: the projection hue window (300–330°) is **not** excluded from the series set, and `--series-5` sits at 304° inside it — so Class B must be carried by texture plus its inline assumption, exactly as the kill criterion already requires, or the window must be moved and the palette re-solved.
- **Don't** round a corner, cast a shadow on any surface but a tooltip, or warm the ground toward cream.
- **Don't** reintroduce a rejected identity: sealing wax, revenue-stamp ochre, verdigris, an in-tolerance green, paper texture, or a cream ground. Each one is a named rejection (P12), not an unexplored option.
- **Don't** add a token to silence a linter. Every colour here is solved and contrast-verified; a value earns its place by legibility and by the world, never by silencing a check.
