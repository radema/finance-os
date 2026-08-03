# ADR-L06 — Rule scope gating: which evaluation call a Rule applies to

| | |
|---|---|
| **Status** | Accepted (task #13/#14, W2-rule-scope-partition.md follow-up) |
| **Date** | 2026-08-03 |
| **Resolves** | W2-rule-scope-partition.md §2's open design question: *"Today no field on `Rule` or `LeafCondition` distinguishes 'applies to any Bucket using this version' from 'applies only at Portfolio scope' from 'applies only to this one named Bucket.'"* |
| **Depends on** | RFC-0006 §3 / §3.1 (the closed catalog; the no-computation boundary), RFC-0006 §4 (`FactSet`, `unavailable`), RFC-0007 §5 (`scope: portfolio` requires homogeneous governance or `SKIPPED(heterogeneous_strategies)`), C2 (engines take no ports), ADR-L04/ADR-L05 (house style) |
| **Blocks** | The §8.5 demo-fixture partition (10/9/8/1) — a separate, later task. This ADR only unblocks the engine-side mechanism the fixture will need. |

---

## 1. Context

`rule_engine.evaluate(rules, facts)` evaluates every rule in `sv.rules` against whichever single
scope's `facts` the caller assembled. Nothing gates a rule to the scope it is meant for:
`drift_outside_tolerance`, `untargeted_allocation`, `allocation_absent` and `over_apportioned` all
carry a `scope: str` param, but RFC-0006 §3.1 states plainly that the Rule Engine performs no
financial computation and holds no notion of "this call's scope" to compare against — and indeed
`params.scope` today is read only inside each kind's message-binding helper, never compared to
anything.

`cli.py evaluate` only ever constructs `Scope.for_bucket(...)`, so the gap was invisible: one
`StrategyVersion`'s rules were only ever evaluated once, against one scope. Adding a Portfolio-scope
call (task #14, RFC-0007 §5) changes that — the same `sv.rules` collection is now evaluated at
**two** different scopes for one Portfolio, and nothing stops a rule authored for one of them from
running at both.

## 2. Decision Drivers

- **C2 / RFC-0006 §3.1.** The engine takes no ports and performs no financial computation, so it
  must not be taught to compare a rule's declared scope against the facts it was handed — that
  reasoning belongs to the application layer, which already assembles scope-specific facts one call
  at a time (RFC-0005 §3's composition point, `evaluate_strategy`).
- **No authoring migration for the one rule that exists today.** `demo/` is frozen for this task
  (a separate, later task owns the fixture). Whatever default this ADR picks must leave every rule
  authored without an explicit gate behaving exactly as it does today — including under a **newly
  added** Portfolio-scope call it was never evaluated against before.
- **`unassigned_residual_above` carries no `scope` param at all** (ADR-0029: portfolomo-scoped by
  nature) — its own condition params contain no scope hint to fall back on. Any mechanism must
  still be able to gate a rule authored on it.

## 3. Considered Options

1. **A field on `LeafCondition`.** Rejected: `params` is validated per-kind by the catalog's own
   Pydantic model (RFC-0006 §2/§9), and a gate is not a condition parameter — it would have to be
   re-declared on all eleven kinds' params models, most of which have no legitimate reason to know
   about it.
2. **Scope-kind matching in the app layer over the existing `params["scope"]` string, with no new
   field.** Promotes the existing (currently decorative) string to also be the applicability gate.
   Works for four kinds; leaves `unassigned_residual_above` — and any future kind authored without a
   `scope` param — with no way to narrow.
3. **A new field on `Rule`, `scope_gate`, an explicit override; falling back to option 2's inference
   when unset; unconstrained (applies to whichever call it is given) when neither is present.**
4. **Teach the engine `evaluate(rules, facts, *, scope)` and filter internally.** Rejected outright
   on C2/§3.1 — this is exactly "teaching the engine about scope" the corpus's own open question
   warns against, and it would need a port-free way to resolve a Bucket-specific gate's `BucketId`
   against `scope.id`, which the engine has no business doing.

## 4. Decision Outcome

**Option 3.** A new model, `RuleScopeGate` (`core/strategy/rule.py`), plus a new optional field on
`Rule`:

```python
class RuleScopeGate(DomainModel):
    kind: ScopeKind                    # BUCKET | PORTFOLIO
    bucket_id: BucketId | None = None  # only meaningful when kind is BUCKET

    def applies_to(self, scope: Scope) -> bool: ...

class Rule(DomainModel):
    ...
    scope_gate: RuleScopeGate | None = None
```

`RuleScopeGate.applies_to`:

| `kind` | `bucket_id` | Applies to |
|---|---|---|
| `BUCKET` | `None` | Every governed Bucket's call (the generic case: one rule, evaluated once per Bucket) |
| `BUCKET` | set | That one named Bucket's call only |
| `PORTFOLIO` | must be `None` (construction-time guard) | The Portfolio-scope call only |

The application layer (`app/evaluate_strategy.py`) filters `sv.rules` immediately before calling
`rule_engine.evaluate`, per C2:

```python
rules = tuple(rule for rule in sv.rules if _applies_to_this_call(rule, scope))
firings = evaluate(rules, facts)
```

### 4.1 The three-level lookup

`_applies_to_this_call(rule, scope)`:

1. **An explicit `rule.scope_gate` wins**, whatever it says.
2. **Otherwise, `rule.condition.params["scope"]`, if present and parseable as a canonical `Scope`
   ref** (`"bucket:<uuid>"` / `"portfolio:<uuid>"`, the same string `Scope.ref` already produces),
   narrows the rule to *exactly* that scope. This is §3's option 2, and it is the reason no existing
   rule — including `demo/strategy.yaml`'s single authored rule, which already writes
   `scope: "bucket:44940ba1-..."` — needs any authoring change to keep behaving correctly once a
   second (Portfolio) scope call exists.
3. **With neither, the rule is unconstrained**: it applies to whichever call it is given. This is
   `unassigned_residual_above`'s case (no `scope` param, ADR-0029) and is exactly today's implicit
   behaviour for every rule, preserved byte-for-byte.

A firing on a rule the current call's scope does not gate for is not evaluated at all — not even a
`SKIPPED` row is produced for it. It is excluded from `rules` before `evaluate` ever sees it, the
same way a `disabled` rule reaches `evaluate` but a gated-out-of-this-call rule never does.

### 4.2 Why promote `params["scope"]` rather than only add the new field

Rejected minimal alternative: ship only the new `scope_gate` field, defaulting every rule
(including the one demo/ rule) to unconstrained. This was tried first and it breaks
`tests/test_golden_demo.py`: the demo's one `drift_outside_tolerance` rule, authored against one
Bucket's own ref, would then also evaluate at the newly-added Portfolio-scope call — the same drift
fact computed at Portfolio-level allocation, producing a second `Alert` for the same `rule_id`
in the same `as_of`, doubling the golden file's asserted `alert_count`. Since `demo/` cannot be
touched to add an explicit gate (frozen for this task) and the test cannot be edited to accept the
new count, the fix has to come from a default that reads the rule's own already-authored intent —
and `params["scope"]` already states it, verbatim, for exactly the kinds that need it. This also
directly closes the W2 plan's own observation that the string is "read only as a message binding,
never compared" — after this ADR it is compared, by default, which is the natural resolution the
plan's wording points at rather than a new invention.

## 5. Consequences

### 5.1 File-by-file

| File | Change |
|---|---|
| `src/financeos/core/strategy/rule.py` | `RuleScopeGate` (frozen, `extra=forbid`), `applies_to`, a construction-time guard rejecting `bucket_id` set with `kind=PORTFOLIO`; `Rule.scope_gate: RuleScopeGate \| None = None`. |
| `src/financeos/core/strategy/__init__.py` | Exports `RuleScopeGate`. |
| `src/financeos/app/evaluate_strategy.py` | `_condition_scope_ref`, `_applies_to_this_call`; `sv.rules` is subset before `evaluate(...)`. Also: heterogeneous-governance detection for Portfolio scope and the `SkipReason.HETEROGENEOUS_STRATEGIES` wiring (RFC-0007 §5, task #14) — the two land together because the Portfolio-scope call this ADR gates is the same call that needs the heterogeneity check. |
| `src/financeos/adapters/importers/yaml_strategy.py` | `_parse_scope_gate` — optional `scope_gate:` block in authored YAML, parsed only when present. `demo/strategy.yaml` is not touched; nothing requires it to declare one. |
| `src/financeos/cli.py` | `evaluate` additionally calls `evaluate_strategy` once per governed Portfolio (task #14), alongside the existing per-Bucket loop, when no `--bucket-id` filter narrows to one Bucket. |
| `src/financeos/core/shared/enums.py` | `SkipReason.HETEROGENEOUS_STRATEGIES`. |
| `src/financeos/adapters/duckdb/queries/allocation.py` | `TARGETS_HETEROGENEOUS` now aliases the enum member instead of a duplicated string literal. |
| `src/financeos/web/labels.py` | Removed the now-stale comment describing the label as "drafted ahead of the enum member." |
| `src/financeos/adapters/duckdb/queries/runs.py` | `run_outcome_counts`: `coalesce(count_if(...), 0)` — see §5.3. |
| `src/financeos/adapters/duckdb/queries/snapshots.py` | `drift_history` collapses to one row per `(portfolio_id, as_of)` — see §5.3/§6.1 (owner ruling). |
| `tests/test_evaluate_strategy.py` | `TestRuleScopeGateModel`, `TestRuleScopeGating` (a Bucket-gated and a Portfolio-gated rule are mutually exclusive across the two calls), `TestHeterogeneousGovernance` (`SKIPPED(heterogeneous_strategies)` from `evaluate_strategy`), `TestSnapshotDedupeAcrossScopeCalls` (an N-Bucket Portfolio yields exactly one `DriftPoint` per `as_of`). |

### 5.2 Positive

- No authoring migration for `demo/` or any rule that predates this ADR.
- The gate lives where C2 says it must: the application layer decides which rules a call sees; the
  engine still knows nothing about scope.
- `params["scope"]`, previously inert, now does real work, closing the exact gap the W2 plan named.

### 5.3 Negative / accepted costs, and one found defect requiring a decision

- **Two lookup paths to reason about** (`scope_gate`, then `params["scope"]`) instead of one. This
  is the direct cost of not touching `demo/`; a single mechanism would be simpler if authoring were
  free to change everywhere.
- **`run_outcome_counts` defect, found and fixed as a direct consequence of this ADR.**
  `count_if(...)` returns `NULL` (not `0`) over a zero-row group in DuckDB, unlike `count(*)` on the
  same empty result. Every Bucket-scope call before this ADR always evaluated at least one rule, so
  a run with zero `alert` rows never existed in practice; the Portfolio-scope call this ADR's rule
  gating makes possible for a single-Strategy Portfolio (its one rule gated out of the Portfolio
  call entirely) is the first case that reaches it. Fixed with `coalesce(..., 0)`; recorded here
  because it was latent before this change and only this change made it reachable.
- **A pre-existing read-side defect, made universal rather than created.** `evaluate_strategy` has
  always written a full Portfolio-wide `Snapshot` on **every** call (RFC-0009 §5.1) — this ADR does
  not touch that, and the owner ruling below confirms it stands. `cli.py:216-229` already looped
  **every** Bucket before this ADR, so an N-Bucket Portfolio already made N `evaluate_strategy`
  calls per `as_of` and already wrote N identical `Snapshot` rows at that `as_of`; `drift_history`
  (assumed at most one row per `as_of`) already returned N duplicate points per date for such a
  Portfolio. The three tests that surfaced this — `tests/test_queries.py`'s two `drift_history`
  tests and `tests/test_web_runs.py::test_provenance_bar_links_to_run_health` — passed only because
  the demo fixture is a single-Bucket Portfolio, where N happened to be 1. This ADR's
  Portfolio-scope call did not create the defect: it added one more call alongside the (already
  N ≥ 1) Bucket-scope loop, turning `N` into `N + 1` and making the multiplicity universal —
  reachable even at `N = 1` — rather than a latent property of multi-Bucket Portfolios nobody had
  written a fixture for yet.

  **Owner ruling: dedupe read-side.** RFC-0009 §5.1 stands unchanged — every `evaluate_strategy`
  call still writes its own `Snapshot`; the write side is not touched. `drift_history`
  (`adapters/duckdb/queries/snapshots.py`) now collapses to one row per `(portfolio_id, as_of)`,
  picking the latest `recorded_at` (ties broken on `snapshot.id`) via a `row_number()` window,
  keeping the existing `run.mode = 'ACTUAL'` and no-`run_id` exclusions intact. Verified by
  `TestSnapshotDedupeAcrossScopeCalls` (§5.1): a 2-Bucket Portfolio evaluated at both Bucket scopes
  and Portfolio scope for one `as_of` yields exactly one `DriftPoint`. Both `drift_history` tests
  now pass unedited.

  **`test_provenance_bar_links_to_run_health` — a test-fixture defect, not a production one;
  fixed by editing the test (owner ruling).** The homepage's own query (`latest_actual_run`,
  `adapters/duckdb/queries/runs.py`) was never wrong: `ORDER BY run.as_of DESC, run.evaluated_at
  DESC LIMIT 1` is already deterministic and already returns the truly most-recent
  `evaluation_run` row (the Portfolio-scope one, evaluated last in the CLI's loop). The test's
  *own* comparison query — `SELECT id FROM evaluation_run LIMIT 1`, no `ORDER BY`, no `mode`
  filter — never expressed "the run the provenance bar points at"; it expressed "an arbitrary
  run", and only read as the former because exactly one `evaluation_run` row existed when the
  test was written. Like the Snapshot case above, that assumption was already false for any
  N-Bucket Portfolio (`N ≥ 2` rows, arbitrary pick) before this ADR; task #14 only made it
  reachable at `N = 1` too. This is a defect in the test's own fixture query, not in the
  production read path, so the fix is in the test: its query now mirrors `latest_actual_run`
  exactly (`mode = 'ACTUAL'`, `ORDER BY as_of DESC, evaluated_at DESC`), and the assertion is
  strengthened to check both that the bar links to that truly-latest run **and** that it does
  not link to an earlier one — the property the original assertion was silently failing to
  check even when it happened to pass. `latest_actual_run` itself is untouched.

## 6. Consequences of the ruling, and what remains open

### 6.1 Both read-side questions — resolved

- **Snapshot/`drift_history`** (§5.3): read-side dedupe, write side unchanged. `drift_history`'s
  `row_number()`-windowed collapse to one row per `(portfolio_id, as_of)` is the shipped answer.
- **`test_provenance_bar_links_to_run_health`** (§5.3): a test-fixture defect, not a production
  one — the test's own comparison query never expressed "the run the provenance bar points at",
  only "an arbitrary run", and passed before this ADR only because exactly one `evaluation_run`
  row existed for the single-Bucket demo. Fixed by editing the test's query to mirror
  `latest_actual_run` (`mode = 'ACTUAL'`, `ORDER BY as_of DESC, evaluated_at DESC`) and
  strengthening the assertion to also check the bar does *not* link to an earlier run —
  `latest_actual_run` itself was already correct and is untouched.

No further decision needed on either; both close here.

### 6.2 Open item for the product owner

**Authoring convention for a future "generic, any-Bucket" rule.** Today's only example
(`demo/strategy.yaml`) hardcodes one Rule per Bucket, each with its own literal `scope` ref — the
`RuleScopeGate(kind=BUCKET, bucket_id=None)` "any Bucket" case is implemented and tested
(`TestRuleScopeGateModel`) but has no authored example yet. The §8.5 fixture task should confirm
which authoring shape it wants for the "7 generic rules" row before writing it.

---

## 7. Opus review findings (fix-then-ship), and their resolutions

An independent review of `43e36b9..e619957` found 2 blockers, 3 should-fix items and 2 nits, all
inside the mechanism this ADR builds (none touched `web/routes/strategies.py`,
`adapters/duckdb/queries/strategies.py`, `web/templates/strategy_detail.html`, or
`tests/test_web_strategies.py` — a different lane's boundary). Recorded here because each one
changes what §4/§5 actually guarantee, not only how they are implemented.

### 7.1 BLOCKER 1 — heterogeneous governance only protected `drift`, not every target-tree consumer

§4/§5 as first shipped set `unavailable["drift"]` under mixed governance and left `targets_facts`
populated with the arbitrary candidate Strategy's real values. `untargeted_allocation` declares
`required_facts = {targets, allocation}`, so it never consulted `drift`'s unavailability at all —
it read the candidate's target tree directly and could `FIRE` on it, which is exactly the average
RFC-0007 §5 forbids, just laundered through a second fact family rather than caught.

**Fix.** Under mixed governance neither `drift` nor `targets` is computed with real values at all —
both are left empty (`{}`), and *both* are marked `unavailable = HETEROGENEOUS_STRATEGIES`
(`_TARGET_TREE_FACT_FAMILIES = (rule_engine.FACT_DRIFT, rule_engine.FACT_TARGETS)`, referencing the
catalog's own constants rather than re-typed literals). Emptying the underlying mapping — not only
flagging `unavailable` — is what also protects `allocation_absent`, which bypasses the
`required_facts` precheck entirely and reads a per-class `drift:{asset_class}` fact directly
(`rule_engine.py`): with `drift = {}`, that per-class read finds nothing and the kind's own
`SkipSignal(missing_fact)` path takes over, so it can never fire on the candidate's numbers either,
regardless of which gate mechanism a given kind uses.

Verified by `TestHeterogeneousGovernanceBlocksEveryTargetTreeConsumer` — an `untargeted_allocation`
rule that would fire at ~80% severity if the candidate's tree were ever consulted now reads
`SKIPPED(heterogeneous_strategies)`.

**Correction (round 3, SHOULD-FIX 3): `allocation_absent` never fires, but not with this reason.**
The sentence above ("can never fire … regardless of which gate mechanism") is true of the *outcome*
only. `allocation_absent` declares `required_facts = {allocation}`, never `{drift}` or `{targets}`,
so the family-level `unavailable` dict this fix populates is never consulted for it at all — its
`SKIPPED` comes entirely from `open_fact` raising on the now-empty per-class `drift:{asset_class}`
binding, which always raises `SkipReason.MISSING_FACT`, never `HETEROGENEOUS_STRATEGIES`. Making the
kind report the more specific reason would require teaching `rule_engine.open_fact` about a second,
app-supplied cause for a fact's absence, which is a change to the engine's own contract and out of
this ADR's scope. Recorded here rather than silently claimed as covered:
`TestHeterogeneousGovernanceBlocksEveryTargetTreeConsumer::test_allocation_absent_skips_with_missing_fact_under_mixed_governance`
verifies the actual reason (`missing_fact`), not the one drift_outside_tolerance/untargeted_allocation get.

### 7.2 BLOCKER 2 — the scope inference only read `params["scope"]`, missing `params["bucket"]`

`bucket_below_target_value` names its Bucket under the params key `"bucket"`
(`BucketBelowTargetValueParams`), not `"scope"`. The original `_condition_scope_ref` read only
`params.get("scope")`, so a `bucket_below_target_value` rule was always "unconstrained" and, once
the Portfolio-scope call existed, ran there too — comparing the whole Portfolio's value against one
Bucket's authored target.

**Fix.** `_named_scope_value` scans every value in `condition.params`, not a hardcoded set of key
names, and returns the one that is shaped like a `Scope.ref` (`"kind:<uuid>"`). Every scope-naming
param the catalog authors — under `"scope"` for four kinds, under `"bucket"` for
`bucket_below_target_value` — is written in exactly that form, so this covers both without special
-casing either, and covers a future kind using a third key name under the same convention for free.

Verified by `TestBucketNamedScopeParamGating`: a `bucket_below_target_value` rule now applies at its
own Bucket's call and is absent from the Portfolio-scope call's firings entirely.

### 7.3 SHOULD-FIX 3 — `drift_history`'s tiebreak could land on the wrong governing version

§5.3's dedupe picks the Snapshot with the latest `recorded_at` per `(portfolio_id, as_of)`. Under
homogeneous governance every Snapshot at that `as_of` is pinned to the same `strategy_version_id`
(every call resolves it from the same shared Strategy), so any tiebreak is safe and the "identical"
claim in §5.3's earlier text holds for the `allocation` payload — but under **mixed** governance the
Portfolio-scope call's candidate is an arbitrary choice among disagreeing Strategies, and since it
evaluates last it always wins the tiebreak. The chart would then show `target`/`drift` computed
against a tree that does not govern anything.

**Fix.** `drift_history` now also computes `count(DISTINCT run.strategy_version_id) OVER (PARTITION
BY snap.as_of)` and drops any `as_of` where that count is `> 1` — no point at all for a date whose
Snapshots disagree on their governing version, rather than reporting one Strategy's tree as the
Portfolio's own. This is the same "`SKIPPED`, never an average" posture RFC-0007 §5 and CLAUDE.md
both state, applied to a read-side series instead of a rule outcome. §5.3's "identical" claim above
is now qualified: true under homogeneous governance, which is the only case this dedupe alone
resolves — mixed governance needed this second, independent fix.

Verified by `TestDriftHistoryExcludesHeterogeneousAsOf`: a 2-Bucket Portfolio with disagreeing
Strategies produces zero `EQUITY_DEVELOPED` drift points for their shared `as_of`.

### 7.4 SHOULD-FIX 4 — a malformed or foreign scope reference silently widened or vanished

`_condition_scope_ref` (as first shipped) returned `None` whenever `params["scope"]` failed to
parse, and `None` was read the same way as "no scope-naming param at all" — falling through to
"unconstrained". Two failure modes hid behind that one `None`: an authored string that is not a
valid `Scope.ref` at all (malformed), and one that parses but names a Bucket outside the Portfolio
being evaluated (foreign, e.g. moved or deleted). Both left the rule invisible on the run health
panel — the first by silently widening what it saw, the second because a name that never matches
any call's scope means it never appears in any run's firings, ever, with nothing in `SKIPPED`/`ERROR`
to say so. ADR-0016 is explicit that this is exactly the failure mode the four-outcome model exists
to prevent.

**Fix.** `_placement_error` checks, before `_applies_to_this_call` is ever consulted, whether a
rule's scope-shaped param is unparseable or names a Bucket/Portfolio foreign to the one being
evaluated. Either case excludes the rule from every call **and** synthesizes an `Outcome.ERROR`
`RuleFiring` (`_placement_error_firing`, built in the app layer with the same
`RuleFiring`/`EvaluationTrace` shape `rule_engine._errored` uses for an evaluator defect), so it
still lands in `materialize`'s output and renders on the run health panel like any other `ERROR`.

Verified by `TestUnplaceableConditionScopeSurfacesAsError` (both the malformed and the foreign-Bucket
case) and `TestRunOutcomeCountsCoalesce::test_placement_error_run_counts_as_error_not_skipped`.

### 7.5 SHOULD-FIX 5 — `unassigned_residual_above` had no scope-naming param, so it ran everywhere

ADR-0029 removed `scope` from `unassigned_residual_above`'s params because the question "relative to
which Bucket" was never meaningful — the kind is portfolio-scoped by nature. But with no scope
param to infer from and no `scope_gate` authored, the rule fell through `_applies_to_this_call` to
"unconstrained": it ran once per Bucket *and* once at Portfolio scope, producing N+1 findings for
what the corpus describes as one Portfolio-wide fact, each Bucket-scope one under a *different*
`finding_key` (it hashes `scope_id`) that no existing dismissal covers.

**Corpus check, per the review's own instruction not to invent this:** ADR-0029 states plainly that
`unassigned_residual_above.threshold_weight` "is relative to total portfolio value. The rule is
portfolio-scoped by nature" — and W2-rule-scope-partition.md §1's own count independently forces the
same conclusion, listing `unassigned_residual_above · portfolio` as one of exactly the three
portfolio-scope rules the §8.5 fixture partition requires. The corpus settles this: Portfolio scope
only. Not a product-definition question left open.

**Fix.** `_default_scope_gate` derives a `RuleScopeGate(kind=PORTFOLIO)` default for any rule whose
kind's *only* required fact is one RFC-0006 §4 itself documents as portfolio-scoped by nature
(`_PORTFOLIO_SCOPED_FACT_FAMILIES = {rule_engine.FACT_RESIDUAL}` today) — derived from the registry's
declared `required_facts`, not the kind's name, so a future kind sharing the same fact family gets
the same default with no second edit here. Consulted only when neither an explicit `scope_gate` nor
a condition-level scope reference exists, so it changes nothing for any kind that already names its
own scope.

Verified by `TestUnassignedResidualAboveDefaultsToPortfolioScope` and
`TestRunOutcomeCountsCoalesce::test_zero_alert_run_reads_as_all_zero_counts_not_a_crash` (the
Bucket-scope run this default now correctly excludes the rule from).

**Consequence, written down rather than discovered (DOC item, round 3):** `finding_key` hashes
`rule_id ‖ scope_id ‖ canonical(condition.params)` (ADR-0027/RFC-0008 §4). Before this fix a live
`unassigned_residual_above` Rule produced one finding per Bucket plus one at Portfolio scope, each
under its own `scope_id` and therefore its own `finding_key`. Any `Decision` (dismissal) a user
recorded against one of those Bucket-scope keys is **orphaned** by this change: the Bucket-scope
finding it dismissed no longer exists (the rule is Portfolio-scope only from here on), and the
Portfolio-scope finding — the one that now carries the same information — has always had a
*different* `finding_key` and was never dismissed. It reappears as if newly found. This is the
exact behaviour CLAUDE.md's dedup warning describes ("keying on less than the full `finding_key`
silently hides live findings — this bug has already shipped once") applied in the opposite
direction: not a key that under-hashes, but a rule whose *scope itself* changed, carrying every
finding_key it ever produced along with it. No migration exists for stored `Decision` rows and none
is proposed here — this is a one-time consequence of fixing SHOULD-FIX 5, surfaced for whoever
deploys this change, not a defect in the fix itself.

### 7.6 Nits

- The stale comment naming `allocation_absent` among the kinds gated by `unavailable["drift"]` — it
  was never gated by the family precheck at all (§7.1) — is rewritten to describe the real bypass.
- `run_outcome_counts` had zero tests despite the `coalesce(count_if(...), 0)` fix landing two
  commits earlier; `TestRunOutcomeCountsCoalesce` now covers both the zero-alert-run case and the
  `§4.2` condition-level-inference path (via the placement-error scenario, §7.4), so a regression in
  either is caught here rather than only by a downstream web test happening to exercise it.

---

## 8. Round-3 review findings, and their resolutions

A second independent review of `e619957..2b55008` found 2 further blockers, 3 further should-fix
items and 1 doc item, all inside §7's own mechanism.

### 8.1 BLOCKER 1 — `_placement_error` ran before the `enabled` check

A **disabled** rule with a malformed or unparseable scope reference still went through
`_placement_error` and produced a synthetic `ERROR` firing on every run, with no way to silence it —
a disabled rule must never generate run-health noise merely because its authored (but never
evaluated) scope ref happens to be malformed.

**Fix.** The per-rule loop in `evaluate_strategy` now checks `rule.enabled` first: `_placement_error`
runs only for an enabled rule. A disabled rule falls straight through to `_applies_to_this_call`,
whose "unconstrained" default (§4) makes it eligible for whichever call's scope it is handed —
`rule_engine.evaluate` itself then reports the ordinary `SKIPPED(disabled)` every disabled rule
reports, once per call. It is not silence and it is not a second, distinct outcome; it is the one
signal a disabled rule has always produced, with the placement check never in its way.

Verified by
`TestUnplaceableConditionScopeSurfacesAsError::test_disabled_rule_with_a_malformed_scope_reads_only_as_disabled`.

### 8.2 BLOCKER 2 — `_named_scope_value` treated any colon as the signal

Scanning every `condition.params` value for `":" in value` (§4.2) works only by accident: nothing
stops a future kind's unrelated param — an ISIN, a timestamp, anything with a colon — from being
misread as a scope reference. The first one that does becomes "unparseable" under `_placement_error`
and permanently disables its own rule, or silently steals the "named scope" slot from whichever
param the kind actually intended to name a scope with.

**Fix.** `_named_scope_value` now requires the text *before* the colon to itself be a `ScopeKind`
value (`_SCOPE_KIND_PREFIXES = frozenset(kind.value for kind in ScopeKind)`, checked
case-insensitively) — a bare colon is no longer the signal, the prefix has to actually claim to name
a scope kind. Every real scope reference in the catalog already reads `"bucket:…"` / `"portfolio:…"`,
so this changes nothing for any existing kind and only narrows what a future false positive could be.

### 8.3 SHOULD-FIX 3 — see §7.1's correction, above

Folded into §7.1 directly (the finding is about that section's own claim) rather than repeated here.

### 8.4 SHOULD-FIX 4 — `drift_history` dropped `weight` along with `target`/`drift` under mixed governance

§7.3's dedupe dropped the *entire* point for an `as_of` whose Snapshots disagreed on their governing
`strategy_version_id`. But `weight` comes from the Snapshot's `allocation` JSON — the Portfolio's own
valuation, computed identically by `_build_snapshot` regardless of which Strategy the call's
candidate happened to be — so it is a fact about the Portfolio, not about which Strategy governs it,
and dropping it along with the genuinely arbitrary `target`/`drift` throws away a real number for no
reason.

**Fix.** The query keeps every `rn = 1` row regardless of `distinct_versions`, carrying that count
into Python; `target` is computed from the row's `definition` only when `distinct_versions == 1`,
otherwise left `None` (and `drift` follows, since it needs both operands) — the same "no target for
this class" shape `DriftPoint` already represents, applied for a different reason.

Verified by `TestDriftHistoryExcludesHeterogeneousAsOf` (renamed
`test_mixed_governance_nulls_target_and_drift_but_keeps_weight`): one point is returned, `weight` is
set, `target`/`drift` are both `None`.

### 8.5 SHOULD-FIX 5 — a Bucket-named rule in a shared Strategy read as a foreign-Bucket defect

`_placement_error`'s original Bucket check compared against `known_bucket_ids = uow.buckets.for_portfolio(portfolio_id)`
— *this* Portfolio's own Buckets only. A Strategy (and therefore any Rule frozen inside it) is not
scoped to one Portfolio by the data model; nothing stops the same Strategy from governing Buckets in
two different Portfolios. Evaluating that Strategy for the *other* Portfolio made a perfectly valid,
correctly-Bucket-named rule read as a placement defect and produce a spurious `ERROR`.

**Fix.** The Bucket check now asks whether the named Bucket exists **anywhere**
(`all_bucket_ids = frozenset(uow.buckets.all_ids())`), not only in this Portfolio. A Bucket that
exists but belongs to a different Portfolio is left to `_applies_to_this_call`'s ordinary scope
comparison, which naturally never matches any call of an evaluation it was not named for — exactly
like a rule naming a sibling Bucket in the *same* Portfolio already worked. Only a reference to a
Bucket that does not exist *at all* is still a placement error. The equivalent Portfolio-kind check
was widened the same way, using `uow.portfolios.get(...)` to distinguish "a different, real
Portfolio" (not applicable, not an error) from "no such Portfolio" (a genuine defect).

Verified by `TestSharedStrategyAcrossPortfolios::test_bucket_in_a_different_real_portfolio_is_not_applicable_not_an_error`
(no alert at all, not an `ERROR`) alongside the unchanged
`TestUnplaceableConditionScopeSurfacesAsError::test_bucket_reference_to_nothing_yields_an_error_firing`
(still an `ERROR`, now for "does not exist" rather than "not governed by this Portfolio").

### 8.6 DOC — the orphaned-dismissal consequence

Folded into §7.5 directly (see the paragraph beginning "Consequence, written down rather than
discovered"), rather than repeated here.
