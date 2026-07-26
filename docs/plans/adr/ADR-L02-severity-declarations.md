# ADR-L02 — Severity declarations for `unassigned_residual_above`, `allocation_absent`, `bucket_below_target_value`

| | |
|---|---|
| **Status** | Accepted (build-blocker resolution) |
| **Date** | 2026-07-26 |
| **Resolves** | UX-0001 §7.2 — three V1.0 condition kinds with no declared `severity` |
| **Depends on** | RFC-0006 §11 (registry completeness test), RFC-0006 §3 / §3.1 (catalog; the no-computation boundary), RFC-0007 §3.1 (severity contract), RFC-0007 §4.1–§4.2, RFC-0008 §3 (ordering), ADR-0018 (tolerance semantics), ADR-0025 (`over_apportioned`), ADR-0029 (`unassigned_residual_above` denominator), ERR-1 (`alert.severity` column), ERR-4 (`bucket_below_target_value` facts) |
| **Blocks** | The build. RFC-0006 §11: *"A kind cannot be registered without params model, evaluator, explanation template, `required_facts`, and a `severity` declaration (a formula or an explicit `null`). Fails the build otherwise."* |
| **Overrides** | UX-0001 §7.2's assumption for `bucket_below_target_value` (see §5) |

---

## 1. Context

RFC-0007 §3.1 fixed severity as a **dimensionless breach ratio**:

```
effective_band = band                       if ABSOLUTE
                 band × effective_target    if RELATIVE
severity       = |drift| / effective_band
```

with the anchor made explicit: *"`1.0` is exactly at the band, `2.4` is 2.4× outside it"*, and the obligation made universal: *"Every `Condition` kind must emit `severity` or explicitly `null`."* RFC-0006 §11 turns that obligation into a build gate, and RFC-0008 §3 consumes it as the second clause of the one ordering contract the product has:

```
ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC
```

Formulas exist for three kinds: `drift_outside_tolerance` (RFC-0007 §3.1), `untargeted_allocation` (`current_weight / threshold_weight`, RFC-0007 §4.2) and `over_apportioned` (`deficit_quantity / holding_quantity`, ADR-0025). UX-0001 §7.2 reports that three V1.0 kinds have none, and that the registry test therefore **fails the build**:

| Kind | UX-0001 §7.2 assumed | Its own note |
|---|---|---|
| `unassigned_residual_above` | `residual_weight / threshold_weight` | *"By analogy with `untargeted_allocation`. Plausible, undeclared."* |
| `bucket_below_target_value` | `null` | *"the mock uses this deliberately, because it is the only way anything exercises `NULLS LAST`… A shortfall ratio would work equally well and would be more informative."* |
| `allocation_absent` | not exercised | *"Probably `null`, or `1.0` constant."* |

This ADR declares all three.

---

## 2. Decision Drivers

- **Dimensionlessness and one anchor.** RFC-0007 §3.1's whole argument is that a single number must be comparable *across kinds* inside a `Priority` band. That only holds if every formula means the same thing, so the anchor `severity = 1.0 at the kind's own firing threshold` is treated here as the general contract, not a `drift`-specific accident. It also lets RFC-0006 §11's severity test be stated generically instead of per kind.
- **Totality.** A kind's formula must be defined at every state in which the kind can fire — including the extreme one. A formula that divides by zero exactly where urgency peaks is worse than `null`.
- **Expressible in the step algebra** (RFC-0006 §4.1: `subtract add multiply divide_safe abs gt gte lt lte eq abs_gt ratio_to all any not`). Severity lands in `steps` and must replay (RFC-0006 §11 Replay property). There is no `max`, no `clamp`.
- **The Rule Engine computes nothing financial** (RFC-0006 §3.1). A severity formula may only read facts the kind already declares plus its own params. Deriving an `effective_band` inside a kind would move ADR-0018's `ABSOLUTE`/`RELATIVE` branching into the Rule Engine.
- **`NULLS LAST` is a real semantic, not a fallback** (RFC-0008 §3: *"a kind that cannot express its own urgency should not outrank one that can"*). Declaring `null` is a legitimate answer; declaring a constant is not.
- **`Priority` dominates.** RFC-0008 §3: the author keeps control of what matters; severity orders only *within* a band. This bounds how much cross-kind calibration a formula must achieve.
- **No fixture-driven domain decisions.** Test coverage is achieved by fixtures; a domain declaration must not be chosen in order to make one fixture exercise one SQL clause.

---

## 3. Considered Options

Per kind, the live options were:

**`unassigned_residual_above(threshold_weight)`** — facts: `residual` (ADR-0029: `threshold_weight` is relative to total portfolio value; the rule is portfolio-scoped and `scope` is removed from its params).
1. `null` — "unapportioned capital is a chore, not an emergency."
2. `residual_weight / threshold_weight` — ratio to the authored threshold; the `untargeted_allocation` shape.
3. `residual_weight` alone — the raw weight.

**`allocation_absent(asset_class, scope)`** — facts: `targets`, `allocation`.
1. `null`.
2. `1.0` constant.
3. `effective_target` — "how much target is unfulfilled".
4. `effective_target / effective_band` — the value `drift_outside_tolerance` itself produces in this exact state (RFC-0007 §4.1: *"Leaf has a target, no holding → `drift = −effective_target`, severity computed normally"*).

**`bucket_below_target_value(bucket, target: Money)`** — facts: `allocation` (ERR-4 removed the phantom `prices` fact).
1. `null` (UX-0001's assumption).
2. `shortfall_value / target_value` ∈ (0, 1] — 0 at the threshold, 1 when the bucket is empty.
3. `target_value / current_value` — 1.0 at the threshold, unbounded as the bucket empties.
4. `1 + shortfall_value / target_value`, equivalently `2 − coverage` where `coverage = current_value / target_value` — 1.0 at the threshold, 2.0 when the bucket is empty.

---

## 4. Decision Outcome

### 4.1 The three declarations

| Kind | `severity` | Anchor check |
|---|---|---|
| `unassigned_residual_above` | `residual_weight / threshold_weight` | `= 1.0` when the residual sits exactly on the authored threshold |
| `allocation_absent` | **`null`** | — |
| `bucket_below_target_value` | `1 + shortfall_value / target_value` = `2 − coverage` | `= 1.0` when bucket value equals the target |

Registration lines, with the bindings each formula requires in the trace:

```python
# unassigned_residual_above — ADR-0029: threshold_weight is relative to total portfolio value
severity = lambda b: b.ratio_to(b["residual_weight"], b["threshold_weight"])
# bindings: residual_weight, residual_value, threshold_weight, total_value, severity
# params: threshold_weight > 0 (rejected by the params model otherwise)

# allocation_absent — no magnitude of absence exists; see §4.3
severity = None
# bindings: effective_target, current_weight (= 0), severity = NULL

# bucket_below_target_value — coverage-anchored shortfall ratio; see §4.4
severity = lambda b: b.add(1, b.ratio_to(b["shortfall_value"], b["target_value"]))
# bindings: current_value, target_value, shortfall_value, coverage, severity
# params: target.amount > 0 (rejected by the params model otherwise)
```

Every formula uses only `ratio_to`, `subtract` and `add` from RFC-0006 §4.1, so all three replay mechanically, and none reads a fact its kind does not already declare. Per ERR-1, `alert.severity` is NULL for `SKIPPED` and `ERROR` outcomes regardless of the declaration — including the `bucket_below_target_value` currency mismatch that raises under I-15.

### 4.2 `unassigned_residual_above` — follow UX-0001

`severity = residual_weight / threshold_weight`. Option 2, and this **follows** UX-0001 §7.2 exactly.

It is the `untargeted_allocation` formula (RFC-0007 §4.2) applied to the sibling hygiene rule, which is what ADR-0029 asks for when it demands *"consistency between the two 'hygiene' rules"*. Both compare an observed weight against an authored threshold weight; both are dimensionless; both read 1.0 at the threshold. Option 3 is dimensioned and would rank a residual against a drift breach meaninglessly. Option 1 throws away information that genuinely exists — 12.16% unapportioned against a 10% threshold is materially less urgent than 40% against the same threshold.

The denominator is safe: `threshold_weight` is an authored param and the params model rejects `threshold_weight <= 0`, so `divide_safe` never trips and the kind never `SKIPPED`s for this reason.

**On negative residuals.** ADR-0025 makes a negative `UNASSIGNED` residual legal (a deficit). This kind fires on `residual_weight > threshold_weight` — a signed comparison — so a deficit never fires it, and the deficit case is owned by `over_apportioned`. On the persisted `NOT_FIRED` rows (RFC-0009 §3.2 / E5) the formula may therefore yield a value below 1.0 or below zero. This is inert: the ordering contract reads `FIRED` rows only, and no `abs()` is applied, deliberately — wrapping the numerator in `abs` would make a deficit report a high severity under a rule that did not fire on it, which is worse than an unused negative number in a `NOT_FIRED` trace.

*Fixture check:* UX-0001 §8.3 gives UNASSIGNED at 12.16% against a 10.00% threshold → `1.216` → **1.22**, matching §8.5 row 10 exactly. The declaration reproduces the fixture without changing it.

### 4.3 `allocation_absent` — `null`, and not `1.0`

`severity = null`. Option 1, following UX-0001 §7.2's leading guess and explicitly rejecting its alternative.

Four reasons, in order of force:

1. **There is no magnitude of absence.** The condition is binary: the targeted class is held at zero. Zero has no degrees. Every candidate magnitude is really a magnitude of *something else*.
2. **The only commensurable denominator is optional, so the formula would be partial.** Option 4 (`effective_target / effective_band`) is the right *number* — it is exactly what `drift_outside_tolerance` yields in this state — but ADR-0017 says *"a `Tolerance` may attach at any node"*, i.e. a targeted leaf need not carry one (and RFC-0007 §12.3 / UX-0001 §6.3 render interior nodes with an explicit "no band" marker). A formula undefined for some legal authorings cannot be registered as total. Option 3 (`effective_target`) is defined everywhere but is a weight in [0, 1]: it would always read below 1.0, so it could never mean "at threshold" and would rank every absence below every real breach — a dimensioned number wearing a dimensionless number's clothes.
3. **Computing the band inside the kind would break RFC-0006 §3.1.** `allocation_absent` declares `targets` and `allocation`, not `drift`. Deriving `effective_band` from `targets` means re-implementing ADR-0018's `ABSOLUTE`/`RELATIVE` branch inside the Rule Engine, which *"performs no financial computation"*. `severity` follows that same split by name in §3.1.
4. **The magnitude is not lost — it is reported by the kind that owns it.** RFC-0007 §4.1 guarantees that a targeted leaf with no holding fires `drift_outside_tolerance` with `severity = effective_target / effective_band`, and RFC-0008 §4.1 keeps correlated findings visible side by side rather than collapsed. So the pair reads: *`drift_outside_tolerance`* says how far off you are, quantified; *`allocation_absent`* says the class is missing entirely, and its urgency is expressed by the authored `Priority` — which is precisely where RFC-0008 §3 says the author's judgment belongs.

**`1.0` constant is rejected outright.** It asserts "exactly at threshold" for every instance, which is false for a kind with no threshold to be at; it carries zero ordering information while occupying the ordering key; and it would sort *above* every honestly-null kind and *below* every breach at or past 1.0 — an arbitrary position dressed as a measurement. `NULLS LAST` exists for exactly this case (RFC-0008 §3), and using it is the honest reading.

### 4.4 `bucket_below_target_value` — a formula, overriding UX-0001

`severity = 1 + shortfall_value / target_value`, equivalently `2 − coverage` with `coverage = current_value / target_value`. Option 4.

Behaviour:

| Bucket value vs target | `coverage` | `severity` |
|---|---|---|
| above target (not firing) | > 1 | < 1.00 |
| exactly at target (threshold) | 1.00 | **1.00** |
| 75% covered | 0.75 | 1.25 |
| half covered | 0.50 | 1.50 |
| **empty** | 0.00 | **2.00** |

Why this and not the alternatives:

- **Option 1 (`null`) discards information that exists.** An emergency fund at 8% of its target is not equally urgent to one at 96%, and the kind can see the difference from facts it already declares. UX-0001 §7.2 concedes this in the same sentence in which it assumes `null` — *"A shortfall ratio would work equally well and would be more informative"* — and states its actual reason as fixture coverage, not domain meaning.
- **Option 3 (`target / current`) is not total.** It is undefined at `current_value = 0`, so `divide_safe` would produce `SKIPPED(zero_denominator)` at the single most severe state the kind can observe: an empty emergency fund reported as "not evaluated". That is the ADR-0016 failure mode (silent false reassurance) reintroduced through a division.
- **Option 2 (`shortfall / target`)** is total and informative but anchors 1.0 at the *worst* case rather than at the threshold, inverting the corpus convention and making a generic registry assertion impossible.
- **Option 4 is total, monotonic, algebra-expressible, and correctly anchored.** `target_value` is an authored `Money` with `amount > 0` enforced by the params model, so the denominator never vanishes.

**Accepted cost: the firing range is bounded to [1, 2].** A maximally-empty bucket reads 2.00 while a drift breach can read 20.00, so this kind cannot out-sort a large drift breach on severity alone. That is acceptable because `Priority` dominates (RFC-0008 §3) and this kind is authored `CRITICAL` in the reference strategy (UX-0001 §8.4/§8.5), placing it above every `HIGH` drift finding regardless of severity. Severity's job here is to order shortfalls *against each other* inside that band, which [1, 2] does correctly.

*Fixture check:* UX-0001 §8.3/§8.4 give Emergency at €18,014.80 against a €24,000.00 target → `coverage = 0.750617`, `shortfall = €5,985.20`, **`severity = 1.25`**. Ordering is unchanged (it is the only `CRITICAL` row, so it still sorts first), but §8.5 row 1 must change from *null* to *1.25*.

### 4.5 Consequence for the fixture and the ordering test

UX-0001 §8.5 uses row 1's null severity as the fixture's only exercise of `NULLS LAST`, and asserts *"a fixture that does not exercise all three of these is not testing the ordering contract."* §4.4 removes that null. Resolution, in order of preference:

1. **The ordering contract gets its own test** with synthetic `alert` rows — a read-side SQL test over `mv_finding`, not the demo fixture. It is cheaper, it can cover all three clauses plus ties and nulls exhaustively, and it does not couple a domain declaration to one dataset's shape.
2. `allocation_absent` is the V1.0 kind that produces nulls in real use, so the demo fixture should acquire one `allocation_absent` firing when it is next revised. Note it cannot be produced by the current fixture without either changing a target tree (which moves the canonical Equity/Developed 40%/34%/−6pp/`severity = 3.00` example, or the deliberate 1.79 tie on the Emergency bucket) or holding a strategy-untargeted class in an empty bucket (Personal is empty, so its rules `SKIP` on `zero_portfolio_value` rather than firing). **This is fixture-authoring work, priced honestly and deferred to the fixture owner** — it must not be paid for by degrading a domain declaration.

### 4.6 A registry property this makes available

With all six V1.0 kinds anchored the same way, RFC-0006 §11's severity row can be generalized from the drift-specific *"`severity == 1` exactly at the band"* to:

> **For every registered kind declaring a formula, `severity == 1` exactly at that kind's own firing threshold, and `severity` is monotonically non-decreasing in the breach magnitude.**

That is mechanically checkable per kind and closes the gap by which a future kind could ship a formula on an arbitrary scale. One existing exception must be recorded rather than silently broken: **`over_apportioned` (ADR-0025) is declared `deficit_quantity / holding_quantity`**, which is 0 at its threshold and 1.0 at total over-apportionment — Option 2's convention. Under the generic anchor it would read `1 + deficit/holding`, and the fixture's row-9 severity would move from 0.15 to 1.15. This ADR does **not** change ADR-0025 (out of scope, and it would move a fixture number for no build-blocking reason); it flags the divergence in §6 for the product owner. Nothing breaks meanwhile, because `over_apportioned` is authored `HIGH` and `Priority` dominates — which UX-0001 §8.5 already observes in the rows 9/10 commentary.

---

## 5. Where this follows UX-0001, and where it overrides it

| Kind | UX-0001 §7.2 | This ADR | Verdict |
|---|---|---|---|
| `unassigned_residual_above` | `residual_weight / threshold_weight` | same | **Follows.** Reproduces fixture row 10 (1.22) exactly. |
| `allocation_absent` | *"probably `null`, or `1.0` constant"* | `null` | **Follows** the leading guess; explicitly rejects the `1.0` constant (§4.3). |
| `bucket_below_target_value` | `null` | `1 + shortfall/target` | **Overrides.** UX-0001's stated reason is fixture coverage of `NULLS LAST`, not domain meaning, and it names the alternative as *"more informative"*. Coverage is relocated to a dedicated ordering test (§4.5). Fixture row 1 changes from *null* to **1.25**; the row order does not change. |

---

## 6. Consequences

**Positive**

- The registry completeness test passes; the build unblocks. All six V1.0 kinds now declare a severity.
- The `1.0 = at its own threshold` anchor becomes a general, mechanically-testable property of the catalog (§4.6) rather than a `drift`-specific footnote — which is what makes RFC-0008 §3's second sort clause mean something across kinds.
- Two of the three declarations are reproducible against the existing fixture arithmetic (1.22 and 1.25), so the demo dataset validates them on day one.
- `NULLS LAST` acquires a principled owner: `allocation_absent`, a kind that genuinely cannot express urgency, rather than a kind chosen to make a SQL clause fire.
- No formula reads a fact outside its kind's declared `required_facts`, and none re-implements Strategy Engine arithmetic, so RFC-0006 §3.1's boundary is intact.

**Negative / accepted costs**

- **`bucket_below_target_value` severity is bounded to [1, 2]** and so is not calibrated in magnitude against unbounded drift severities. Mitigated by `Priority` dominance; noted as a real limit of a single scalar ordering key.
- **The demo fixture must change**: row 1's severity becomes 1.25, and `NULLS LAST` coverage moves to a dedicated ordering test. That contradicts UX-0001 §8.5's claim about what the fixture must exercise, and the replacement test must land in the same batch or the ordering contract goes briefly untested.
- **`allocation_absent` sorts last within its band**, so a wholly missing asset class is ranked below a marginal quantified breach unless the author raises its `Priority`. This is the intended reading of `NULLS LAST`, but it is a real authoring burden: the kind's documentation must tell the user that `Priority` is the only lever for it.
- **`unassigned_residual_above` can persist a negative severity on `NOT_FIRED` rows.** Harmless for ordering, but a reader of raw `alert` rows will meet it, and the `over_apportioned` explanation template already carries the negative-residual teaching burden (RFC-0011 §7).
- **One scale divergence is left standing** (`over_apportioned`, §4.6). Recorded, not repaired.

---

## 7. Open items for the product owner

1. **`over_apportioned` recalibration.** Accept `1 + deficit/holding` (uniform anchor, fixture row 9 moves 0.15 → 1.15) or accept two severity conventions in the catalog? Recommend the former, in the same batch as the fixture revision in §4.5, since it is a one-line change while the fixture is being touched anyway.
2. **Does `bucket_below_target_value` merit a tolerance param?** With a band it would collapse into the drift formula and gain an unbounded scale. Not proposed for V1.0 — an authored `Money` target with no band is what RFC-0006 §3 specifies — but it is the natural V1.1 shape if bounded severity proves limiting in use.
3. **Whether `allocation_absent` should be suppressed when `drift_outside_tolerance` fires on the same class.** RFC-0008 §4.1 says correlated findings are shown separately and never collapsed, so the answer is presumed *no*; worth confirming, since this is the corpus's clearest instance of two findings from one state and the one place where the null severity is most visibly a second opinion on an already-quantified breach.
