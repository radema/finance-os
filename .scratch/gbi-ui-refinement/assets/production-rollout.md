# Production rollout — proposed implementation handoff

Status: proposed; final rollout decision awaits the human.

## Boundary

One coherent change and one PR to main, on `feat/bauhaus-ui-prototype` or a continuation
feature branch based on the current task history. Apply the selected design to all existing
screens and remove the throwaway activation/switcher/losing variants in that same change.
Do not ship a partially styled navigation path or retain a permanent variant selector.
The user merges; no deployment or automatic merge is included.

Reason: the changes predominantly share tokens, shell and components. Splitting rollout
by page would expose mixed designs while repeatedly changing the same shared surfaces.
If implementation or visual review exposes a specific screen that cannot join coherently,
report the concrete reason and revise this boundary with the user rather than silently
leaving it on the prototype styling path.

## Authoritative inputs

- [DESIGN.md](../../../DESIGN.md): approved geometry, type, palette roles and motif mapping.
- [Spec](../../gbi-v1/spec.md): authoritative behaviour and amended UI contract.
- [Visual acceptance](visual-acceptance.md): approved verification scope.
- [Two-shape PNGs](motif-previews/README.md#two-shape-studies--latest-review): approved artwork.
- Existing prototype rendering is visual evidence only; rewrite its validated design
  rather than copying the override cascade into production.

## Included work

1. Read the web architecture record and preserve its feature-local composition model.
   Move accepted visual values to named design tokens where they have an actual shared
   role; avoid a generic theme engine or new dependencies.
2. Apply shell/sidebar, responsive serif display hierarchy, shared card/header/table/tab
   treatments, square form controls and the refined checkbox/chip/tag system through the
   existing production components and styles. Keep native semantics and focus handling.
3. Implement the exact retained brand and Overview Net worth artwork; assign approved
   two-shape motifs by explicit section purpose. Omit copy artwork if there is no existing
   copy/duplicate section. No sibling-index, random, data-driven or speculative motif use.
4. Implement the Overview lead/secondary hierarchy and readable asymmetric lower layout
   with a narrow-desktop fallback. Preserve all links, five metrics and four view blocks.
   Keep FI and other charts as unboxed exhibits, with no change to chart encodings.
5. Integrate production styling without `?variant=A` or a development-only gate. Remove
   the App prototype mount, switcher, variant component and prototype-only CSS. Verify that
   ordinary development and production entrypoints both render the same selected design.
6. Preserve decision assets, approved PNGs and meaningful prototype history. Before deleting
   any prototype file, search the repo for paths/text citations and repoint every reference
   in the same change. Replace active prototype references with production file pointers;
   clearly mark retained iteration history as historical. Do not delete the PNG evidence.
7. Run the approved visual matrix with agent-browser against synthetic scratch data,
   provision the missing CLI/browser runtime, correct defects, run `pnpm gate`, and prepare
   the evidence index for the user's all-screen visual review. No Playwright or waived gates.

## Completion criteria

- All existing screens use the selected design without prototype activation.
- Spec and DESIGN.md agree with the final implementation; no rejected variants or active
  prototype references remain. Financial/REST behaviour, navigation and chart rules hold.
- Motifs have the exact agreed meanings, geometry and palette assignments; original brand
  and Net worth artwork are preserved. No added decoration outside those boundaries.
- Checkbox interaction, label activation, focus, disabled/indeterminate and forced-colour
  behaviour pass. Chips/tags preserve semantic marks, labels, contrast and popovers.
- The approved viewport/theme/state matrix is complete and evidenced; required tooling
  limitations are resolved or explicitly leave the change pending, not ready to merge.
- `pnpm gate` passes; the user explicitly approves the integrated UI and merges the PR.

## Status at handoff

Design and review scope are approved. The app still uses the throwaway development-only
prototype for this treatment; additional approved two-shape motifs are PNG studies, not
production features. No full gate or integrated browser review has been performed.
This document is a plan, not an execution report.
