# Selected Bauhaus design — proposed spec amendment

Status: approved, including the two-shape extension, and applied to the authoritative spec.
This is the design-phase decision record; references to prototype behaviour below describe
the starting point. Production execution evidence is recorded in `visual-review/`.

Applies to `.scratch/gbi-v1/spec.md`, its UI section, Overview screen description,
and design acceptance criteria AC-10 and AC-11. This is the concrete text proposed for
approval; production implementation and visual acceptance remain separate steps.

## 1. Replace the UI section's Approved direction bullet

- Approved direction: **Asymmetric studio (A)**, as recorded in `DESIGN.md`, section
  "Selected layout and semantic motifs". The previous `prototypes/11-ui/` and `prototypes/16-app/`
  remain historical references. The selected prototype is a visual reference: rewrite its
  validated design in production components and styles; remove the variant switcher and
  rejected variants during integration. Do not promote the prototype override cascade.

## 2. Add after the Colour bullet

- Preserve the approved GBI planner brand mark and Overview Net worth artwork, including
  their existing shapes, colours and the Net worth card's teal field. Additional motifs
  combine two existing geometric primitives or repeat one primitive; they do not require
  all four shapes. Use only Palette D and the fixed semantic assignments in DESIGN.md.
  The approved two-shape PNG studies are the reference for these additional motifs.
- Assign motifs by the section's purpose, never randomly, by sibling order or by financial
  values: a circle within a teal square means a target; two joined ochre/teal quarter-discs
  mean parts of an allocation; two equal peach/teal circles mean comparison; a peach square
  inside an ink square means coverage against a reference; three ink/ochre/teal squares
  mean an ordered collection of records; overlapping teal/ochre squares mean a record and
  its copy. Keep their approved relative geometry and colour assignments stable.
- Motifs supplement explicit section headings, not goal identity, status or financial
  values. Omit them when the purpose is ambiguous. Use at most one motif per relevant
  section, in dedicated space, never inside chart plots, legends, table rows, chips or
  error/loading states. No extra page-title ornaments or animation. Hide artwork in
  forced-colour mode. Small monochrome navigation/section icons and neutral KPI corner
  rules remain. Text stays in text greys; slot 1 / burnt-orange highlight stays reserved
  for attention. Chart encodings and approved goal-slot assignments are unchanged.

## 3. Replace the Components bullet

- Components: square KPI and section cards, square form controls and buttons, with a
  consistent ink-rule hierarchy. Section cards have a 1 px neutral outline, a 2 px ink
  top rule and a faint blue header strip; collapsible headers retain their behaviour.
  KPI cards normally have a 1 px neutral outline and a 2 px ink top rule; a goal-colour dot
  precedes the label where the KPI belongs to a goal. Overview is the explicit exception:
  its lead Net worth card uses a teal field and artwork; four secondary metrics use an
  open layout with neutral dividing rules. Exhibits remain unboxed and full width.
- Chips and tags: goal, status, severity, freshness, priority and product labels use 2 px
  corners, at least 24 px height, consistent spacing, and existing semantic tints. Keep
  goal identity dots, priority fill/half-fill/ring marks, status icons and words, and the
  old-price indicator. Label text is 13 px; product tags remain 12 px uppercase. Attention
  labels use weight 600, other chip labels 500. Goal labels keep their links and glossary
  terms remain accessible popovers.
- Checkboxes: 20 px square control with 2 px corners; ink fill and a contrasting check
  when checked, a dash for indeterminate, and a distinct disabled appearance. Preserve
  native checkbox semantics, label activation, Space-key operation and visible keyboard
  focus. Checkbox label rows have at least a 32 px target height. Use native rendering
  in forced-colour mode. Treat checked, unchecked, indeterminate and disabled as states
  of the existing control; do not invent new business uses for them.
- Keep sticky headers on every table and strengthen header/total rules with neutral
  colours. Setup tabs keep their current routes and use a teal tint for the active tab.
  The sidebar keeps its current groups, labels, order, collapse behaviour and ink active
  indicator, with geometric icons and a teal-tinted active background.
- Preserve compact legends on multi-series charts, direct labels, exhibit anatomy
  (tag, action title with a number, unit, chart, callout, source), goal encodings, end-label
  room, chart marks and all other existing chart rules.

## 4. Replace the Fonts bullet

- Fonts: Source Serif 4 for page titles, exhibit action titles and KPI values; Geist for
  body text, navigation, brand name and card header labels; Geist Mono for KPI labels and
  other existing small mono labels. All fonts remain bundled (OFL). Display serif weight
  stays 500 with existing letter-spacing. Card header labels use Geist 15 px, weight 600,
  sentence case without added tracking. The brand uses Geist weight 700.
- Use a separate responsive display scale for page titles (40–72 px), Overview Net worth
  (40–72 px), secondary Overview KPI values (26–40 px), and other KPI values (26–36 px).
  These display sizes do not enlarge chart axes or table text. Retain the existing 16 px
  body, 15 px table, 13 px label, 12 px axis scale and spacing tokens. Exhibit action
  titles use 26/32 px; kickers stay Geist 13 px, sentence case. Charts render after fonts
  load and resize with their boxes. Long labels and amounts must remain readable across
  the supported desktop widths without overlapping decorations or controls.

## 5. Replace the Overview screen's Content cell

Key numbers under an action title: a dominant Net worth card, then market change this
month, YTD TWR, FI wealth and goals on track as four secondary metrics. Preserve all
links and financial meanings. Below, retain four blocks: Goals (all goals ordered by
status, with probability vs required and value against target), Plan vs actual
(cumulative gap and next contribution), Operational (alerts and stale prices), and
Financial independence (highest reached and next configured level, with projected wealth
and level targets). Goals and FI span the content width; Plan and Operational use an
asymmetric 3:2 layout when it remains readable, with a single-column fallback as needed.
Keep the FI chart as an unboxed exhibit. Each block links to its explaining screen.
The empty Overview retains the existing first-run checklist.

## 6. Append to AC-10 and AC-11; retain their existing checks

- AC-10 addition: the shell follows the selected Bauhaus direction: approved GBI planner
  mark, geometric sidebar icons, ink divider and teal-tinted active page, preserving the
  existing seven groups, collapse control and text labels in both themes.
- AC-11 addition: DESIGN.md is reconciled into one production design contract covering
  the selected display scale, ruled square cards, the two retained artworks and semantic two-shape motifs, checkbox
  states and compact square-cornered chips/tags. It contains no contradictory rules from
  rejected variants or obsolete prototype references.

Existing AC-77 Overview content/performance and AC-93 all-screen visual approval still
apply, as do architecture rules, local-only assets and the full `pnpm gate`. The later
visual-acceptance decision will specify the review matrix; it cannot waive those checks.

## Boundaries and implementation corrections

- Reconcile conflicting legacy DESIGN.md sections during production integration, rather
  than retaining a selected-direction appendix beside contradictory component rules.
- Keep page h1 names, financial behaviour, all screens, navigation routes, first-run
  workflow and user data unchanged. No new fonts, dependencies or palette values.
- Limit additional motifs to the approved two-shape studies and fixed meanings in DESIGN.md.
  The earlier four-part derivative motif studies are rejected and must not be implemented.
- The prototype currently makes Plan/Operational columns asymmetric at every width; the
  production layout needs the stated readable single-column fallback. This is a layout
  correction within the selected direction, not a new style variant.
- Do not amend unrelated legacy goal-slot language in this change. Existing approved
  goal-slot decisions remain authoritative; this amendment adds no allocation policy.

## Review outcome

The user approved the core amendment and subsequently approved the simpler two-shape
PNG studies: [light](motif-previews/two-shapes-light.png) and
[dark](motif-previews/two-shapes-dark.png). The original brand and Net worth artwork stay.
This final amendment is applied to the spec. Earlier four-part derivatives and permutation
proposals are superseded. At approval, production implementation and visual acceptance were
still pending; current execution evidence belongs to `visual-review/`.
