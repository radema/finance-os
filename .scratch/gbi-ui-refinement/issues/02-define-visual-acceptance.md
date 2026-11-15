# Define the visual acceptance evidence

Label: wayfinder:grilling
Type: grilling
Mode: HITL
Status: open
Assignee: unassigned
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
