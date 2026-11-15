# Choose the production rollout boundary

Label: wayfinder:grilling
Type: grilling
Mode: HITL
Status: claimed
Assignee: Codex
Parent: [Adopt the selected Bauhaus UI](../map.md)
Blocked by: 01, 02

## Question

Should the approved shared design and prototype removal land in one coherent change or
in staged changes, and what defines a complete handoff to implementation?

Recommend one coherent UI change unless screen review exposes a concrete reason to stage.
Preserve screen workflows and keep shared styling in the existing token/component system;
rewrite the selected treatment rather than promoting the prototype's override cascade.
The implementation handoff must identify spec/design updates, production activation,
verification evidence and removal of variants, switcher and obsolete prototype references.

Resolve the rollout strategy and completion criteria, not implementation tasks. Link the
agreed handoff asset. The user remains responsible for merging a reviewed PR to main.

## Comments

Prepared [Production rollout — proposed implementation handoff](../assets/production-rollout.md).
Recommends one coherent all-screen change/PR, with prototype removal in the same change,
explicit completion criteria, preserved PNG evidence and the approved browser/full-gate
review. Awaiting agreement to this final rollout boundary; implementation has not started.
