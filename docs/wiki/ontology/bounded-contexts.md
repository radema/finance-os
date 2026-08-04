# Bounded contexts — the top-level partition

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.

The domain is partitioned into **five bounded contexts** as sibling packages under
`src/financeos/core/`, plus a shared kernel. This partition is **architecturally load-bearing**,
not documentation: it is enforced by an import-linter contract that fails the build.

```
src/financeos/core/
  cashflow/     # EMPTY — deferred to V1.1 (ADR-0024)
  portfolio/    # what is held, and what it is worth
  strategy/     # what was declared, and how far reality is from it
  market/       # every external observation
  decision/     # the immutable audit artifacts
  shared/       # the ONLY shared vocabulary (C3)
  engines/      # pure functions over the above — no ports (C2)
```

## The non-import rule (C3)

> **The five contexts may not import each other. `core/shared/` is the only shared vocabulary.**

Contract `C3` in `pyproject.toml` is an import-linter `independence` contract over
`financeos.core.cashflow`, `.portfolio`, `.strategy`, `.market`, `.decision`. Verify with
`uv run lint-imports`.

This explains several placements that look arbitrary until you know the rule. When you find
yourself asking "why is X *here*?", C3 is usually the answer:

| Placement | Why |
|---|---|
| `AssetClass` lives in `core/shared/ids.py:39`, not `core/portfolio/` | It is *owned* by Portfolio and *consumed* by Strategy as an opaque taxonomy key. A shared opaque key is what makes **I-14** enforceable **without an import edge**. |
| `RuleFiring` lives in `core/decision/firing.py`, though `core/strategy` produces it | A cross-context contract is **owned by the consuming context**. Strategy hands over outcomes plus traces; it never constructs a `Recommendation`. |
| `Snapshot` uses `MoneyAmount` / `WeightAmount`, never `Money` / `AllocationLine` | `core.decision` may not import `core.portfolio`. The shape is restated in shared-kernel vocabulary. |
| `PriceView` is a flat DTO in `core/market/price.py` | Portfolio never queries the `price` table. Market owns every external observation (**ADR-0031**, **E11**) so egress lives behind one context. |
| `Priority`, `Outcome`, `SkipReason` live in `core/shared/enums.py` | Each crosses a boundary: `Priority` is authored on a `Rule` (Strategy) and promoted to a column on `Alert` (Decision). |

The general pattern: **where a shape must cross a boundary, it crosses either as shared-kernel
vocabulary or as a DTO owned by the consuming context** — never as a direct import.

## The five contexts

### `portfolio` — what is held, and what it is worth

Aggregate roots: `Portfolio`, `Bucket`, `Asset`, `Operation`.
Derived: `Holding`, `VirtualHolding`, `AllocationLine`, `AllocationBreakdown`,
`ApportionmentLine`, `ResidualComputation`. Authored fact: `ApportionmentRecord`.

The central discipline is that **quantity is never stored on an entity that could drift from
it**. An `Asset` carries no quantity; `Operation` carries the signed change; `Holding` is the
fold (**ADR-0003**). One level down, `bucket_apportionment` rows are the authored fact and
`VirtualHolding` is the projection of their supersession chain (**ADR-0025**).

See [`portfolio.md`](portfolio.md).

### `strategy` — what was declared, and how far reality is from it

Aggregate roots: `Strategy`, `StrategyVersion`.
Value objects: `StrategyDefinition`, `Rule`, `LeafCondition`, `RuleScopeGate`,
`TargetAllocation`, `TargetNode`, `Tolerance`, `Horizon`, `RiskProfile`.
Derived: `LeafTarget`, `DriftLine`, `DriftComputation`.

The central discipline is the **freeze**: every change to the aggregate writes a new immutable
`StrategyVersion`, and an evaluation may cite nothing but the frozen document (**ADR-0023**).

See [`strategy.md`](strategy.md).

### `market` — every external observation

Only `PriceView` exists today. `IndicatorReading` is specified (RFC-0006 §4.2) but not built.

**ADR-0031** / **E11** widened Market's charter from indicators to *all* external observations,
prices included, so that network egress lives behind exactly one context (Privacy First,
RFC-0005 §5.7).

### `decision` — the immutable audit artifacts

`EvaluationRun`, `Alert`, `Provenance`, `Recommendation`, `Snapshot`, `RuleFiring`, and the
`EvaluationTrace` schema.

**No context depends on this one — the dependency edges are inbound only** (RFC-0004 §4), which
is what makes the Recommendation pipeline testable in isolation. The whole context has no mutable
link: every type in it is an audit artifact.

The `Decision` entity itself (RFC-0004 §7, ADR-0002) — *the user's act* — is **specified but not
implemented**. See [`gaps-specified-not-built.md`](gaps-specified-not-built.md).

See [`decision.md`](decision.md).

### `cashflow` — empty

`core/cashflow/__init__.py` is 0 bytes. Deferred to V1.1 by **ADR-0024** (amended by **ADR-0026**,
which pulled `Account` forward as a reference entity so cash legs are addressable). The package
exists so that C3 has a fifth module to hold independent.

## `core/shared/` — the shared kernel

Deliberately minimal (RFC-0004 §4.1). `core/shared/__init__.py` is the full public surface.

| Module | Holds |
|---|---|
| `base.py` | `DomainModel` — the frozen Pydantic base every domain type extends |
| `ids.py` | the `NewType` id family, `Currency`, `AssetClass`, `Scope`, `entity_ref()` |
| `enums.py` | `Outcome`, `SkipReason`, `Priority`, `SuggestionClass`, `RunMode`, `ScopeKind` |
| `money.py` | `Money`, `Percentage`, `Quantity`, `Weight` |
| `numbers.py` | `Decimal` scales, `Instant`, `quantize()`, `canonical_decimal()` |
| `bound.py` | `Bound[T]`, `SourceRef` — the fact wrapper that makes traces unavoidable |
| `canonical.py` | `canonical_json()`, `canonical_value()`, `sha256_hex()` — the digest basis |
| `labels.py` | the L05 Italian label registry and grammatical-agreement machinery |
| `errors.py` | the `DomainError` hierarchy |

Ids are `NewType` over `UUID` (UUIDv7 in practice, minted behind the `IdGen` port so the core
never generates one). `NewType` keeps them mutually unassignable under mypy at zero runtime cost —
you cannot pass a `BucketId` where a `PortfolioId` is expected.

## The surrounding layers

C3 partitions `core/`. Three more contracts partition everything else:

```
web/                    FastAPI + Jinja + htmx. Vendored assets only, no CDN.
  |                     May import adapters/duckdb/queries/ — and is the ONLY layer that may (C4).
  v
app/                    Use cases. The ONLY layer that holds ports and owns transactions.
  |                     The ONE composition point: engines are composed here, never by each other.
  v
core/  <--- ports/      Pure domain (C1: zero I/O, zero framework, Decimal only).
                        ports/ is a SIBLING of core, not inside it, to keep the graph acyclic.
                        core/engines/ may not import ports/ (C2 — I-7 made structural).

adapters/               DuckDB (hand-written SQL, no ORM), importers, exporters, clock, id-gen.
adapters/duckdb/queries/  The READ side. Non-domain DTOs. Importable only by web/ (C4).
```

Two shapes over one DuckDB file: **hexagonal on the write side, dataflow SQL on the read side**
(RFC-0005 §2). Never inline SQL in a route.

See [`identifier-families.md`](identifier-families.md) for C1–C6 in full, and
`../semantic/relationships.yaml` (the architecture edges at the end of the file) for the
machine-readable form.
