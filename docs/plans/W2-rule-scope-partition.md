# UX-0001 §8.5 — which of the 11 rules run at which scope

Working note for **task #13** (per-scope rule partitioning). Written 2026-08-02 while investigating
why the §8 demo fixture cannot be built against the current engine. Preserved here because the
arithmetic below is the expensive part and should not be re-derived.

**Status**: §1 is settled arithmetic. §2 is an unverified hypothesis about the fix and is explicitly
*not* a design. Nothing here has been validated by running code.

---

## 1. The partition, forced by UX-0001 §8.5's own counts (high confidence)

The documented breakdown reconciles exactly, with no remainder:

| Outcome | Attribution | Total |
|---|---|---|
| SKIPPED | 7 × `zero_portfolio_value` (Personal is empty) · 1 × `heterogeneous_strategies` (portfolio scope) | 8 |
| FIRED | Pension 3 + Children 2 + Emergency 3 + portfolio 2 | 10 |
| NOT_FIRED | Pension 4 + Children 5 | 9 |
| ERROR | 1 (`currency_mismatch`), unattributed to a bucket in the table | 1 |

Per-bucket totals: Pension `3 + 4 = 7`. Children `2 + 5 = 7`. Personal `7` SKIPPED.

**All three land on exactly 7** — the size of the "7 Bucket-scope" rule set, with no slack anywhere.
That forces the whole partition:

- The **7 Bucket-scope rules** are evaluated once per governed Bucket (Pension, Children, Personal):
  7 × 3 = 21 evaluations, fully accounted for.
- Because those three totals are exactly 7 with no slack, **none of the "1 Bucket-specific" or "3
  portfolio-scope" rules can be evaluated inside those per-bucket calls** — if any were, one bucket
  would show 8.
- What remains is portfolio FIRED × 2, the `heterogeneous_strategies` SKIP, and the ERROR: exactly
  4 = 1 Bucket-specific + 3 portfolio-scope. Therefore:
  - **2 of the 3 portfolio-scope rules are the FIRED "portfolio" rows** — `over_apportioned · portfolio`
    and `unassigned_residual_above · portfolio` (rows 8 and 10 of ADR-L04 §4.6's table).
  - **The 3rd portfolio-scope rule is the `SKIPPED(heterogeneous_strategies)` row** — a
    `drift_outside_tolerance` at Portfolio scope, which cannot resolve one governing target tree
    because Pension/Children/Personal (growth v3) and Emergency (capital preservation v1) disagree.
    UX-0001 §8.4 states this directly.
  - **The 1 Bucket-specific rule is the ERROR row** (`currency_mismatch`) — the only slot left, and
    consistent with being specific to one bucket by construction: a fixed target amount and currency
    baked into its params, where the currency (USD) mismatches the bucket's EUR and `Money` raises
    under I-15 rather than converting.

This explains the 11-rule split (7 + 1 + 3) and the 28-evaluation total with nothing unexplained.

## 2. Why the current code cannot produce it (hypothesis — starting point for #13, not a spec)

Verified facts:

- `rule_engine.evaluate(rules, facts)` runs every rule in `sv.rules` against whichever single scope's
  facts the caller assembled. There is no gating on the rule's own `params.scope` — that value is read
  only as a message binding in `evaluate_drift_outside_tolerance` and `evaluate_untargeted_allocation`,
  never compared against the facts' scope.
- `cli.py evaluate` loops `Scope.for_bucket(...)` and never constructs `Scope.for_portfolio(...)`.

Unverified, offered only as the shape of the problem:

1. The CLI would need a portfolio-scope call per Portfolio alongside the bucket loop.
2. A rule would need to evaluate only in the call(s) its scope applies to — the 7 generic rules in
   *every* Bucket call (their target-tree membership, not a hardcoded scope ref, is what makes them
   apply), the 3 portfolio rules *only* in the Portfolio call, and the Bucket-specific rule *only* for
   its one named bucket.

Today no field on `Rule` or `LeafCondition` distinguishes "applies to any Bucket using this version"
from "applies only at Portfolio scope" from "applies only to this one named Bucket". Deciding where
that gate belongs — on `Rule`, on the params model, or via scope-kind matching in the app layer — **is**
the design work #13 needs. Note C2 (engines take no ports) and RFC-0006 §3.1's no-computation boundary
both push toward the app layer making scope-typed calls with its own rule subsets, rather than teaching
the engine about scope.

Related blocker: `SkipReason` has no `heterogeneous_strategies` member, so that row cannot be produced
at all today. Task #14.
