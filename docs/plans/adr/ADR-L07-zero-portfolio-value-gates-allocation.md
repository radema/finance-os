# ADR-L07 — `zero_portfolio_value` also gates the `allocation` fact family

| | |
|---|---|
| **Status** | Accepted (product owner decision, §8.5 fixture build) |
| **Date** | 2026-08-04 |
| **Resolves** | An arithmetic gap found while building the UX-0001 §8.5 demo fixture: `untargeted_allocation` and `allocation_absent` could not reproduce the fixture's stated "7 × `zero_portfolio_value`" `SKIPPED` split for an empty Bucket |
| **Depends on** | RFC-0006 §3.1/§4 (`required_facts` precheck, no financial computation in the Rule Engine), RFC-0007 §4.1 (`compute_drift`'s own `zero_portfolio_value` precedent), ADR-0016 (inverted-silence failure mode), ADR-L02 §4.2–§4.3 (`unassigned_residual_above`/`allocation_absent` severity semantics), ADR-L04 §4.2 ("never invent a partial denominator"), ADR-L06 §7.1 (the precedent this extends, and the boundary it does *not* cross) |
| **Blocks** | The UX-0001 §8.5 demo fixture (10 FIRED / 9 NOT_FIRED / 8 SKIPPED / 1 ERROR) — Personal's 7 generic Bucket-scope rules cannot all read `SKIPPED(zero_portfolio_value)` without this fix |
| **Overrides** | Nothing in `docs/seed/`. Extends `app/evaluate_strategy.py`'s `unavailable` assembly, additive to ADR-L06 §5.1's file-by-file change list |

---

## 1. Context

`evaluate_strategy.py` assembles one `unavailable: dict[str, SkipReason]` per call and hands it to
the Rule Engine as part of `FactSet`. `_evaluate_rule`'s `required_facts` precheck
(`rule_engine.py:1342-1350`) walks a kind's declared `required_facts` and returns `SKIPPED` with the
family's own reason the moment any one of them is marked unavailable — *before* the evaluator ever
runs.

Before this ADR, exactly one cause ever populated that dict for a Bucket-scope call with a real
value: `strategy_engine.compute_drift` returning `unavailable=ZERO_PORTFOLIO_VALUE` (or
`MISSING_FACT`) when a scope's holdings can't be valued, which `evaluate_strategy.py` copied into
`unavailable[FACT_DRIFT]` only. `FACT_ALLOCATION` and `FACT_TARGETS` were never marked, on the
reasoning (correct for a *non-empty* scope) that `compute_allocation`'s own output is legitimately
available data even when `compute_drift` can't turn it into a weight.

Building the UX-0001 §8.5 fixture exposed the gap this leaves for a *genuinely empty* Bucket
(Personal: zero holdings, zero apportionment). Verified directly against the engine:

```
untargeted_allocation on empty bucket: NOT_FIRED None None
allocation_absent on empty bucket: SKIPPED missing_fact None
```

- `untargeted_allocation` declares `required_facts={targets, allocation}`. Neither family is marked
  unavailable for a zero-value scope, so the precheck passes and the evaluator runs against a
  genuinely, vacuously empty `facts.allocation` — no class is "untargeted" because no class is held
  at all — and reports `NOT_FIRED`, not `SKIPPED`.
- `allocation_absent` declares `required_facts={allocation}` but reads `facts.drift_for(asset_class)`
  directly (ADR-L02/L04's MAJOR-6 fix, deliberately narrower than the family precheck). Since
  `compute_drift` returns `lines={}` for a zero-value scope, `drift_for()` returns `None` and
  `open_fact` raises `SkipSignal(MISSING_FACT)` — always that reason, never the family's own root
  cause.

Both are pre-existing, already-shipped behaviours; the second is the exact mechanism ADR-L06 §7.1's
round-3 correction tested and ratified as *correct* for the analogous heterogeneous-governance case
(`test_allocation_absent_skips_with_missing_fact_under_mixed_governance`). This ADR does not disturb
that precedent — it closes a distinct gap in the *zero-portfolio-value* branch, which §7.1 never
touched.

UX-0001 §8.5 states, verbatim: *"SKIPPED | 8 | 7 × `zero_portfolio_value` (Personal is empty) · 1 ×
`heterogeneous_strategies`"*. W2-rule-scope-partition.md §1's settled, no-slack arithmetic forces all
7 of growth v3's generic Bucket-scope rules to be evaluated identically at Pension, Children and
Personal. With only `drift_outside_tolerance` (capped at 5, one per leaf of the fixture's fixed
5-leaf tree) cleanly producing that reason, the fixture's other two generic rules —
`untargeted_allocation` and `allocation_absent`, needed at Pension/Children to reproduce rows 3/7 of
ADR-L04 §4.6's ordered table — cannot reach the required split without this fix. Escalated to the
product owner (never invented unilaterally, per this repo's own rule); decision: **fix the wiring**
(this ADR's option 1 of the three offered).

---

## 2. Decision Drivers

- **`SKIPPED != NOT_FIRED`, and an empty scope is exactly ADR-0016's failure mode.** A Bucket with
  nothing apportioned to it cannot honestly answer "is anything untargeted here" — the true answer is
  "cannot be measured", not "no". Reporting `NOT_FIRED` on a rule that never had the standing to
  answer is the inverted-silence pattern ADR-0016 exists to prevent, and it is the same class of bug
  `drift_outside_tolerance` was already immune to (it *does* skip cleanly, via the existing
  `FACT_DRIFT` marking).
- **Consistency with `drift`'s own precedent, not a new invention.** `compute_drift` already treats
  zero portfolio value as "unavailable", not "empty-but-fine" — this ADR extends the exact same
  judgement to the sibling fact family that shares its root cause (the same zero-holdings state),
  rather than adopting a different standard for `allocation`.
- **Never widen the `MISSING_FACT` (partial) case.** ADR-L04 §4.2's "never invent a partial
  denominator" cuts both ways: a scope with *some* unpriced Assets still has real, partial
  `AllocationLine`s for everything that *did* price. Marking `FACT_ALLOCATION` unavailable there would
  discard real data the family precheck has no business discarding. The fix is scoped to
  `ZERO_PORTFOLIO_VALUE` specifically, leaving `MISSING_FACT` untouched.
- **No change to the already-ratified heterogeneous-governance branch.** ADR-L06 §7.1's fix (blanking
  both `drift` and `targets` under mixed governance) is a separate `if` branch and is not touched.
  `allocation_absent`'s `missing_fact` reason under *that* cause remains exactly as tested.
- **Product-definition question, decided by the product owner.** Whether "the scope holds nothing" is
  *unavailable* data or *available-and-empty* data is a domain-modelling call, not an authoring
  choice — flagged rather than invented, per this repo's rule that product-definition questions go to
  the product owner.

---

## 3. Considered Options

(Presented to the product owner; option 1 chosen.)

1. **Mark `FACT_ALLOCATION` unavailable=`ZERO_PORTFOLIO_VALUE`** in `evaluate_strategy.py` whenever
   `compute_drift` reports that reason, mirroring the existing `heterogeneous_governance` treatment of
   `drift`+`targets`. Reaches UX-0001 §8.5's exact split for both kinds with one additive line.
2. **Relax §8.5's reason-attribution requirement** and accept whatever mix the unmodified engine
   produces. Rejected: `untargeted_allocation` would stay `NOT_FIRED` at Personal unless it is instead
   authored as Bucket-*specific* (not generic) rules for Pension/Children only — which breaks UX-0001's
   own "7 Bucket-scope rules × 3 governed Buckets = 21" formula, since a non-generic rule is not one of
   "the 7 × 3". No version of this option was found that keeps the FIRED/NOT_FIRED totals (10/9) exact
   without also moving those numbers.
3. **Ratify option 1 via a dedicated ADR** rather than a silent code change. Not a distinct technical
   option — the vehicle this repo already uses for exactly this kind of call (ADR-L02, ADR-L04,
   ADR-L06 all follow this pattern). This document *is* that ADR.

---

## 4. Decision Outcome

**Option 1.** `app/evaluate_strategy.py`'s `unavailable` assembly now reads:

```python
elif drift_unavailable is not None:
    unavailable[rule_engine.FACT_DRIFT] = drift_unavailable
    if drift_unavailable is SkipReason.ZERO_PORTFOLIO_VALUE:
        unavailable[rule_engine.FACT_ALLOCATION] = drift_unavailable
```

Scoped narrowly to `ZERO_PORTFOLIO_VALUE` — the `MISSING_FACT` case (an unpriced Asset elsewhere in
scope, partial `AllocationLine`s otherwise real) is deliberately excluded, per §2's "never widen the
partial case" driver. `FACT_TARGETS` is left unmarked: `compute_targets` resolves the frozen tree
independently of holdings and stays genuinely available, and marking it would have no effect anyway
(`untargeted_allocation`'s precheck already trips on `FACT_ALLOCATION` alone; `allocation_absent`
doesn't declare `targets` at all).

### 4.1 Consequence, kind by kind

| Kind | Before | After | Why |
|---|---|---|---|
| `drift_outside_tolerance` | `SKIPPED(zero_portfolio_value)` | unchanged | Already gated on `FACT_DRIFT` alone. |
| `untargeted_allocation` | `NOT_FIRED`, `severity=None` | `SKIPPED(zero_portfolio_value)` | `required_facts={targets, allocation}` now trips on `FACT_ALLOCATION` in the family precheck, before the evaluator ever reads the vacuously-empty `facts.allocation`. |
| `allocation_absent` | `SKIPPED(missing_fact)` | `SKIPPED(zero_portfolio_value)` | `required_facts={allocation}` now trips in the family precheck; the per-class `open_fact(drift_for(...))` fallback is never reached for this cause. Its `missing_fact` behaviour under **heterogeneous governance** (a different `unavailable` cause, ADR-L06 §7.1) is untouched. |
| `unassigned_residual_above`, `over_apportioned`, `bucket_below_target_value` | unaffected | unaffected | None declares `allocation` in `required_facts`. |

### 4.2 Verification

New tests in `tests/test_evaluate_strategy.py::TestZeroPortfolioValueSkipsAllocationDependentKinds`,
each against a real `DuckDBUnitOfWork` (a Bucket that exists, in a Portfolio that holds value
elsewhere, with nothing apportioned to it): both `test_untargeted_allocation_skips_with_zero_portfolio_value`
and `test_allocation_absent_skips_with_zero_portfolio_value` fail against the pre-fix code
(`NOT_FIRED` and `SKIPPED(missing_fact)` respectively — reproduced and confirmed before the fix
landed) and pass after it. Full suite: 469 passed (467 pre-existing + these 2), no regressions —
confirming ADR-L06 §7.1's heterogeneous-governance tests are untouched, since that `if` branch is not
modified.

---

## 5. Consequences

**Positive**

- Closes the UX-0001 §8.5 fixture's arithmetic gap: all 7 of growth v3's generic Bucket-scope rules
  now uniformly `SKIP(zero_portfolio_value)` at an empty governed Bucket.
- `untargeted_allocation` and `allocation_absent` now share `drift_outside_tolerance`'s honest
  "cannot be measured" answer for the one state they previously answered two different, both
  misleading, ways.
- No new operation, no new rule kind, no threshold moved — a wiring correction to which fact families
  a pre-existing root cause marks unavailable.

**Negative / accepted costs**

- **Two lookup paths inside one `elif` branch** (`FACT_DRIFT` always; `FACT_ALLOCATION`
  conditionally) — a reader must know the `ZERO_PORTFOLIO_VALUE`/`MISSING_FACT` split matters here
  even though `evaluate_strategy.py` treated them uniformly before. Documented inline.
- **A prior caller (if any existed) relying on `allocation_absent`'s `missing_fact` reason under a
  literally-zero-value scope would see a different `SkipReason` string after this change.** No such
  caller exists in this codebase today (verified: no test asserted the pre-fix reason for this
  specific cause), but this is a real behavioural change to a shipped code path, not purely additive.
