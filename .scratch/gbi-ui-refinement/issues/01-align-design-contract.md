# Align the selected design with the authoritative spec

Label: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: Codex
Parent: [Adopt the selected Bauhaus UI](../map.md)
Blocked by: none

## Question

Which exact spec amendments make the selected A treatment an approved production contract?

Reconcile DESIGN.md's selected direction against `.scratch/gbi-v1/spec.md` UI and related
acceptance criteria. In particular: the spec requires section cards without outlines,
while A previews outlined ruled cards; the prototype uses sans section labels alongside
serif page titles/KPI values; chips, large display sizes and decorative use of palette
slots need precise documented boundaries. Preserve financial and chart requirements.

Prepare a concise, reviewable amendment draft in `assets/` before requesting approval.
The human decides the differences; do not edit the authoritative spec until approved.
The answer must name accepted differences and any remaining exceptions, linking the draft
rather than duplicating its contents. The two retained ornamental compositions are settled.

## Comments

Prepared [Selected Bauhaus design — proposed spec amendment](../assets/design-contract-amendment.md).
It supplies replacement/additional text for the UI contract, Overview description and
AC-10/AC-11, preserving all chart, financial and verification requirements. Identified
one implementation correction: the asymmetric lower Overview layout needs a readable
single-column fallback. Awaiting the human's approval; authoritative spec unchanged.


The user approved the core draft and requested a semantic motif family made by permuting
existing shapes and colours. Prepared [Semantic motif family — proposed mapping](../assets/motif-meaning-proposal.md).
The exact-two restriction in the original draft is superseded; the final combined clause
awaits the user's response to the proposed meanings. Keep this ticket claimed, not resolved.

Created [PNG approval previews](../assets/motif-previews/README.md): light/dark comparison
sheets and individual studies of each semantic family. Awaiting visual feedback before
settling the motif clause or changing production artwork.

The user was unconvinced by the four-tile permutations and requested alternatives based
on the same shapes. Prepared [three composition systems in PNG](../assets/motif-previews/alternatives-light.png),
with dark equivalents and individual direction sheets. The core artwork is unchanged;
additional motif grammar and meaning are still pending human choice.

The user clarified that only the two main artworks work and requested simpler motifs
made by combining two shapes or repeating one. Created [two-shape PNG studies](../assets/motif-previews/two-shapes-light.png)
with dark equivalents and proposed meanings. Do not require every primitive in every
motif. No new artwork or semantic assignment is approved yet.


## Answer

The user approved the core amendment and then the simpler two-shape motif studies.
Applied [Selected Bauhaus design — approved amendment](../assets/design-contract-amendment.md)
to the authoritative spec and consolidated DESIGN.md into the selected production contract.
The approved mapping is target, allocation, comparison, coverage, entries and copy; it is
recorded once in DESIGN.md. Preserve the two original artworks. No random assignments,
four-part derivatives or changes to chart/financial semantics. Production integration and
visual acceptance remain pending. The narrower Overview fallback is included in the contract.

Evidence: [light study](../assets/motif-previews/two-shapes-light.png) and
[dark study](../assets/motif-previews/two-shapes-dark.png). The user approved these with
"fine, they work. go ahead". Later visual review must verify their actual UI placements.
