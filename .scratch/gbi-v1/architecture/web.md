# `web/` architecture review

## Role

`web/` is the local browser application.  It renders the planner, keeps
screen-local interaction state, and reaches persisted data through the REST
interface in `api.ts`.  It may reuse engine types and pure presentation
calculations; it must not import `server/` or move persistence logic into the
browser.

The top-level flow is intentionally small:

`main.tsx` mounts React and global styles → `App.tsx` resolves the hash route
→ `AppShell.tsx` composes the sidebar and the selected screen.

`AppShell.tsx` is the composition point.  Its broad knowledge of screens is
therefore intentional, rather than a reason to split it by itself.

## Clusters and current shape

| Cluster | Role and interface | Assessment |
| --- | --- | --- |
| Application shell | `main.tsx`, `App.tsx`, `AppShell.tsx`, `nav.ts`, sidebar/hash state | Owns application mounting, routing and persistent shell state. | A clear composition module; preserve its central place. |
| REST and shared interaction support | `api.ts`, form-error/form helpers, file picker, downloads, inputs, chart hook | Screens cross the REST seam through `api`/`useLoad`; small helpers keep browser concerns out of screen implementations. | `api.ts` is a deep module: callers learn one error/loading interface rather than fetch and failure conventions. |
| Feature screens | `goals/`, `overview/`, `setup/`, `operations/`, `import/`, `prices/`, `tracking/`, `optimizer/`, `pension/`, `independence/`, `glossary/`, `split/` | Each feature groups screens with its local form/model/chart code and most paired tests. | This is the right primary organization: navigate by the user's investing task, not React file kind. |
| Shared presentation language | `setup/ui.tsx`, goal chips/outlook, glossary popovers, chart hook, money formatting | Reused controls and display conventions. | Good leverage from reuse, but see the ownership watch item below. |
| Design assets | global CSS, tokens, bundled fonts | Own visual tokens and local assets. | Aligns with the no-CDN and token rules. |

## What is healthy

- The REST seam is visible in `api.ts`; reviewed browser imports do not form a
  runtime cycle and do not import `server/`.
- Feature folders co-locate their screens, local models/forms, and tests.  For
  example, price and setup transformations have focused local test coverage.
- Cross-feature imports mostly express genuinely shared concepts: goal status
  and chips, glossary popovers, shared form controls, and tracking display
  transformations.  Reuse here prevents duplicate behaviour.
- Large screen files alone are not an organization smell.  `OptimizerScreen`,
  `GoalDetailScreen`, and `TransactionsScreen` orchestrate several exhibits or
  workflows; the deletion test does not show that extracting files would
  reduce what callers need to know.

## Folder decision

Do **not** reorganize `web/` wholesale.  Its feature-oriented folders have
better locality than horizontal folders such as `screens/`, `charts/`, and
`forms/` would.  Do not split a large screen merely to reduce its line count;
split only when a coherent part has its own interface and can be tested
through that seam.

## Suggested refactor when the Import cluster is next changed

`RecordImport.tsx` imports `DATES`, `DECIMALS`, `DELIMITERS`, and `toBase64`
from `TransactionsImport.tsx`.  Those are shared file-import rules, but their
current home makes one screen depend on another screen's implementation.

When Import has a substantive change, place the shared file-format values and
conversion behind one small Import-local module, with its tests beside it.
Both screens should then depend on that module, not on each other.  This
creates a clean seam and restores locality without making an application-wide
utility layer.

This is a touch-time refactor, not a standalone issue: the coupling is real
but currently narrow, with one known consuming screen and no cycle.

## Ownership watch item

`setup/ui.tsx` is used across many feature folders, so it now functions as
shared presentation infrastructure rather than Setup-only implementation.
Do not mechanically move it today: its interface is broad and a move would
touch many unrelated screens.  Revisit its ownership only during a change
that deliberately affects several of these controls.  At that point, separate
coherent shared presentation modules from genuinely Setup-specific controls
and move their paired tests together.  Avoid a generic adapter or a new
folder merely for symmetry.

## Guidance when touching a web cluster

1. Keep a screen's interaction state and its user-facing workflow local to the
   feature folder.
2. Cross the server seam through `api.ts`; do not make a screen know database
   or server implementation details.
3. Extract only behaviour that has at least two real callers or an independent
   test surface.  A second adapter makes a seam real; a hypothetical one does
   not.
4. Preserve the feature folder plus its paired tests when moving a coherent
   cluster.
5. For visual changes, retain design-token use and carry out the required
   browser and human visual checks.

## Evidence

- `web/AppShell.tsx` imports all built screens, as expected for the application
  composition point.
- `web/api.ts` is used by the feature screens as the shared REST adapter.
- The reviewed runtime-import graph contains no cycle.
- `web/import/RecordImport.tsx` imports shared file-format values and
  `toBase64` from `web/import/TransactionsImport.tsx`, demonstrating the
  specific Import coupling above.
