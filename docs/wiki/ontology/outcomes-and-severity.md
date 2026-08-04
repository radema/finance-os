# The four outcomes, and severity

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.

These two concepts come up constantly and are the easiest things in the system for an agent to get
wrong. They are first-class ontology, not implementation detail.

---

## The four outcomes

`Outcome` — `src/financeos/core/shared/enums.py:59`. Specified by **RFC-0006 §5** ("Outcomes: Four,
Not Two") and **ADR-0016**. Persisted on `alert.outcome` with a four-value `CHECK`.

| Outcome | Meaning | Recommendation? | severity | Surfaces on |
|---|---|---|---|---|
| `FIRED` | the predicate held | **exactly one** (ACTUAL runs only) | may be set | findings list |
| `NOT_FIRED` | the predicate was evaluated and did **not** hold | no | may be set | nothing (but is persisted and traced) |
| `SKIPPED` | the rule **could not be evaluated** | no | **always NULL** | run-health panel |
| `ERROR` | evaluation raised; the run continues | no | **always NULL** | run-health panel |

### `SKIPPED != NOT_FIRED`

This is the single most important distinction in the system. From the enum's own docstring:

> `SKIPPED` must never read as `NOT_FIRED`: a rule that could not be evaluated is not a rule that
> found nothing. Conflating them reports compliance exactly when the system knows least about the
> portfolio.

A `NOT_FIRED` is a positive statement — *we checked, and you are within tolerance*. A `SKIPPED` is
an absence of knowledge — *we could not check*. Rendering a `SKIPPED` as "compliant", or letting it
fall through a `if outcome == FIRED / else: compliant` branch, produces a green dashboard for a
portfolio nobody managed to evaluate. That is the failure mode **ADR-0016** exists to prevent.

Practical rules:

- Never write `if outcome == FIRED: ... else: ...` over outcomes. Handle all four, or handle
  `FIRED` / `NOT_FIRED` and route `SKIPPED` / `ERROR` to run health.
- A disabled rule is `SKIPPED(disabled)`, **never** `NOT_FIRED`.
- An unavailable fact family is `SKIPPED(<the producing engine's reason>)`, never an assumed zero.
- `ERROR` does **not** abort the run. The firing carries `error` (the exception message) and
  evaluation continues to the next rule.

### All four are persisted

`Alert` is a **rule evaluation record** (**E5**, ratified), not a notification. All four outcomes
are written, because *"nothing fired" is as much an explanation as a firing*. Only `FIRED` reaches
the recommendations list; `SKIPPED` and `ERROR` feed the run-health panel.

Tests that pin this: `tests/test_rule_engine.py::TestOutcomes` (five cases, one per behaviour),
`tests/test_trace_replay.py::test_the_property_covers_every_outcome_the_engine_can_produce`,
`tests/test_evaluate_strategy.py::TestRunOutcomeCountsCoalesce`.

### `SkipReason`

`src/financeos/core/shared/enums.py:73`. Carried on `RuleFiring.skip_reason`,
`EvaluationTrace.skip_reason`, and per-fact on `FactUnavailable.reason`.

| Reason | When |
|---|---|
| `disabled` | `Rule.enabled` is `False` |
| `missing_fact` | a keyed fact the kind needed is simply absent |
| `stale_fact` | the fact was older than `max_staleness` — see `StaleFactNote` |
| `zero_denominator` | a `divide_safe` hit a zero denominator |
| `zero_portfolio_value` | an empty scope — a legitimate onboarding state, not an error |
| `heterogeneous_strategies` | a PORTFOLIO-scope evaluation cannot resolve one target tree |

`heterogeneous_strategies` (**RFC-0007 §5**, **ADR-L06**; the newest member, added at `2dd7346`)
is worth spelling out. A `Bucket` is governed by exactly one `Strategy` (**I-3**). So a
Portfolio-scope evaluation whose governed Buckets follow *different* `StrategyVersion`s has no
single target tree to resolve against. The system emits `SKIPPED(heterogeneous_strategies)`.

> **Mixed governance produces a skip, never an average.** An averaged target tree would be a
> policy nobody declared. This looks like a missing feature; it is a deliberate refusal.

`FactUnavailable` generalises RFC-0006 §5's *"the trace lists which"* to **lists which, and why** —
recording the reason next to the name is what lets a replay reconstruct the skip rather than guess
at it.

Italian labels and teaching glosses for every reason are fixed verbatim by **P22**.

---

## Severity

Specified by **RFC-0007 §3.1** ("Severity: a dimensionless breach ratio"). Declared per kind via
`SeverityDeclaration` (`src/financeos/core/engines/rule_engine.py:551`). Promoted to a real column
on `alert.severity` by **ERR-1**. Local declarations for three kinds in **ADR-L02**, and for
`over_apportioned` in **ADR-L04**.

### It is a ratio, anchored at 1.0

Severity is **dimensionless** and **anchored** so that:

- `severity == 1` sits **exactly at the kind's own firing threshold**, and
- it **rises monotonically** as the breach worsens.

The anchor is what makes severities from *different* kinds comparable at all. A drift breach at
`1.5` and a bucket shortfall at `1.5` are both "50% past the line", though one is measured in
weight and the other in money.

The six kinds' declared formulas:

| kind | formula |
|---|---|
| `drift_outside_tolerance` | `\|drift\| / effective_band` |
| `untargeted_allocation` | `max(current_weight over the affected set) / threshold_weight` |
| `unassigned_residual_above` | `residual_weight / threshold_weight` |
| `bucket_below_target_value` | `1 + shortfall_value / target_value` (`= 2 - coverage`) |
| `over_apportioned` | `1 + Σ deficit_quantity / Σ apportioned_quantity` (`= 2 − coverage`) |
| `allocation_absent` | **`None`** — declared refusal |

The last two share the *uniform anchor* trick: a shortfall/deficit ratio naturally reads `0` at
the threshold, so `1 + ratio` shifts it to read `1.0` exactly at the line (**ADR-L04**).

### `severity = null` is a real semantic

`SeverityDeclaration.formula` has **no default**. A kind cannot be registered without deciding:
either a formula, or an **explicit `None`**.

An explicit `None` means *this kind cannot express urgency* — not *we forgot*, and not *zero*.
`allocation_absent` is the example: a class is either present or absent, and there is no "more
absent". There are three sources of a null severity:

1. the kind declares no formula (`allocation_absent`);
2. the outcome is `SKIPPED` or `ERROR` — enforced by `Alert._is_explainable`, which raises
   `InvariantViolationError("ERR-1: severity is NULL for SKIPPED and ERROR")`;
3. the formula's denominator is legitimately zero — a `RELATIVE` `Tolerance` band on a zero target
   gives `effective_band == 0`, so `DriftLine.severity` is `None`: **undefined rather than
   infinite**.

### Which is why ordering uses `NULLS LAST`

Because null is a real value rather than missing data, it must sort *somewhere*, and the somewhere
is **last**: a kind that cannot express its own urgency must not outrank one that can.

The full ordering triple, **RFC-0008 §3**:

```
priority_rank DESC, severity DESC NULLS LAST, rule_id ASC
```

Restated in three independent places, all of which must agree:

| Where | Code |
|---|---|
| the engine | `decision_engine.materialize` docstring + `_SEVERITY_NULL_SENTINEL = Decimal("-1")` (`decision_engine.py:53`) |
| the view | `mv_finding`'s `ORDER BY priority_rank DESC, current_severity DESC NULLS LAST, r.rule_id ASC` (`001_init.sql:439`) |
| the read side | `queries/findings.py` and `queries/runs.py::list_alerts` each restate it |

Two properties of this triple are load-bearing:

- **Priority dominates severity.** `Priority` is *author-declared* and **never overridden by
  computation** (RFC-0008 §3). A `CRITICAL` rule at severity `1.01` outranks an `INFO` rule at
  severity `40`. This is not a bug and not a tunable.
- **`rule_id ASC` makes it total.** Without a total order, a re-run could reorder equal rows and
  the byte-identical-replay gate would fail intermittently.

Pinned by `tests/test_mv_finding_ordering.py` — five tests, including
`test_priority_dominates_at_an_arbitrarily_small_severity_margin` and
`test_null_severity_sorts_below_the_lowest_legal_firing_value`.

### One trap: two different priority-rank literals

`priority_rank()` (`core/shared/enums.py:39`) maps `CRITICAL=4 … INFO=0`.
`mv_finding`'s inline `CASE` maps `CRITICAL=5 … INFO=1`.

Both are monotonic and each is only ever compared against itself, so the off-by-one is harmless.
But **do not assume the two literals match** — if you add a `Priority` member, both must be
updated, and a numeric comparison across the two is meaningless.

---

## See also

- `../semantic/entities.yaml` — `grep -A20 '^- entity: Outcome$'`, `SkipReason`,
  `SeverityDeclaration`, `Finding`
- [`evaluation-pipeline.md`](evaluation-pipeline.md) — where outcomes are produced and consumed
- [`decision.md`](decision.md) — `Alert`, and the `Alert` → `Recommendation` step
