# `tools/` architecture review

## Role

`tools/` holds human- and test-invoked operational code.  It is not a fourth
application layer and should not be treated as a production domain module.
Its implementations may deliberately compose `engine/` and `server/` in order
to start the application, enforce repository rules, compare behaviour, or
prepare a reviewable data migration.

The architectural invariant is therefore different from `engine/`, `server/`,
and `web/`: a tool must make its operational purpose and safety properties
clear, while respecting the production-layer rules that it verifies or drives.

## Clusters and current shape

| Cluster | Files | Role and interface | Assessment |
| --- | --- | --- | --- |
| Development start | `dev.ts` | Starts the local HTTP server and Vite together; one process owns orderly shutdown. | A small, direct entry point. Keep flat. |
| Architecture verification | `architecture/check.ts`, `architecture.test.ts` | `checkArchitecture(rootDir)` reports all layer, SQL, colour, and spacing violations; the test exercises it against both the real tree and planted violations. | A deep module: one focused interface hides traversal and source parsing, with strong locality. Keep the implementation and its test together. |
| Differential verification | `differential/{scenario,harness,mock,mock-engine,differential.test}.{ts,js}` | Generates a shared scenario, adapts it to the current engine and preserved mock, then compares agreed outputs. | A coherent test module. The copied mock is a reference artefact, not a place for routine edits. Keep the explicit comparison domain and documented differences visible. |
| Staged portfolio import | `stagePortfolioImport.ts` | Builds a replacement export only in an empty staging database, validates retained Retirement/configuration data, and emits the export plus a validation report. | It deliberately has a broad implementation because it orchestrates the real import path. Its safety invariant is more valuable than artificial internal layering. |
| Portfolio Performance converter | `portfolio_performance.py`, `test_portfolio_performance.py` | Converts one external XML format, with a paired Python test suite. | A standalone migration/conversion tool; pairing source and test at this level is sufficient. |

## Folder decision

Do **not** reorganize `tools/` now.  `architecture/` and `differential/`
already group a coherent implementation with its tests.  The top-level scripts
have intentionally unrelated jobs, so a catch-all `scripts/`, `cli/`, or
`imports/` folder would create visual uniformity without increasing depth,
leverage, or locality.

In particular, do not move the Python converter merely to make every tool use
TypeScript.  Its language and isolated test suite reflect the external data
format it processes, not a cross-tool module interface.

## Guidance when touching a cluster

1. Start from the tool's operational promise.  For `stagePortfolioImport.ts`,
   preserve isolated staging, empty-database validation, and retained-data
   checks before simplifying anything.
2. Keep a verification module's seam small.  A caller of
   `checkArchitecture` needs only a root directory and violations; parsing and
   traversal belong behind that interface.
3. Treat the differential scenario and harness as the test surface.  Change
   the copied mock only to correct the preserved reference, not to make a new
   engine result pass.
4. Improve structure only when concrete friction appears: a second staging
   workflow needs the same orchestration, several tools must share conversion
   logic, or a tool's implementation changes repeatedly because it reaches too
   deeply into unstable production details.  Then extract one focused module
   behind a real seam and move its paired tests with it.
5. Do not introduce an adapter for a hypothetical second implementation, and
   do not create folders solely for symmetry.

## Watch items, not current refactors

- `stagePortfolioImport.ts` imports many persistence modules.  That coupling
  is appropriate for a one-off end-to-end staging workflow today.  Revisit
  only if a recurring import workflow shares the same steps or server-module
  churn makes the script costly to maintain.
- If more external-data converters arrive, group them by the shared import
  workflow only after they actually share an interface or implementation.

## Evidence

- `tools/architecture/check.ts` is exercised against the real repository and
  synthetic violations by `tools/architecture/architecture.test.ts`.
- The differential cluster imports from the current pure engine and the
  preserved mock only; its dependency direction is from tests to helpers and
  then to the engines.  No `tools/` dependency cycle was found.
- Focused Vitest verification could not run in the sandbox because pnpm could
  not acquire its store lock on the read-only filesystem.  No implementation
  was changed by this review.
