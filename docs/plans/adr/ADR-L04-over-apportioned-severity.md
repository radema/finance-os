# ADR-L04 — `over_apportioned` severity under the uniform anchor

| | |
|---|---|
| **Status** | Accepted (V1.0 opening batch) |
| **Date** | 2026-07-28 |
| **Resolves** | HANDOFF-2026-07-26 §2.5 open point **O3** — `over_apportioned` (ADR-0025) uses the opposite severity convention to every other kind |
| **Depends on** | ADR-L02 (the uniform anchor and its generalized registry test), RFC-0006 §3 / §3.1 (catalog; the no-computation boundary), RFC-0006 §4 / §4.1 (facts; the 15-op algebra; totality), RFC-0006 §11 (registry completeness and the severity row), RFC-0007 §3.1 (severity contract), RFC-0008 §3 (ordering), RFC-0009 §4.1 (the trace shows the intermediate computation), RFC-0011 ADR-0025 (`over_apportioned`, I-9 as an evaluation-time finding), RFC-0011 ADR-0029 (hygiene-rule consistency), ERR-1 (`alert.severity` nullable), RFC-0012 ERR-14 (per-asset binding namespace), UX-0001 §7.2 / §8 |
| **Blocks** | The first V1.0 rule to ship. HANDOFF §4.1 item 2: O3 must be resolved *"before any V1.0 rule ships with the inconsistent anchor"*, because the anchor is what makes RFC-0008 §3's second sort clause mean the same thing in every row of one findings list |
| **Overrides** | RFC-0011 ADR-0025's severity clause (`deficit_quantity / holding_quantity`) — see §5. Supersedes ADR-L02 §4.6's closing paragraph and ADR-L02 §7 item 1 |

---

## 1. Context

ADR-L02 closed the build-blocking gap in UX-0001 §7.2 and, in doing so, promoted RFC-0007 §3.1's
drift-specific anchor into a general property of the catalog (ADR-L02 §4.6):

> **For every registered kind declaring a formula, `severity == 1` exactly at that kind's own firing
> threshold, and `severity` is monotonically non-decreasing in the breach magnitude.**

Five of the six V1.0 kinds satisfy it. One does not. RFC-0011 ADR-0025, introducing
`over_apportioned(scope)`, declares in a single incidental clause:

> `severity = deficit_quantity / holding_quantity` (holding of the affected Asset)

which reads **0 at the firing threshold** and grows without bound — the inverted convention. ADR-L02
recorded the divergence rather than repairing it, on the reasoning that it was out of scope and would
move a fixture number for no build-blocking reason, and referred it to the product owner as §7 item 1.
The handoff carried it forward as **O3**, deferred to the V1.0 opening batch, *"flagged because it
changes a fixture number."*

Wave 2 is that batch. Two things have changed since ADR-L02 was written, and both bear on the answer:

1. **The engines exist.** The recorder's zero-denominator behaviour is no longer a specification claim
   but implemented code: `TraceRecorder._step` appends the null-valued step and then raises
   `SkipSignal(SkipReason.ZERO_DENOMINATOR)`
   (`src/financeos/core/engines/rule_engine.py:458-470`), and `replay_trace` reconstructs
   `SKIPPED(zero_denominator)` from that evidence alone (`rule_engine.py:822-828`). A division by zero
   inside a severity computation therefore does not yield a null severity on a `FIRED` row — it
   **discards the entire finding**, replacing it with a `SKIPPED` row that surfaces only in the run
   health panel. That is a materially worse outcome than ADR-L02 could have assumed when it wrote
   "worse than `null`" of a partial formula (ADR-L02 §2).
2. **`replay_trace` requires the final step to be boolean** (`rule_engine.py:836-839`). Any severity
   arithmetic must therefore be recorded *before* the predicate step, which constrains the shape of the
   step sequence and is not something either ADR-L02's registration sketches or the corpus anticipated.

So O3 is not the one-line recalibration ADR-L02 predicted. `1 + deficit/holding` fixes the anchor and
leaves a hole at the state the kind exists to report: the position was sold out entirely, the
apportionment still stands, and `holding_quantity` is zero.

---

## 2. Decision Drivers

- **One anchor, or the ordering clause is a lie.** RFC-0008 §3 sorts `severity DESC` inside a `Priority`
  band. `over_apportioned` is authored `HIGH` (ADR-0025) and so lands in the same band as every drift
  finding. Under the current declaration a total over-commitment of a position reads `0.15` and sorts
  *below* a marginal 1.05 drift breach. That is not a calibration quibble; it is the sort key inverting.
- **Totality over fidelity to a passing mention** (RFC-0006 §4.1: every operation is total; the handoff
  records `divide_safe`/`ratio_to` being repaired for exactly this reason). A formula that is undefined
  at its own worst state is not a formula. This is the driver ADR-L02 §4.4 used to reject
  `target_value / current_value` for `bucket_below_target_value`, and it applies here identically.
- **Expressible in the existing 15-op algebra** (RFC-0006 §4.1: `subtract add multiply divide_safe abs
  gt gte lt lte eq abs_gt ratio_to all any not`). There is no `max`, no `clamp`, no conditional select,
  and *"additions to this list require an ADR; the list growing is the signal that a general expression
  language is being reinvented by accident."* This ADR adds no operation.
- **Expressible without a fabricated constant.** Every binding carries a `SourceRef`
  (`rule_engine.py:346-360`), which the provenance bar renders (UX-0001 §4.3). A literal `1` has no
  source, so binding one would put an unsourced value into a provenance artifact. Formulas are therefore
  written in a literal-free form.
- **The Rule Engine computes nothing financial** (RFC-0006 §3.1). The kind may read facts it declares and
  its own params, and may record derivations of them as steps — the C-2 precedent (handoff §3.6), where
  `drift` is recomputed as an explicit step so the intermediate computation is visible in the trace, as
  RFC-0009 §4.1's own example requires. It may not resolve apportionment or fold holdings.
- **I-9 is per Asset** (RFC-0000 §6 invariant registry, ADR-0025): *for each Asset at any `as_of`, Σ apportioned ≤
  Holding*. A surplus on one asset must never mask a deficit on another, so the *predicate* is
  irreducibly per-asset even if the severity is not.
- **`severity = None` is legal and sometimes correct** (ERR-1; handoff §3.6 C-8), but it is an admission
  that no magnitude exists — never a way to paper over a denominator that vanished (ADR-L02 §4.3's
  argument against the `1.0` constant, applied in the other direction).
- **No fixture-driven domain decisions** (ADR-L02 §2). The fixture follows the declaration.

---

## 3. Considered Options

`over_apportioned(scope)` — facts: per-asset `(Σ apportioned quantity, holding quantity)` at `as_of`.
Write `A` for Σ apportioned and `H` for the holding of one asset; the kind fires when `A > H` for any
asset in scope. `deficit = A − H`.

1. **Documented exception.** Keep `deficit / H` verbatim, and scope ADR-L02 §4.6's generalized registry
   property to exclude this kind.
2. **Naive re-anchor.** `1 + deficit / H` — O3's own prediction, fixture row 9 moving `0.15 → 1.15`.
3. **Coverage-anchored, aggregated over the affected assets.**
   `1 + Σdeficit / ΣA` = `2 − coverage`, where `coverage = ΣH / ΣA` over the assets that are actually
   over-apportioned. Fixture row 9 moves `0.15 → 1.13`.
4. **`severity = null`** for the kind, ceding the ordering position to `NULLS LAST`.
5. **Add `max` to the algebra** and take the worst affected asset's `1 + deficit / H`.

---

## 4. Decision Outcome

### 4.1 The declaration

**Option 3.** `over_apportioned` comes onto ADR-L02's uniform anchor, and it does so with a denominator
that cannot vanish:

| | |
|---|---|
| **Kind** | `over_apportioned(scope)`, `kind_version: 1` |
| **`severity`** | `1 + Σ deficit_quantity / Σ apportioned_quantity` over the affected assets, equivalently `2 − coverage` with `coverage = Σ holding_quantity / Σ apportioned_quantity` |
| **Affected assets** | those with `apportioned_quantity > holding_quantity` at `as_of` |
| **Range on the firing set** | `(1, 2]` |
| **Anchor** | `= 1.00000000` exactly at `Σ apportioned = Σ holding`, the boundary of the firing set |
| **Worst case** | `= 2.00000000` exactly when the affected positions are held at zero |
| **Declared as** | `SeverityDeclaration(formula="1 + Σ deficit / Σ apportioned  (=  2 − coverage)")` |

Worked points, at the `DECIMAL(19,8)` severity scale (`SEVERITY_PRECISION = 19`, `SEVERITY_SCALE = 8`,
`ROUND_HALF_UP` — `core/shared/numbers.py:38-46, 110-113`), with the two-decimal form UX-0001 §8.5
displays:

| State | `ΣA` | `ΣH` | `coverage` | `severity` (stored) | shown |
|---|---|---|---|---|---|
| **At the threshold** (does not fire) | 53 | 53 | `1.00000000` | **`1.00000000`** | 1.00 |
| Mild — 5% of committed units not owned | 100 | 95 | `0.95000000` | `1.05000000` | 1.05 |
| **The fixture** — `IE00B3RBWM25`, 53 committed against 46 held | 53 | 46 | `0.86792453` | **`1.13207547`** | **1.13** |
| **Worst case** — position sold out, apportionment standing | 53 | 0 | `0.00000000` | **`2.00000000`** | 2.00 |

The threshold row is the anchor check, and it is checked at the *boundary* rather than inside the firing
set, exactly as `drift_outside_tolerance` is: `abs_gt` is strict, so `|drift| = effective_band` yields
`severity = 1.00` on a row that does not fire (`rule_engine.py:608-612`). `gt` here is strict for the
same reason, and the anchor means the same thing in both kinds — which is the whole point of having one.

For comparison, the two rejected numerators at the fixture's state: ADR-0025 verbatim gives
`7 / 46 = 0.15217391` → **0.15** (the number UX-0001 §8.5 currently carries), and Option 2 gives
`1 + 7 / 46 = 1.15217391` → **1.15** (O3's prediction). §4.2 says why neither is taken.

### 4.2 Why not ADR-0025's denominator

Option 2 is the minimal-diff answer and the one O3 anticipated. It is rejected on totality.

`H = 0` with `A > 0` is a **firing state**, it is the kind's **most severe** state, and it is the
**most likely** way a large deficit is created: a full exit from a position. ADR-0025's own consequences
paragraph describes precisely this path — *"a user who never opens the app after selling carries an
over-committed apportionment until the next evaluate"* — and I-9 is a per-Asset inequality with no lower
bound on `Holding`, so nothing in the corpus keeps `H` away from zero.

At `H = 0`, `1 + deficit / H` is undefined, and the implemented consequence is not a null severity. The
recorder appends the null-valued step and raises `SkipSignal(ZERO_DENOMINATOR)`
(`rule_engine.py:466-468`); `_evaluate_rule` records `SKIPPED(zero_denominator)`; the finding vanishes
from `mv_finding` and appears only in the run health panel. **The one state in which the system most
needs to say "you have committed units you no longer own" is the one state in which it would say "not
evaluated".** That is ADR-0016's inverted-silence failure mode, reintroduced through a division, and it
is verbatim the ground on which ADR-L02 §4.4 rejected `target_value / current_value`.

Three repairs were considered and rejected:

- **Emit `severity = None` at `H = 0` and skip the severity steps.** This requires the evaluator to
  branch on a comparison it did not record, or to record an extra `eq` step whose only purpose is to
  gate arithmetic. It is buildable, but it *loses the measurement at peak urgency* — the finding would
  fire with no severity and sort last within `HIGH` under `NULLS LAST`, below every marginal drift
  breach. `None` is the honest answer where no magnitude exists (§4.3); it is not an honest answer where
  a magnitude plainly exists and only this denominator cannot see it.
- **Clamp or floor the denominator.** Not expressible (no `max`), and a floored denominator is a
  fabricated number wearing a measurement's clothes.
- **Option 5, add `max` and take the worst asset.** It does not help: the worst asset's `1 + deficit/H`
  has the same hole at `H = 0`. It also spends RFC-0006 §4.1's explicit warning about algebra growth on
  a change that does not fix the defect.

`Σ apportioned` over the affected assets is **strictly positive whenever the kind fires**, by
construction of the fact family (§4.4): a line exists only for an asset carrying committed units at
`as_of`, so `A > 0` for every candidate, hence `ΣA > 0` for any non-empty affected set. The formula is
total on the whole firing set with no guard, no branch, and no extra step.

The reading is also the more truthful one. `deficit / H` asks *"by what multiple of what I still own am I
over-committed?"* — a quantity that inflates without bound as the holding shrinks and is undefined when
it disappears. `2 − ΣH/ΣA` asks *"of the units I have promised to Buckets in the over-committed
positions, what fraction do I not own?"* — the question the Buckets screen is actually about, bounded by
the arithmetic rather than by fiat, and reading 2.00 at *"I own none of what I promised"*, which is
genuinely the worst thing this kind can report.

Options 1 and 4 are rejected briefly. Option 1 keeps a sort key that inverts inside the `HIGH` band and
forces RFC-0006 §11's severity row to become per-kind again, reopening the hole ADR-L02 §4.6 closed — a
future kind could then ship a formula on any scale at all. Option 4 throws away information the kind can
see from facts it already declares: 3 units over-committed out of 300 is not equally urgent to 53 out of
53, and ADR-L02 §4.3's test for a legitimate `null` — *"there is no magnitude of absence"* — is plainly
not met, because there is a magnitude and it is measured in units.

### 4.3 Totality, point by point

| Point | Behaviour | Why it is correct |
|---|---|---|
| **Zero denominator** | Unreachable on the firing set. `ΣA > 0` for any non-empty affected set, by the fact-family contract in §4.4. | The `divide_safe`/`ratio_to` skip path (RFC-0006 §4.1, `rule_engine.py:150-152`) stays available for genuine cases and is never spent on this kind's worst state. |
| **Empty holding** (`A > 0`, `H = 0`) | Fires. `coverage = 0`, `severity = 2.00000000`. | Measured, not skipped. This is the bound, and it is a real observation rather than a chosen constant. |
| **Empty affected set** (no asset over-apportioned) | `NOT_FIRED`, `severity = None`. | A legitimate `None` (ERR-1): there is no affected set, so there is no coverage to measure. This is *cleaner* than `unassigned_residual_above`, which ADR-L02 §4.2 accepts will persist a negative severity on `NOT_FIRED` rows. |
| **Nothing apportioned anywhere in scope** | The fact family is empty → no candidate → `NOT_FIRED`, `severity = None`. | Not an error: an un-apportioned portfolio is the onboarding state, and `unassigned_residual_above` is the kind that owns it (RFC-0006 §3). |
| **Apportionment unresolvable** (the fact family cannot be built at `as_of`) | `SKIPPED(missing_fact)` via `unavailable={"apportionment": …}`, `severity = None` per ERR-1. | The handoff's W1c wiring rule: *"Never invent a partial denominator."* |
| **The ADR-0025 "worst case" bound** | Under this declaration the bound is real: `severity ≤ 2.00000000` for every legal state. | See below. |
| **Negative holding** (`H < 0`, outside the legal domain) | Total. `coverage < 0`, so `severity > 2`. | Degrades in the right direction rather than breaking. A negative fold is a Portfolio-Engine data defect, not a bucket-assignment finding, and this kind does not pretend to own it. An asset with `A = 0` and `H < 0` is *not* a candidate (§4.4), so it can never be the sole member of the affected set. |

**On ADR-L02 §4.6's "worst case".** ADR-L02 describes ADR-0025's formula as *"0 at its threshold and 1.0
at total over-apportionment"*. That characterisation is wrong, and the error matters: `deficit / H = 1.0`
holds when `A = 2H`, which is not a bound on anything — the formula is unbounded above and undefined at
`H = 0`. ADR-0025 states no worst-case bound of its own. Recorded as **D7** in §5.1; ADR-L02's
*decisions* are unaffected.

`severity = None` is legal on this kind in exactly three places, and nowhere else: on `SKIPPED` and
`ERROR` rows (ERR-1, unconditionally), and on `NOT_FIRED` rows where the affected set is empty. It is
**not** available as a substitute for a vanished denominator — that is why Option 2 is rejected outright
rather than patched.

### 4.4 The step sequence

The fact family, declared here because no corpus document declares it (**D5**, §5.1):

```python
FACT_APPORTIONMENT: Final = "apportionment"

class ApportionmentLine(DomainModel):          # core/portfolio, a derived read model
    asset_id: AssetId
    apportioned_quantity: QuantityAmount       # Σ bucket_apportionment resolved at as_of (ADR-0025)
    holding_quantity: QuantityAmount           # the Holding fold at as_of

# on FactSet:
apportionment: Mapping[AssetId, Bound[ApportionmentLine]] = Field(default_factory=dict)
```

**Contract on the fact family, and the reason the denominator is safe:** the Portfolio Engine emits one
line per asset that carries committed units at `as_of` — `apportioned_quantity > 0`. An asset with no
apportionment, or whose resolved apportionment sums to zero, has no line, exactly as an untargeted class
has no `drift` fact. This is a fact-construction rule, not a Rule-Engine computation, so RFC-0006 §3.1's
boundary is intact; and it is what guarantees `A > 0` for every candidate without a step.

Steps, in recorded order, for a scope containing assets `a₁…aₙ` (deterministic asset order — RFC-0006 §10
canonicalization):

```
bindings   apportioned:{aᵢ}          A_i        source = apportionment fact, path-narrowed
           holding:{aᵢ}              H_i        source = apportionment fact, path-narrowed

# phase 1 — the per-asset predicate. I-9 is per Asset: a surplus on one asset must not
#           mask a deficit on another, so this may NOT be done on the sums.
 1..n      gt        over:{aᵢ}                 apportioned:{aᵢ},  holding:{aᵢ}

# phase 2 — severity, over S = { aᵢ : over:{aᵢ} }. Emitted only when S is non-empty.
#           `add` is variadic; S is read from recorded step results, so the trace shows
#           exactly which assets entered the aggregate.
 n+1       add       apportioned_committed     apportioned:{aⱼ} for aⱼ ∈ S
 n+2       add       held_of_committed         holding:{aⱼ}     for aⱼ ∈ S
 n+3       subtract  deficit_committed         apportioned_committed, held_of_committed
 n+4       add       apportioned_doubled       apportioned_committed, apportioned_committed
 n+5       subtract  severity_numerator        apportioned_doubled, held_of_committed
 n+6       ratio_to  severity                  severity_numerator, apportioned_committed

# phase 3 — the final step must yield a boolean (rule_engine.py:836)
 n+7       any       fired                     over:{a₁} … over:{aₙ}
```

Six operations, all from RFC-0006 §4.1, no literal bound anywhere: `apportioned_doubled` is
`add(A, A)`, which is why the `2 − coverage` form needs no constant `2` and the `1 +` form needs no
constant `1`. `severity_numerator / apportioned_committed = (2ΣA − ΣH) / ΣA = 2 − coverage`, and
`deficit_committed` is recorded as its own step because it is the number the explanation and the
Buckets screen quote — the RFC-0009 §4.1 / C-2 pattern of making the intermediate computation visible
rather than deriving it at render time.

Fixture trace, `run:0f31a9c4`, portfolio scope (one asset affected):

```
apportioned:IE00B3RBWM25 = 53.0000000000    holding:IE00B3RBWM25 = 46.0000000000
over:IE00B3RBWM25         = true
apportioned_committed     = 53.0000000000
held_of_committed         = 46.0000000000
deficit_committed         =  7.0000000000
apportioned_doubled       = 106.0000000000
severity_numerator        =  60.0000000000
severity                  = 1.13207547
fired                     = true
```

Replay: every step is `apply_op`-pure over recorded values, the final step is boolean, no step yields
`None`, and no step reads a source — so the trace replays to `FIRED` under `replay_trace` with every
`SourceRef` poisoned, which is the property test's blinding contract (handoff §1).

### 4.5 Why severity aggregates, and what that costs

The kind's params are `(scope)` — ADR-0025 gives it no `asset` — and `finding_key` hashes
`rule_id ‖ scope ‖ params` (ADR-0027). One rule therefore yields exactly one finding per scope per run,
so a scope with three over-apportioned assets must produce **one** severity. Something has to reduce.

`max` over the affected assets would be the sharpest reduction and is not expressible: the algebra has no
`max`, and RFC-0006 §4.1 makes adding one an ADR with an explicit warning attached. The sum is
expressible with `add`, which is variadic.

**Accepted cost: the aggregate is not monotonic under changes of the affected set.** One asset at
`A = 10, H = 0` reads `2.00`; add a second at `A = 100, H = 99` — a strictly worse portfolio state — and
the aggregate reads `1.10`. Every scope-level aggregate has this property (`Σdeficit / ΣH` has it too),
because a single scalar cannot carry both "how bad is the worst one" and "how much is affected in
total". The property this ADR claims, and the one RFC-0006 §11's severity row should test, is therefore
stated precisely:

> For a **fixed** affected set, `severity` is non-decreasing in each asset's deficit, equals
> `1.00000000` in the limit as every deficit reaches zero, and is bounded above by `2.00000000` on the
> legal domain.

The same precision is owed to ADR-L02 §4.6's general property, which quantifies over "the breach
magnitude" without saying over which states: it holds over **`FIRED` states**. `unassigned_residual_above`
persists severities below zero on `NOT_FIRED` rows by deliberate design (ADR-L02 §4.2), which is only
consistent with the property under that quantification. Recorded as **D7** alongside the worst-case
error; no ADR-L02 decision changes.

One secondary benefit of aggregating: the two operands of the severity ratio are **scope-level**
quantities. No `AssetId`-keyed binding enters the severity computation, so the number itself is
instrument-free. That narrows — though it does not eliminate — the RFC-0012 ERR-14 exposure recorded as
**D9** in §5.1.

### 4.6 Consequence for the fixture and the ordering test

Precisely these UX-0001 §8 numbers change, and nothing else:

| Location | Before | After |
|---|---|---|
| §8.5 row 9, `Severity` column | `0.15` | **`1.13`** (stored `1.13207547`) |
| §8.5 row order, positions 8 and 9 | 8 = `drift_outside_tolerance` GOV_EUR · Pension (1.05); 9 = `over_apportioned` · portfolio (0.15) | **8 = `over_apportioned` · portfolio (1.13); 9 = `drift_outside_tolerance` GOV_EUR · Pension (1.05)** |

Unchanged: §8.1 (prices and folds), §8.2 (the 53 / 46 / **−7** apportionment row that produces the
finding), §8.3 (derived totals), §8.4 (both strategies), §8.5's outcome counts (10 / 9 / 8 / 1), and rows
1–7 and 10 of the ordered table. Row 1 already moved from *null* to `1.25` under ADR-L02 §4.4 and moves
no further. The resulting order is:

```
 1  CRITICAL  1.25  bucket_below_target_value · Emergency
 2  HIGH      3.00  drift_outside_tolerance EQ/DEV · Pension       ← canonical, untouched
 3  HIGH      2.52  untargeted_allocation · Pension
 4  HIGH      1.79  drift_outside_tolerance CASH · Emergency  rule:3d02
 5  HIGH      1.79  drift_outside_tolerance GOV_EUR · Emergency  rule:6b7f
 6  HIGH      1.53  drift_outside_tolerance EQ/DEV · Children
 7  HIGH      1.24  untargeted_allocation · Children
 8  HIGH      1.13  over_apportioned · portfolio                   ← was row 9 at 0.15
 9  HIGH      1.05  drift_outside_tolerance GOV_EUR · Pension      ← was row 8
10  MEDIUM    1.22  unassigned_residual_above · portfolio
```

**All three `ORDER BY` clauses stay exercised** (`priority_rank DESC, severity DESC NULLS LAST,
rule_id ASC`), and §8.5's own commentary survives verbatim under the new numbering:

- `priority_rank DESC` — row 1 still sorts first on band alone, and row 10 (MEDIUM, 1.22) still
  outranks row 9 (HIGH, 1.05) on severity while still sorting below it. §8.5's sentence *"Row 10
  outranks row 9 on severity and still sorts below it, because the authored priority band dominates"*
  remains literally true of the new row 9.
- `severity DESC` — exercised across rows 2–9.
- `rule_id ASC` — the deliberate 1.79 tie at rows 4 and 5 is untouched.

**`NULLS LAST` coverage is unaffected by this ADR and remains mandatory as a separate test.** ADR-L02
§4.5 already relocated it to a dedicated read-side ordering test over `mv_finding` with synthetic `alert`
rows, and handoff §3.3 records that as mandatory rather than optional. This ADR does not disturb the
relocation, and it removes the last chance of it drifting back: after ADR-L02 and ADR-L04, **no V1.0 kind
that fires in the fixture declares a null severity**, and the only kind that declares one —
`allocation_absent` — still cannot be made to fire in this fixture without disturbing either the
canonical 40/34/−6pp example or the 1.79 tie.

Two additions the dedicated ordering test now owes, both because the fixture's margins thinned:

1. **Priority dominance with a narrow severity margin.** The fixture used to demonstrate it with a gap of
   1.07 (MEDIUM 1.22 above HIGH 0.15); it now demonstrates it with 0.17 (MEDIUM 1.22 above HIGH 1.05).
   The demonstration is still valid, but the synthetic test must assert it robustly — including the
   adjacent case where a lower band's severity exceeds a higher band's by an arbitrarily small margin.
2. **A null severity ordering *against* a value in `(1, 2]`.** Every V1.0 formula now emits at or above
   1.00, so a synthetic null must be shown sorting below a 1.00 — the tightest case, not just below a
   3.00.

### 4.7 The V1.0 severity set, audited against the uniform anchor

All six V1.0 kinds (RFC-0010 §3, *V1.0* increment, Rules row), each checked for anchor, totality, algebra expressibility and
fixture agreement. Two verdicts are findings rather than confirmations.

| Kind | Declaration | Anchor at its own threshold | Total? | Verdict |
|---|---|---|---|---|
| `drift_outside_tolerance` | `\|drift\| / effective_band` (RFC-0007 §3.1) | `1.00` at `\|drift\| = effective_band` | Yes, with C-8: `severity = None` when `effective_band = 0` | **Confirmed** (reference kind; declared in code, `rule_engine.py:643`) |
| `over_apportioned` | `1 + Σdeficit / Σapportioned` | `1.00` at `ΣA = ΣH` | Yes | **Declared here** (§4.1) |
| `unassigned_residual_above` | `residual_weight / threshold_weight` (ADR-L02 §4.2) | `1.00` at the authored threshold | Yes — the params model rejects `threshold_weight <= 0` | **Confirmed** |
| `untargeted_allocation` | `current_weight / threshold_weight` (RFC-0007 §4.2) | `1.00` at the authored threshold | **Only with a params guard the corpus never states** | **Confirmed with a finding** — see below |
| `bucket_below_target_value` | `1 + shortfall_value / target_value` = `2 − coverage` (ADR-L02 §4.4) | `1.00` at bucket value = target | Yes — the params model rejects `target.amount <= 0` | **Confirmed; its registration sketch is not expressible** — see below |
| `allocation_absent` | `null` (ADR-L02 §4.3) | n/a — declines to measure | n/a | **Confirmed** |

**`untargeted_allocation` — confirmed, with a finding (D6).** The formula is right and the fixture proves
it twice. §8.1/§8.2 give Pension 44 units of `IE00B3RBWM25` at 154.6364 = €6,804.0016 of €54,000.00 →
`current_weight = 0.12600003`, and Children 9 units = €1,391.7276 of €22,488.98 →
`current_weight = 0.06188487`. Against an authored `threshold_weight` of 5.00% those give `2.52000060`
→ **2.52** (§8.5 row 3) and `1.23769740` → **1.24** (row 7), reproducing both fixture rows and
recovering the threshold the fixture never states. But RFC-0007 §4.2 states no bound on `threshold_weight`,
and at `threshold_weight = 0` the ratio takes the `zero_denominator` skip path at the exact state where
any untargeted capital exists — while the predicate `current_weight > 0` would fire on every dust
position. ADR-L02 §4.2 states the `threshold_weight > 0` guard for `unassigned_residual_above` only.
**The same guard is required on `untargeted_allocation`'s params model, and no corpus document says so.**
Recorded as D6; reported, not patched into ADR-L02.

**`bucket_below_target_value` — decision confirmed, registration sketch not expressible (D8).** The
formula, the anchor and the fixture all hold: €18,014.80 against a €24,000.00 target gives
`coverage = 0.75061667` and `severity = 1.24938333` → **1.25** (§8.5 row 1), and ADR-L04 adopts the
identical `2 − coverage` shape, which is the strongest available coherence argument for §4.1. But
ADR-L02 §4.4's registration line `b.add(1, b.ratio_to(b["shortfall_value"], b["target_value"]))` cannot
be written: `TraceRecorder.add(out, *names)` takes **bound names**, not values
(`rule_engine.py:376-378`), and the literal `1` has no `SourceRef` to bind under
(`rule_engine.py:346-360`). The kind must use the literal-free form —
`add(target_doubled, target_value, target_value)`, `subtract(numerator, target_doubled, current_value)`,
`ratio_to(severity, numerator, target_value)` — which yields `(48,000.00 − 18,014.80) / 24,000.00 =
1.24938333`, the same number. Recorded as D8. ADR-L02's *decision* stands unchanged; only its sketch is
wrong, and this ADR does not edit it.

**`allocation_absent` — confirmed.** ADR-L02 §4.3's four reasons hold, and ADR-L04 strengthens the third
one: `effective_band` is optional per ADR-0017, so Option 4 would be partial, and this ADR has just
rejected a partial formula on precisely that ground for a different kind. `allocation_absent` remains the
sole owner of `NULLS LAST` among V1.0 kinds, which is why §4.6's synthetic ordering test is permanent.

**`unassigned_residual_above` — confirmed.** 12.16% against a 10.00% threshold gives `1.2160` → **1.22**
(§8.5 row 10). The deliberate absence of `abs()` on the numerator, and the negative severities it leaves
on `NOT_FIRED` rows, are consistent with the general property once that property is quantified over
`FIRED` states (§4.5).

---

## 5. Where this follows the corpus, and where it diverges

| Subject | Corpus | This ADR | Verdict |
|---|---|---|---|
| The kind, its scope, priority and suggestion class | ADR-0025: `over_apportioned(scope)`, `HIGH`, `REVIEW_BUCKET_ASSIGNMENT`, V1.0 | unchanged | **Follows.** |
| The firing predicate | ADR-0025: fires when any Asset in scope has Σ apportionment > Holding | unchanged, and kept strictly per-asset | **Follows** — the aggregate is severity only. |
| The severity numerator | ADR-0025: `deficit_quantity` | `Σ deficit_quantity` over the affected assets | **Follows** in kind; aggregated because the kind has no `asset` param (§4.5). |
| The severity denominator and anchor | ADR-0025: `holding_quantity`, giving 0 at threshold | `Σ apportioned_quantity`, giving `1.00` at threshold | **Diverges.** See below. |
| The severity anchor as a general contract | RFC-0007 §3.1: *"`1.0` is exactly at the band"*; RFC-0006 §11's severity row; ADR-L02 §4.6 | applied to this kind | **Follows** — this ADR is what makes the generalized property true of the whole V1.0 catalog. |
| Fixture row 9 | UX-0001 §8.5: `0.15`, position 9 | `1.13`, position 8 | **Overrides**, in the manner UX-0001 §1 permits: the mock is illustrative (P7) and its severity column is derived, not authored. |

**On the divergence, and on precedence.** RFC-0000 and RFC-0011 §1 give RFC-0011 the win over
RFC-0004–0010, so ADR-0025's formula beats RFC-0007 §3.1's anchor on a straight reading of precedence.
This ADR does not rely on reading it the other way. It diverges on two grounds that precedence does not
reach:

1. **Totality is not a matter of precedence.** RFC-0006 §4.1 requires every operation to be total, and a
   severity formula undefined at a firing state fails that requirement no matter which document states
   it. The corpus has already been repaired once in this exact direction — `divide_safe`/`ratio_to` were
   fixed for raising on a large ratio, in violation of §4.1 (handoff §1) — and this is the same defect
   one level up.
2. **ADR-0025 does not decide the anchor; it mentions a formula in passing.** Its Context, Drivers,
   Options and Outcome are entirely about `VirtualHolding` and where I-9 is enforced. The severity clause
   is a sub-bullet, undefended, with no worst-case bound and no reference to RFC-0007 §3.1. RFC-0011's
   own ADR-0029, one page later, lists *"consistency between the two 'hygiene' rules"* among its decision
   drivers and names `over_apportioned` as the third member of that family — so RFC-0011 argues for the
   consistency this ADR delivers and against it only by inadvertence.

Nothing in `docs/seed/` is edited. The divergence and the four defects below are recorded additively per
RFC-0000 §10.3, extending handoff §3.1's D1–D4.

### 5.1 Defects recorded additively (RFC-0000 §10.3)

| # | Defect | Correction |
|---|---|---|
| **D5** | **`over_apportioned` has no catalog row and no fact.** RFC-0006 §3's catalog table omits the kind (RFC-0000 §4's corrections cross-reference acknowledges ADR-0025 as adding it, but the table was never amended), and RFC-0006 §4's `FactSet` has no apportionment member — `per_asset: Mapping[AssetId, Bound[Quantity]]` is documented as *"concentration only"* and carries no holding to compare against. So the one V1.0 kind RFC-0011 adds is the one kind whose input contract nothing declares. | Declared in §4.4: fact family `apportionment`, `ApportionmentLine(asset_id, apportioned_quantity, holding_quantity)`, `required_facts = {"apportionment"}`, `default_max_staleness = None` (both operands are authored/derived, not observed — ERR-10). |
| **D6** | **`untargeted_allocation` has no `threshold_weight` guard.** RFC-0007 §4.2 gives the formula `current_weight / threshold_weight` and bounds nothing. At `threshold_weight = 0` the kind takes the `zero_denominator` skip path exactly when untargeted capital exists, and its predicate degenerates. | The params model must reject `threshold_weight <= 0`, as ADR-L02 §4.2 requires for `unassigned_residual_above`. Reported here; **ADR-L02 is not edited.** |
| **D7** | **ADR-L02 §4.6 mis-describes ADR-0025's formula** as *"1.0 at total over-apportionment"*. `deficit / holding = 1.0` at `Σ apportioned = 2 × holding`, which bounds nothing; the formula is unbounded above and undefined at `holding = 0`. Relatedly, §4.6's generalized property does not say over which states monotonicity is claimed, and it is only true over `FIRED` states (§4.5). | Both restated precisely in §4.3 and §4.5. ADR-L02's decisions are unaffected; its §4.6 closing paragraph and §7 item 1 are **superseded** by this ADR. |
| **D8** | **ADR-L02 §4.4's registration sketch is not expressible.** `b.add(1, b.ratio_to(…))` presumes `add` takes values; `TraceRecorder.add(out, *names)` takes bound names, and a literal has no `SourceRef` to bind under. | The literal-free form is given in §4.7. Same number, same decision. |
| **D9** | **RFC-0012 ERR-14's reflection test would fail `over_apportioned`.** ERR-14 restates the binding-namespace guarantee as *"No kind that binds an `AssetId` may also bind a direction, a quantity, a price target…"*, enforced as a registry reflection test. `over_apportioned` binds `AssetId`-keyed **quantities** by necessity — RFC-0011 ADR-0025 defines its severity in terms of *"holding of the affected Asset"*. ERR-14's own list of per-asset kinds names only `concentration_above` *"and any future `asset_metric_*` kind"*, overlooking a V1.0 kind already in the catalog. | RFC-0011 wins (RFC-0000; RFC-0011 §1), so the kind is legal as declared. When ERR-14's reflection test is implemented it must forbid **prescriptive** quantities (a quantity to transact) rather than descriptive ones, and `over_apportioned` must be added to ERR-14's per-asset list. Its `suggestion_class` is `REVIEW_BUCKET_ASSIGNMENT`, already inside ERR-14's own allowlist, so the kind sits on the right side of ERR-14's intent and the wrong side of its literal name test only. §4.5 narrows the exposure: the severity operands are scope-level, so the number itself is instrument-free. |

---

## 6. Consequences

### 6.1 What the implementer must change, file by file

Nothing here is speculative; each row has a check that fails today and passes after.

| File | Change | Test before accepting |
|---|---|---|
| `src/financeos/core/portfolio/` (new read model, beside the existing derived models) | `ApportionmentLine(asset_id, apportioned_quantity, holding_quantity)`; `portfolio_engine.compute_apportionment(apportionments, holdings, *, as_of, scope)` resolving `bucket_apportionment` supersession chains at `as_of` per ADR-0025 and **emitting no line where `apportioned_quantity == 0`**. | A property test: every emitted line has `apportioned_quantity > 0`. This one assertion is what makes §4.1's denominator safe; if it is dropped, the formula stops being total. |
| `src/financeos/core/engines/rule_engine.py` | `FACT_APPORTIONMENT = "apportionment"`; `FactSet.apportionment` + an `apportionment_lines()` accessor; `OverApportionedParams(scope)`; `evaluate_over_apportioned` with the §4.4 step sequence; registration with `SeverityDeclaration(formula="1 + Σ deficit / Σ apportioned  (=  2 − coverage)")`, `required_facts=frozenset({FACT_APPORTIONMENT})`, `default_max_staleness=None`, and an Italian `explanation_template` (P2). | Hand-computed fixtures at all four §4.1 points, **including `H = 0` asserting `FIRED` with `severity == Decimal("2.00000000")` and *not* `SKIPPED`**. Plus: two affected assets aggregate; a surplus on one asset does not mask a deficit on another (the per-asset predicate); the final step is `any` and is boolean. |
| `src/financeos/core/engines/rule_engine.py` (existing kinds, when they land) | `untargeted_allocation` params model rejects `threshold_weight <= 0` (**D6**); `bucket_below_target_value` uses the literal-free `2 − coverage` steps (**D8**). | Params-model rejection test at `threshold_weight = 0`; a `bucket_below_target_value` trace containing no unsourced binding. |
| `src/financeos/app/` — `evaluate_strategy` | Assemble the apportionment fact into the `FactSet`; on failure pass `unavailable={"apportionment": <reason>}` rather than an empty mapping. The handoff's W1c rule applies verbatim: *"Never invent a partial denominator."* | An unresolvable apportionment yields `SKIPPED(missing_fact)`, never `NOT_FIRED`. |
| `tests/test_condition_registry.py` | Extend the severity row of RFC-0006 §11 from the drift-specific assertion to the generalized one, quantified per §4.5: for every kind declaring a formula, `severity == 1` at that kind's own firing boundary, non-decreasing in breach magnitude over `FIRED` states. | The suite fails if a kind is registered with a formula and no anchor case. |
| `tests/test_trace_replay.py` | Add `over_apportioned` to the generated kinds so the blinded-replay property covers it (the algebra it uses — `gt`, `add`, `subtract`, `ratio_to`, `any` — is already generated, so this is coverage, not new machinery). | Non-vacuity: the measured outcome counts must show `over_apportioned` reaching `FIRED` and `NOT_FIRED`. |
| `tests/` — new ordering test (ADR-L02 §4.5, handoff §3.3) | The dedicated read-side ordering test over `mv_finding` with synthetic `alert` rows, plus §4.6's two additions: priority dominance at an arbitrarily small severity margin, and a null sorting below a `1.00`. | All three `ORDER BY` clauses plus ties and nulls, independent of the demo fixture. |
| `demo/` and `demo/expected/` (W1c, unwritten) | Author row 9's severity as `1.13207547` and the ordered findings list in §4.6's order. | `uv run financeos seed demo && evaluate` reproduces `demo/expected/` byte-for-byte. |
| `docs/plans/adr/ADR-L02-severity-declarations.md` | **Do not edit.** Its §4.6 closing paragraph and §7 item 1 are superseded by this ADR; D6–D8 are reported here, not patched there. | — |
| `docs/seed/**` | **Do not edit.** Frozen (RFC-0000 §10.3). | — |

### 6.2 Positive

- **The uniform anchor is now true of the whole V1.0 catalog**, not five-sixths of it. RFC-0006 §11's
  severity row can be a single generic assertion, which is the only mechanical thing standing between the
  catalog and a future kind shipping a formula on an arbitrary scale.
- **RFC-0008 §3's second sort clause becomes meaningful inside the `HIGH` band**, where five of the six
  V1.0 kinds land. Under the old declaration a total over-commitment sorted below a marginal drift
  breach, and ADR-L02 §4.6 had to lean on *"`Priority` dominates"* to explain why that was tolerable.
  It no longer needs to: `Priority` still dominates, but severity is now a measurement inside the band
  rather than an artefact of a different convention.
- **The formula is total with no guard, no branch, and no new operation.** Six steps from the existing
  15, no bound literal, and the worst state the kind can observe reads a real `2.00` rather than
  `SKIPPED`.
- **`bucket_below_target_value` and `over_apportioned` now share one shape** — `2 − coverage`. Two kinds
  measuring "how much of what was promised is actually there" read the same way, which is the kind of
  coherence a single scalar sort key needs to be believable.
- **The audit found three real defects in already-accepted work** (D6, D7, D8) and one forward collision
  (D9), each of which would otherwise have surfaced as a failing build or a wrong number later.
- **A `NOT_FIRED` `over_apportioned` row carries `severity = None` honestly**, with no negative-severity
  artefact of the sort ADR-L02 §4.2 accepts for `unassigned_residual_above`.

### 6.3 Negative / accepted costs

- **The fixture's row order changes**, not only a number. `over_apportioned` moves from position 9 to 8.
  Both O3 and handoff §3.3 anticipated only a changed number, so anyone holding UX-0001 §8.5's row
  numbering in their head must re-read §4.6. All three `ORDER BY` clauses stay exercised and §8.5's
  commentary stays literally true, but the coincidence is worth naming rather than relying on.
- **The fixture number is `1.13`, not the `1.15` O3 predicted.** O3 predicted the naive re-anchor, which
  §4.2 rejects on totality. Any note, ticket or expectation carrying `1.15` is stale.
- **Severity is bounded to `(1, 2]`**, so `over_apportioned` cannot out-sort a large drift breach on
  severity alone — the same accepted cost ADR-L02 §4.4 took for `bucket_below_target_value`, with the
  same mitigation (`Priority` dominates) and the same honest admission that a single scalar cannot
  calibrate a bounded ratio against an unbounded one.
- **The aggregate is not monotonic under changes of the affected set** (§4.5). Two breaches can read
  lower than one severe breach. Unavoidable for any scope-level scalar in this algebra; the sharper
  `max` form would need a 16th operation and its own ADR, and would still not be total.
- **The severity number diverges from a formula RFC-0011 states literally.** §5 argues this is a repair
  of an undefended clause rather than an override of a decision, but it is a divergence from the
  document that wins conflicts, and it is the first one this project has taken against RFC-0011 rather
  than against RFC-0004–0010.
- **The trace grows with the number of assets in scope.** One binding pair and one `gt` step per asset:
  the fixture's portfolio scope records 9 pairs and 9 comparisons for one finding. Honest and replayable,
  but the trace ladder (UX-0001 §4.2) will need to collapse the non-firing rows or the explanation
  surface becomes a spreadsheet.
- **D9 is left standing as a future collision.** Recorded, not repaired: ERR-14's reflection test does
  not exist yet, and whoever writes it must read §5.1 first or it will fail a V1.0 kind on its first run.

---

## 7. Open items for the product owner

1. **May a user-facing `over_apportioned` message name the instrument?** This is the first V1.0 finding
   whose explanation needs to identify a *position* rather than an `AssetClass` — *"53 quote impegnate
   contro 46 possedute"* is unusable without saying of what. RFC-0012 ERR-14 permits an `AssetId` "as a
   label only" and ADR-0025's `REVIEW_BUCKET_ASSIGNMENT` sits inside ERR-14's allowlist, so the corpus
   permits it; I-12 and ADR-0010's suitability firewall forbid *prescription*, not naming. The technical
   answer is therefore yes, but it changes what the product says to the user for the first time, so the
   posture is worth confirming before the template is written. **Recommendation:** name the instrument by
   its own label (name + ISIN), never a direction or a quantity to trade.
2. **Should `over_apportioned` remain one finding per scope, or become one per affected asset?**
   Aggregation is forced by ADR-0025's `(scope)` params and costs the set-monotonicity in §4.5. A
   per-asset variant would be sharper and would need either an `asset` param (author enumerates
   positions — defeats the purpose) or a kind that emits multiple findings per rule, which
   `finding_key`'s `rule_id ‖ scope ‖ params` hash (ADR-0027) does not currently allow. Not proposed for
   V1.0; the natural V1.1 shape if the aggregate proves blunt in use.
3. **D6's guard changes what an author may write.** `threshold_weight = 0` on `untargeted_allocation`
   becomes an import-time rejection rather than a rule that skips. Almost certainly right — it is a
   nonsense authoring — but it is a validation rule the corpus never stated, so it is recorded here
   rather than assumed.
</content>
</invoke>
