# Adopt the selected Bauhaus UI

Label: wayfinder:map
Tracker: local Markdown

## Destination

An implementation-ready design contract and rollout plan for making Asymmetric studio
(A) the production UI across existing screens, with no unresolved design decisions.
The plan must cover spec alignment, verification and removal of the throwaway prototype.

## Notes

- Planning map: tickets resolve decisions, not implementation slices. Production changes
  follow after this map; this map does not authorize merging or alter the spec.
- Use the supplied wayfinder skill, plus grilling and domain-modeling where needed.
- The user selected A, liked its sidebar and lead card, requested shared card/control
  refinements, and retained the GBI planner mark and Overview Net worth artwork after rejecting the
  earlier added motifs. The user subsequently approved the core amendment and proposed
  a semantic motif family using fixed permutations of existing shapes and colours.
  The first ticket records the approved simpler two-shape meaning/assignment contract; do not reopen the
  accepted sidebar, core layout or control design.
- Palette D, the bundled fonts, chart philosophy, financial calculations and workflows stay.
- Repository constraints: `.scratch/gbi-v1/spec.md` is authoritative; spec changes require
  user approval. Run the full gate before integration; UI needs agent-browser and human review.
- Local tracker conventions: child files under `issues/`; `Type`, `Status`, `Assignee` and
  `Blocked by` carry ticket state. An open, unassigned child with no unresolved blocker
  is on the frontier. Claim before working; record answers in their own tickets.
- Prototype evidence: [Selected design](../../DESIGN.md#selected-layout-and-semantic-motifs)
  and [iteration history](../../web/overview/BAUHAUS-PROTOTYPE-NOTES.md).

## Assets

`.scratch/gbi-ui-refinement/assets/`, written in English, confirmed by the user.
Production integration replaces the throwaway prototype; retain the approved assets and iteration history.
New findings, spec amendment drafts and review checklists belong in this assets directory.

## Decisions so far

- [Align the selected design with the authoritative spec](issues/01-align-design-contract.md) — approved A, preserved both main artworks and fixed meanings for the simpler two-shape motifs; spec and DESIGN.md aligned.

- [Define the visual acceptance evidence](issues/02-define-visual-acceptance.md) — user approved the all-screen, both-theme browser/state checklist and final gate; checks remain to be performed.

- [Choose the production rollout boundary](issues/03-choose-rollout-boundary.md) — user approved one coherent UI change/PR, prototype removal and the implementation handoff.

## Not yet specified

None blocking implementation. The map is complete; any concrete visual defects found
during the approved implementation review are handled within the rollout scope.

## Out of scope

- New palettes, fonts, chart encodings or financial behaviour.
- Random or merely decorative motif variants; motifs without an agreed semantic mapping.
- Mobile redesign, new screens, navigation restructuring or an architecture reorganization.
- Production implementation and merging: this map prepares the decisions for that work.
