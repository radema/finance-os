# Semantic motif family — proposed mapping

Status: superseded. The four-primitive family was rejected; the user approved the
simpler two-shape studies. Use DESIGN.md for the final semantic assignments.

The core design amendment is approved. The user additionally authorizes developing
motifs by permuting the retained compositions' shapes and colours, provided every motif
has a precise meaning and assignment is never random. The GBI planner mark and Overview
Net worth artwork remain unchanged. This proposal defines the unresolved extension.

## Grammar

Use the Net worth artwork's four primitives: circle, square, quarter-circle and quadrant.
Use the existing ochre, teal, peach and ink tokens. Each family has a fixed arrangement
and fixed shape-to-colour mapping. No random seed, sibling-position selector, per-render
variation, cycling palette, decorative magnitude or simulation-derived arrangement.
The brand mark remains a unique brand identifier rather than a content-category badge.

## Proposed meanings

Choose by the primary purpose of the section, not by its screen's position. One family
may appear on several screens when the meaning is the same. Use the existing section
heading as the plain-language context; do not expect users to decode the artwork alone.

| Family | Precise meaning | Examples | Exclusions |
| --- | --- | --- | --- |
| Capital | A present stock of money or holdings | Overview Net worth, current portfolio, holdings | Returns, probability, future targets |
| Plan | A desired future state or intended allocation of money | Goal definitions, allocation, cash-flow plan, expense assumptions | Realized contributions, historical outcomes |
| Measurement | An evaluation of outcomes against time or intent | Performance summary, plan-vs-actual summary, goal outlook summary | Chart plots, chart legends, alerts |
| Records | Entering, reviewing or maintaining source records | Transactions, imports, prices | Goal plans, calculated outcomes |

Not every card needs a motif. Brand, navigation, Setup tabs, chips, status messages,
checkboxes and glossary definitions retain their own roles. Ambiguous or mixed-purpose
sections get no added motif until an explicit assignment is agreed. Do not decorate
individual rows, every KPI, empty/loading/error states or chart exhibits.

## Proposed fixed permutations

Positions below are top-left, top-right, bottom-left, bottom-right. Capital is the
existing Net worth composition, including its original colours and silhouette.

| Family | Shape positions | Circle | Square | Quarter-circle | Quadrant |
| --- | --- | --- | --- | --- | --- |
| Capital | circle, quarter-circle, square, quadrant | ochre | ink | teal | peach |
| Plan | quarter-circle, square, quadrant, circle | peach | teal | ochre | ink |
| Measurement | square, quadrant, circle, quarter-circle | ink | ochre | peach | teal |
| Records | quadrant, circle, quarter-circle, square | teal | peach | ink | ochre |

Colour and position identify the family, never an investment goal, urgency or good/bad
status. Do not reuse these family mappings for charts or chips. Slot 1/burnt orange is
excluded. No new palette values. Motifs stay in dedicated header/lead-card space, with
quiet smaller variants and no overlap with text, controls or focus rings. Hide decorative
artwork in forced-colour mode. No animation or tilted containers.

## Decision requested

Accept the four meanings and fixed mappings above, or refine the categories before any
new motifs are implemented. Then append the accepted assignment table to the design
contract and update only the affected spec/design clauses. Review visual execution under
the later visual-acceptance ticket; approving this grammar is not all-screen visual signoff.

## Visual review

[PNG comparison sheets and individual previews](motif-previews/README.md) are available
for approval in both themes. The running prototype has not been changed.
