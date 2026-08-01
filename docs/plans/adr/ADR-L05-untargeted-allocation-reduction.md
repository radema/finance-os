# ADR-L05 — `untargeted_allocation` reduction over multiple classes

| | |
|---|---|
| **Status** | Accepted (V1.0, Wave 2) |
| **Date** | 2026-08-01 |
| **Resolves** | BLOCKER 1 of the rule-catalog review of `8e5e51d..87f89b0` — the shipped evaluator took an `asset_class` param and never tested untargetedness. The corpus states the signature twice but never says how one scope-level rule reduces over several untargeted classes at once |
| **Depends on** | RFC-0006 §3 (catalog row and signature; the kind's rationale at §3 ¶"`untargeted_allocation` is required by RFC-0007 §4.2"), RFC-0006 §3.1 (the no-computation boundary), RFC-0006 §4 / §4.1 (`FactSet`; the 15-op algebra; totality), RFC-0007 §4.2 (the kind's definition), RFC-0009 §2.2 (the Reconcile example the kind exists to catch), ADR-L02 §4.6 (the uniform anchor and its generalized registry test), ADR-L04 (the aggregate-reduction precedent and the open-interval anchor), RFC-0008 §3 (ordering) |
| **Overrides** | Nothing. This fills a gap the corpus left open; it contradicts no ratified text |
| **Ratified by** | Product owner, 2026-08-01, on a three-option choice (aggregate/max, aggregate/sum, per-class fan-out) |

---

## 1. Context

RFC-0006 §3's catalog row and RFC-0007 §4.2 agree on the signature and say nothing about reduction:

| kind | params | facts | depth |
|---|---|---|---|
| `untargeted_allocation` | `scope`, `threshold_weight` | `targets`, `allocation` | 1 |

> `untargeted_allocation(scope, threshold_weight)` — fires when a held `AssetClass` has no target in
> the governing `StrategyVersion`. (RFC-0007:123)

The kind's purpose is discovery. RFC-0006:113 grounds it in RFC-0009 §2.2's Reconcile example — an
`Asset` reclassified into a class the governing `StrategyVersion` does not target — and states the
symptom it exists to explain: *"Untargeted holdings stay in the denominator, so without this kind the
only symptom is a scattering of small spurious under-allocation findings across every other class, and
the actual cause is invisible."*

The class in question is therefore, by construction, **unknown when the rule is authored**. The
implementation that landed in `87f89b0` added an `asset_class` param and made the predicate
`weight(asset_class) > threshold_weight` — no target is ever read, and `required_facts` is
`{allocation}` alone. Two failures follow: the kind renders *"priva di un target nella strategia in
vigore"* about classes that do have targets, an assertion the code never checked; and the newly
appeared untargeted class — the only case the kind was written for — produces no finding at all,
because no author named it in advance.

Restoring `(scope, threshold_weight)` is not a judgment call; the corpus states it twice. But once the
rule is scope-level, a question the corpus never answers becomes load-bearing: **several classes can be
untargeted and above threshold in the same evaluation.** One rule must produce one severity and one
Italian sentence out of N breaches.

---

## 2. Decision Drivers

- **One rule is one `Alert`.** The Rule Engine evaluates a `Condition` to a single `ConditionResult`;
  `finding_key` hashes `(rule_id, scope_id, canonical(condition.params))` with no per-class
  discriminator. Fan-out is not a parameter choice, it is an engine change.
- **The anchor must survive.** ADR-L02 §4.6, generalized: *"For every registered kind declaring a
  formula, `severity == 1` exactly at that kind's own firing threshold, and `severity` is monotonically
  non-decreasing in the breach magnitude."* Any reduction that cannot be anchored at the threshold
  breaks the generalized registry test rather than merely reading oddly.
- **Ordering must stay meaningful.** RFC-0008:59 sorts `severity DESC` inside a `Priority` band. A
  reduction whose value depends on how finely the untargeted capital happens to be split would make
  two portfolios with identical escaped capital sort differently.
- **A precedent already exists in the same catalog.** `over_apportioned` (ADR-L04) reduces over several
  affected assets with `any_of` over per-asset operands, an aggregate severity, and the affected
  instruments named in the message. Reusing that shape costs no new machinery and keeps two sibling
  kinds explicable by one description.
- **RFC-0008:113 and :276 refuse to collapse correlated findings** — *"an imbalance can present as two
  findings. Deliberate, but it will occasionally feel like noise."* This pulls toward fan-out and is the
  strongest argument against the decision taken; see §4.

---

## 3. Decision

**Aggregate reduction, worst-class severity.** One rule, one `Alert`.

```
affected  = [c for c in allocation if c not in targets and weight(c) > threshold_weight]
fired     = any_of(affected)
severity  = max(weight(c) for c in affected) / threshold_weight
```

1. **Signature restored** to `(scope, threshold_weight)`. The `asset_class` param is removed.
2. **`required_facts = {targets, allocation}`**, per RFC-0006 §3's catalog row. The predicate tests
   membership against the target tree; a class with a target can no longer fire.
3. **Empty affected set → `NOT_FIRED`, `severity = None`** — `any_of` over zero operands is `False`,
   identical to ADR-L04 §4.3's row for `over_apportioned`.
4. **Severity is the worst single class**, not the sum. It is `1.00` exactly when one class sits on the
   threshold, monotone in breach, and independent of how the remaining untargeted capital is subdivided.
5. **The message names every affected class**, in the canonical order of RFC-0006 §10, mirroring
   `over_apportioned`'s `instrument_labels` binding. Italian, P19 prose forms, P25 head-noun capitals.
6. **The predicate uses a strict `gt`**, so — exactly as with `over_apportioned` — `1.00` is a limit
   never attained on a `FIRED` row and the firing range is the open interval `(1, ∞)`. The kind
   therefore belongs in whatever named open-interval exemption set the fix for MAJOR 7 introduces, and
   its boundary must be covered by a real repro test (a class just above the threshold), not by a prose
   assertion. That was the §3.2 lesson of HANDOFF-2026-07-31.

The severity arithmetic is recorded before the predicate step, because `replay_trace` requires the
final step to be boolean (ADR-L04 §1 item 2).

---

## 4. Options rejected

**Sum-based severity** — `Σ weight(c) / threshold_weight` over the affected set. Measures total escaped
capital rather than the worst class, and also anchors at `1.00`. Rejected because it makes the value
depend on the granularity of the classification: three untargeted classes at 1.5pp against a 2pp
threshold would outrank one class at 4pp, though the second is the more urgent single breach and the
first may be an artifact of how finely the taxonomy splits. Worth revisiting if real portfolios show
the opposite intuition — the change is one operator and one anchor test.

**Per-class fan-out** — one `Alert` per untargeted class. The most faithful reading of RFC-0008:113's
refusal to collapse correlated findings, and it gives each class its own actionable severity. Rejected
for V1.0 on cost, not on principle: it requires `finding_key` to admit a per-class discriminator, a
fan-out path in the Rule Engine that no kind currently uses, and a corpus amendment to RFC-0006 §3 —
an engine change on the critical path of the last increment before the V1.0 gate. Recorded here as the
natural V1.1+ shape if aggregated findings prove too coarse in use.

Note the tension is narrower than it looks: RFC-0008:113 is about *distinct* findings that share a
cause (equity under, bonds over), whereas this is one finding whose subject is a set. Naming every
affected class in the message preserves the information fan-out would carry; what is lost is a separate
severity and a separate `finding_key` per class.

---

## 5. Consequences

- The kind becomes answerable from `targets` + `allocation` alone and no longer depends on drift being
  computable — relevant because MAJOR 6 of the same review found `allocation_absent` wrongly coupled to
  `FACT_DRIFT`, and degraded states are exactly when discovery findings matter most.
- `evaluate_strategy` must populate the `allocation` fact family for this kind to fire in a real run.
  As of this ADR it does not (review M1: `allocation`, `residual` and `bucket_value` are declared on
  `FactSet` with no producer), so the kind can currently only `SKIPPED(missing_fact)`. Wiring that
  producer — and extending `_input_digest` to cover it (review M2) — is a prerequisite for the demo
  fixture to exercise this kind.
- The demo fixture (UX-0001 §8) can now be tuned against this kind: the reduction is fixed, so the
  expected severity for its untargeted row is determined.
- **A guard the corpus does not require but this decision makes cheap:** nothing validates an authored
  rule's params against the target tree. With `asset_class` gone there is no longer anything to
  validate for this kind, which removes the authoring-time hazard rather than fixing it — the general
  problem (no cross-check between `LeafCondition.params` and the governing `StrategyVersion`) remains
  open for other kinds and is not in this ADR's scope.
