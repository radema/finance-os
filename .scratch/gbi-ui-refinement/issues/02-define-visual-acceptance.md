# Define the visual acceptance evidence

Label: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: Codex
Parent: [Adopt the selected Bauhaus UI](../map.md)
Blocked by: 01

## Question

What visual and interaction evidence is sufficient to approve this design across existing screens?

Agree a review matrix covering all screens, both themes, desktop width boundaries,
dense/empty/loading/error states, long labels, sticky tables and sidebar collapse.
Include checkbox label/keyboard activation, focus, checked/unchecked/indeterminate/disabled
states and forced colours; include chips in tables and glossary popovers within labels.

The repository requires agent-browser and human visual review. The executable is currently
unavailable in this environment; decide how to restore that required verification without
substituting Playwright or treating passing unit checks as a visual approval. Keep the
full `pnpm gate` as a required integration check. Put the agreed checklist in `assets/`.

## Comments

Prepared [Bauhaus UI visual acceptance checklist](../assets/visual-acceptance.md) covering
all existing routes, both themes, desktop boundaries, component/state/keyboard checks,
semantic motif placement and final human review. Proposes provisioning agent-browser and
a compatible runtime during implementation, or performing the same required pass in a
supported environment; missing browser evidence remains pending, never silently waived.
Awaiting human agreement to the review scope. No browser checks have been performed.


## Answer

The user approved [Bauhaus UI visual acceptance checklist](../assets/visual-acceptance.md)
with "Fine to me. Go ahead". It defines all-screen/light/dark evidence, desktop boundaries,
component states, semantic motif placement, keyboard/forced-colour checks, browser runtime
provisioning, the full gate and final human review. Approval settles the review scope;
it does not assert that the checks have run or that the integrated UI is visually approved.
