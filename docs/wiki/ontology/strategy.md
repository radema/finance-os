# Strategy context — what was declared, and how far reality is from it

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.
Machine-readable form: `../semantic/entities.yaml` (`context: strategy`).

`src/financeos/core/strategy/`

## The governing idea

**An evaluation may cite nothing but a frozen document.**

Every change to the Strategy aggregate writes a new immutable `StrategyVersion`. A
`Recommendation`'s `rationale` is *assembled* from that frozen document and from nothing else
(**ADR-0023**) — which is what makes the product's promise literal: the system **restates the
user's own prior declaration** and reports arithmetic against it. It never asserts that anything is
suitable. That is the MiFID suitability firewall expressed as a schema rather than as a policy.

## The freeze

### `Strategy` — `strategy.py:149`

```
id: StrategyId · name: str · description: str | None
current_version_id: StrategyVersionId | None
```

**Identity and name only.** Every frozen copy of targets, tolerances, rules, horizon and risk lives
in `StrategyVersion.definition` (**ERR-8**, **ADR-0027**). `current_version_id` is the *only*
mutable field on the aggregate, repointed by `UPDATE` on freeze. It carries no FK (a
mutually-referencing gap between `strategy` and `strategy_version`).

> **AUTHORED DATA.** No recovery path but `financeos export --authored`.

### `StrategyVersion` — `strategy.py:118`

```
id · strategy_id · parent_version_id: StrategyVersionId | None
definition: StrategyDefinition · change_note: str · frozen_at: Instant
```

Immutable aggregate root. Written on **every** change to the Strategy aggregate — targets,
tolerances, rules, horizon, risk, principles, objective, name, description — with **no materiality
judgment** (**RFC-0007 §7**, as restated by **ADR-0030**, which puts `Goal` links *outside* the
freeze boundary).

Two fields are easy to underrate:

- `parent_version_id` is lineage, so the history of the author's thinking is walkable.
- `change_note` is **required on freeze** and is the only place the *why* of a change lives. It is
  **unrecoverable later** — nothing else in the system records intent.

`.rule(rule_id)` is the **integrity guarantee that replaced the dropped foreign key**
(**ADR-0027**). It raises `RuleNotInVersionError` for an id absent from this version.

### `StrategyDefinition` — `strategy.py:81`

The frozen document: `name`, `description`, `objective`, `horizon`, `risk`, `targets`, `rules`.

Two constructor checks: at least one Rule (**I-4**), and rule ids distinct within the version.

Supporting value objects: `Horizon` (`strategy.py:28` — exactly one of `years` / `target_date`),
`RiskProfile` (`strategy.py:74`), `RiskLevel` (`strategy.py:41`).

`RiskLevel` deserves care. Per **P31** / **P32** it is the **seven-step UCITS KIID (SRRI) / PRIIPs
KID (SRI)** scale, with `risk_level_rank()` at `strategy.py:69` supplying the 1–7 ordinal that
`StrEnum` cannot carry.

> It is an **owner-declared** value merely *expressed* on the regulatory scale. This codebase does
> **not** compute SRRI/SRI from volatility or market/credit risk bands, and no field, docstring, ADR
> line or UI string may imply otherwise. A *computed* risk level is a separate feature, out of V1.0
> (**P33**) — collapsing the two would let a computed number overwrite a user declaration.

## Rules and conditions

### `Rule` — `rule.py:90`

```
id: RuleId · name · enabled: bool · priority: Priority
suggestion_class: SuggestionClass · message: str
condition: LeafCondition · scope_gate: RuleScopeGate | None
```

A child entity of `StrategyVersion`. Two facts about its identity matter:

- **`rule_id` is stable across versions** — which is what makes "how has this rule's firing history
  evolved?" answerable at all, and why `finding_key` can key on it.
- **The definition is frozen per version.** The same `rule_id` may mean different things in two
  versions, and each `Alert` resolves it against the version its run pinned.

> ### A `Rule` has no relational identity
>
> **There is no `rule` table** (**ADR-0027**). `alert.rule_id` and `recommendation.rule_id` carry
> **no foreign key**. A Rule is resolved through
> `run_id → strategy_version_id → definition.rules`, guarded by `StrategyDefinition.rule()` plus a
> property test rather than by an FK.
>
> An agent grepping for a `rule` table and finding nothing has found the correct answer, not a
> missing migration.

`priority` is **author-declared and never overridden by computation** (RFC-0008 §3), and it
**dominates** severity in every ordering. `enabled=False` yields `SKIPPED(disabled)`, never
`NOT_FIRED`.

### `LeafCondition` — `rule.py:29`

```
kind: str · kind_version: int · params: Mapping[str, str] · max_staleness: timedelta | None
```

A leaf of a **closed typed catalog** (**ADR-0014**) — *not* an expression language. Stored as a
kind, a version and a flat mapping of **canonical string** params.

The two-phase validation is deliberate: params are validated against the catalog's Pydantic model at
**authoring** time (the application layer, on freeze), and parsed by the engine at **evaluation**
time. So `core.strategy` never imports the engine registry, and the frozen document stays
self-describing.

**A kind's semantics never change — a new meaning is a new kind** (**RFC-0006 §8**). Re-registering
a `(kind, kind_version)` pair raises `RegistryError`. `kind_version` is recorded in every trace.

`max_staleness` is a per-leaf override of the kind's declared default (**ERR-10** added the default
as the eighth mandatory registration component).

**Combinators are not implemented.** `all_of` / `any_of` / `not` over flat leaves, **composition
depth exactly 1**, are specified in RFC-0006 §2.1 but out of skeleton scope (RFC-0006 §12).
`Rule.condition` is a bare `LeafCondition`, not a union. Depth 1 is a design limit, not an
accident: deeper nesting is how a closed catalog turns into an expression language by degrees.

### `RuleScopeGate` — `rule.py:48`

```
kind: ScopeKind · bucket_id: BucketId | None
```

Which evaluation call(s) a Rule applies to (**ADR-L06**). This is the subtlest type in the context,
and the docstring explains why it must exist:

> Nothing about a `LeafCondition`'s own params says whether a Rule is meant to run once per governed
> Bucket, only at the whole-Portfolio call, or only for one named Bucket — `scope` on the three kinds
> that carry it is a **message binding**, never compared against the facts' actual scope.

Two rules for touching it:

- `scope_gate=None` means **unconstrained** — the ADR-L06 §4.1 compatibility default, preserving the
  prior implicit behaviour for every rule that does not declare one. The app then falls back to
  inferring a gate from the condition kind (`_default_scope_gate`).
- It is read by **`app/evaluate_strategy.py`**, which subsets `sv.rules` *before* calling
  `RuleEngine.evaluate` — **never by the engine itself** (**C2**, RFC-0006 §3.1).

## Targets

### `TargetAllocation` / `TargetNode` / `LeafTarget` — `targets.py`

A tree of **relative** weights: each node's weight is relative to its **parent**. So restructuring a
subtree is a local edit and the exported YAML keeps a readable diff (**ADR-0009**). A leaf's
**effective target is the product of the weights along the root→leaf path**.

**I-13 (revised, ERR-5):** the children of **every** node sum to 1 within an explicit `Decimal`
epsilon (`WEIGHT_SUM_EPSILON`), enforced in the **constructor** (`_check_sum_to_one`,
`targets.py:113`). Effective leaf targets therefore sum to 1 **by construction** — there is no
separate global check, and adding one would be redundant.

Also enforced at construction: distinct keys per level, and **no `AssetClass` targeted by more than
one leaf**.

`TargetNode.key` is an `AssetClass`, **never an `AssetId`** (**I-14**).

> **ERR-14 rescoped I-14.** `over_apportioned` legitimately keys facts by `AssetId`. That is not a
> violation: I-14 governs the **target tree**, not every condition. RFC-0012's **ADR-0033** restates
> I-14 to `(axis, value)` pairs, which is **not implemented**.

**A leaf must declare a `Tolerance`** — a target with no band cannot yield the `effective_band`
every drift finding is measured against. An interior node *may* declare one; interior breaches are a
**distinct finding reported by their own rule** (RFC-0007 §2.1) and are **not inherited** by leaves.
Drift is computed at leaves only.

The skeleton authors a depth-1 tree, which is exactly a flat allocation and a strict special case —
so nothing is retrofitted when hierarchy arrives.

### `Tolerance` — `targets.py:47`

`kind: ToleranceKind` (`ABSOLUTE | RELATIVE`) and `band: WeightAmount` (must be `> 0`).
**ADR-0018**:

- `ABSOLUTE(band)` is ±band in **percentage points** of scope weight.
- `RELATIVE(band)` is ±(`band × effective_target`) — the **proportional** form.

Without the relative form, a ±5pp band on a 4% target would permit the position to **vanish** without
registering a breach. And a `RELATIVE` band on a **zero** target is legitimately zero — which is
exactly why `severity` is nullable (**ERR-1**). See
[`outcomes-and-severity.md`](outcomes-and-severity.md).

## Drift — the derived facts

### `DriftLine` / `DriftComputation` — `drift.py`

`DriftLine` carries **every binding RFC-0007 §4 names**, pre-computed:

```
asset_class · current_value · current_weight   # value(class) / total_value(scope)
effective_target · target_value
drift                # current_weight − effective_target; NEGATIVE means UNDER target
drift_value          # drift × total_value — the number a Decision acts on
tolerance · effective_band
severity             # |drift| / effective_band — 1.0 is exactly at the band; None when band == 0
```

This is the concrete form of **RFC-0006 §3.1**: **the Rule Engine performs no financial
computation.** `severity` and `effective_band` arrive already computed by the Strategy Engine. A new
fact must carry something *another* engine already produced.

`DriftComputation` is either/or: **either** `lines` is populated, **or** `unavailable` says why
drift could not be computed at all — a zero-value portfolio (a legitimate onboarding state) or an
incomplete valuation. The reason **travels** to the Rule Engine, so the resulting `Alert` reads
`SKIPPED(<reason>)` rather than the inverted `NOT_FIRED` (**ADR-0016**).

## Behaviours here that look like bugs

- **Mixed governance produces `SKIPPED(heterogeneous_strategies)`, never an average**
  (**RFC-0007 §5**, **ADR-L06**).
- **Strategy YAML under export is a derived artifact** (**ADR-0009**). Edit via
  `financeos import-strategy`, which freezes a new version. Hand-editing the export is editing an
  output.
- **Every trivial edit freezes a new version.** No materiality judgment, by design (RFC-0007 §7).
- **There is no `Goal` type**, though the `goal` and `strategy_goal` tables exist. See
  [`gaps-specified-not-built.md`](gaps-specified-not-built.md).

## Engine

`strategy_engine.py` — `compute_drift`, `compute_targets`. Both take `sv.targets`. Pure, no ports.
`compute_targets` produces `FACT_TARGETS` **independently of whether drift is computable**
(**ADR-L05 §5**), so `untargeted_allocation`'s membership test does not depend on drift.
