# Engine architecture review

Reviewed 2026-11-10. This is planning evidence, not a behavioural rule.

## Role and invariant

`engine/` is the pure investment-calculation module. It accepts values already loaded by
`server/` and returns deterministic calculations, simulations, import previews, alerts, and read
models. It has no I/O and no imports from Node, `server/`, or `web/`; the architecture checker
enforces this.

## Current clusters

| Cluster | Files | Assessment when touched |
| --- | --- | --- |
| Foundation | `units`, `months`, `timeGrid`, `assetClasses`, `schemas` | Keep shared conventions easy to find. `schemas.ts` remains the source of truth unless a concrete change demonstrates discovery friction. |
| Portfolio accounting | `holdings`, `cashLedger`, `bucket`, `split`, `tax`, `commission` | Preserve accounting invariants and pure replay. Improve locality inside this cluster when a change crosses its files. |
| Projection and simulation | `projection`, `monteCarlo`, `correlation`, `random`, `requiredContribution`, `optimizer` | This is already a deep cluster. Preserve its high-level calculation interfaces; avoid exposing lower-level mechanics only for tests. |
| Goal read models | `goalViews`, `goalStatus`, `overviewView`, `snapshot`, `outcomeChart` | See the focused finding below. |
| Tracking and decisions | `performance`, `planVsActual`, `trackingViews`, `rules`, `financialIndependence`, `independenceView`, `cashFlow` | Keep financial decisions in the pure core; improve the cluster only when an active change shows a shared calculation or navigation problem. |
| Imports and prices | `csv`, `importMapping`, `transactionImport`, `recordImport`, `cashCsv`, `priceCsv`, `priceFetch`, `importTemplate` | Keep parsing, matching, validation, and preview rules together. Deepen an import-preview module only when callers must coordinate intermediate shapes or a second real variation appears. |
| Read-model shaping | `optimizerView`, `pensionView`, `slots` | Keep transformations small and tied to the result they shape. |

## Rule for an active engine cluster

When a change touches one of these clusters, inspect its existing interface, implementation, and
tests before adding code. Improve the cluster when the change exposes a concrete loss of locality,
an interface that makes callers coordinate internal details, or a repeated calculation across
callers. Preserve a deep module's external interface when its deletion would spread complexity.

Do not introduce an adapter without a real variation, and do not re-folder `engine/` merely for
symmetry. If an active change makes navigation materially difficult, move only that coherent
cluster and its paired tests; group by domain concept rather than generic helper names.

## Focused finding: Goal read models

`goalViews.ts` is a deep module with a useful external interface: a `GoalWorld` produces Goal list
rows, detail, series, and analysis. Deleting it would spread holdings, Bucket Cash, projection,
simulation, tax, plan, status, and chart logic into callers.

Its 630-line implementation imports 19 modules. A Goal change can therefore require navigating
many concepts, weakening locality inside the module. When a Goal read-model change demonstrates
that friction, preserve its external interface and make the internal concepts independently
navigable: world preparation, holdings and Bucket Cash, projection and tax, and analysis and
series. Test through the external interface.

## Evidence to revisit

- Transaction import is a future candidate only if its intermediate shapes leak to multiple callers.
- `schemas.ts` is centralized deliberately; splitting it needs concrete evidence.
- Folder navigation alone is insufficient evidence for a wholesale reorganization.
