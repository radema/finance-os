# Test-suite triage — 2026-08-01

**Commit:** `d831c60` · **Scope:** `/root/finance-os/tests/` · **Status:** report only, HALTED for sign-off.

Nothing was edited, deleted, or merged. No file under `tests/` was modified by this pass.
Procedure: `test-suite-triage` skill (7-class anti-pattern taxonomy; KEEP / TRIM-trivial /
TRIM-redundant / MERGE), 5 read-only reviewers over disjoint areas, coordinator re-verified
every non-KEEP verdict by reading the test and, where relevant, the module under test.

## Summary

| Verdict | Test functions |
| --- | --- |
| KEEP | 358 |
| TRIM-trivial | 3 |
| TRIM-redundant | 4 |
| MERGE | 4 (→ 2 parametrized, 2 groups) |
| **Total** | **369** |

369 test functions (429 collected cases, the difference being `parametrize` expansion) across
31 modules. Maximum reduction if every proposal is accepted: **9 fewer test functions, ~2.4%**,
and no case dropped — the MERGE groups keep one parametrized row per original input.

That is a very low trim rate, and it is the honest finding. This suite is dense with real
branch, boundary, and invariant coverage: almost every test either cites an ADR/RFC/invariant
or reaches a branch nothing else reaches. Deliberate KEEPs the taxonomy would otherwise have
flagged are listed under "Load-bearing tests that look trivial" below.

## Tier 1 — high confidence

| # | Test | Verdict | Why |
| --- | --- | --- | --- |
| 1 | `tests/test_migration_001.py:235` `test_buy_negative_cash_leg_inserts` | TRIM-redundant | Body is identical to `test_row2_cash_leg_only_is_legal` (`:117`) — the same two `insert_operation` calls, same CHECK branch. Keep the truth-table row (`:117`), which is the one the ADR-L01 §4.2 table maps to. |
| 2 | `tests/test_mv_finding_ordering.py:116` `test_null_severity_sorts_last_within_its_priority_band` | TRIM-redundant | Same `NULLS LAST` branch as `:101`, at a looser margin (severity 1.50 vs 1.00). `:101` cites ADR-L04 §4.6 and asserts the tightest legal case, so it strictly subsumes this one. Keep `:101`. |
| 3 | `tests/test_shared_values.py:134` `test_entity_ref` | TRIM-trivial | Tautology. `entity_ref` is `return f"{kind}:{identifier}"` (`src/financeos/core/shared/ids.py:48`) with no branching, and the test asserts `entity_ref("op", i) == f"op:{i}"` — it reimplements the one line it is testing. Note: `Scope.ref` is separately covered at `:128`, and `entity_ref`'s output format is exercised for real through the trace/provenance tests. |
| 4 | `tests/test_rule_engine_v1_kinds.py:116` + `:121` | MERGE | `test_threshold_weight_zero_is_rejected_at_construction` and `test_negative_threshold_weight_is_rejected` both hit the single `threshold_weight <= 0` validator on `UntargetedAllocationParams`. Fold to `test_threshold_weight_must_be_positive` parametrized over `["0", "-0.05"]`. |
| 5 | `tests/test_rule_engine_v1_kinds.py:376` + `:382` | MERGE | Same shape: `test_target_amount_zero_is_rejected_at_construction` and `test_negative_target_amount_is_rejected` both hit `target_amount <= 0` on `BucketBelowTargetValueParams`. Fold to `test_target_amount_must_be_positive` parametrized over `["0", "-1"]`. |

Tier-1 total: 3 deletions, 2 merges (4 functions → 2).

## Tier 2 — individual review, lower confidence

| Test | Verdict | Why, and the argument against |
| --- | --- | --- |
| `tests/test_aggregates.py:376` `test_version_is_immutable` | TRIM-redundant (med) | The `DomainModel(frozen=True)` base-class behaviour is asserted three times: here, `test_aggregates.py:120` `test_operation_is_immutable`, and `test_shared_values.py:95` `test_is_frozen`. It is one pydantic config branch, not per-class logic. Against: frozen-ness is an ADR-0006 decree and cheap to keep per aggregate. Recommendation — keep `:120` as the representative and drop this one, or keep all three; do not drop `:120`. |
| `tests/test_shared_values.py:95` `test_is_frozen` | TRIM-redundant (med) | Same group as above. |
| `tests/test_web_views.py:248` `test_design_preview_still_serves` | TRIM-trivial (med) | Asserts only `status_code == 200` on the static `/design` route; no assertion about our logic. Against: it is the **only** test touching that route, so deleting it drops `/design` to zero coverage. A smoke test with no content assertion is still a smoke test. Recommendation — keep unless `/design` is being retired. |
| `tests/test_market_price_providers.py:49` `test_http_price_provider_raises_on_non_2xx` | TRIM-trivial (med) | Mocks a 500 and asserts `httpx.HTTPStatusError` — that is `httpx.raise_for_status`'s own behaviour, class 4 (framework-behavior). Against: it does pin that `HttpPriceProvider` calls `raise_for_status` at all, i.e. that it does not silently swallow a failed fetch. Recommendation — keep; the value is the negative ("does not swallow"), which the taxonomy's framework-behavior class does not really cover. |

## Load-bearing tests that look trivial — deliberate KEEPs

These score as anti-patterns on a naive read and are KEEP on purpose. Recorded so a future pass
does not re-propose them.

- **`tests/test_trace_replay.py` (13 tests)** — the project's non-negotiable replay property.
  Beyond the two Hypothesis properties, `:266` is a *non-vacuity* guard enumerating all seven
  reachable `(outcome, reason)` states, `:449` reaches the seventh (`ZERO_DENOMINATOR`, whose
  evidence is a null step value) that the generator does not, and `:384`–`:433` are five
  tamper tests that prove replay actually has teeth. None is subsumed by the property.
- **`tests/test_c4_read_write_split.py:29`, `tests/test_c6_append_only.py:48`/`:60`** —
  architecture contracts. C4 source-scans that *only* `financeos.web` imports
  `adapters.duckdb.queries` (import-linter cannot express a positive-only-importer rule); C6
  greps `src/` for `UPDATE`/`DELETE` against fact tables, the sole enforcement of append-only
  (I-10/W10) given DuckDB has no per-table grants. `test_c6_append_only.py:60` guards that C6's
  own hardcoded table list stays in sync with `001_init.sql`, so a new fact table cannot
  silently escape the grep.
- **`tests/test_i12_structural.py` (3 tests)** — same category: recursively bans prescriptive
  field names and instrument-identifying types anywhere in `Recommendation`'s model tree. `:79`
  is a tighter closed-set check that would catch a new field the two regex tests miss.
- **`tests/test_condition_registry.py` (15 tests)** — the completeness gate. `:138` requires
  every registered kind to declare params/evaluator/template/required_facts/severity; `:150`
  checks each explanation renders from the bindings its kind actually emits; `:177` requires
  every formula kind to have an anchor fixture or a documented exemption (ADR-L04 §6.1); `:194`
  asserts severity == 1 exactly at each kind's own firing threshold. The apparent
  parametrised duplication *is* the gate.
- **Exact-Decimal assertions** across `test_rule_engine_v1_kinds.py` (the `ux_0001_fixture_anchor`
  tests), `test_aggregates.py:321` (`adr0018_band_matrix`), `test_strategy_engine.py:42`,
  `test_it_locale.py:30`. The exact value is the ADR contract (ADR-L02/L04/L05), not brittleness.
- **`tests/test_risk_level.py:36` `test_risk_level_has_exactly_seven_members`** — a reviewer
  proposed TRIM-trivial (set equality re-listing the enum). **Overridden to KEEP.**
  `risk_level_rank` is a dict lookup (`strategy.py:71`), and this test is what keeps the test
  module's own `_ORDERED_MEMBERS` fixture in sync with `RiskLevel`. Without it, an eighth member
  would leave `test_risk_level_rank_matches_p32_ordinal_for_every_member` silently not covering
  it. Same shape as the condition-registry gate.
- **`tests/test_labels.py:130` `test_the_article_table_matches_l05_section_3_2`** — independently
  transcribes the ADR-L05 §3.2 article table by design, to catch a transcription slip in the
  registry. Duplication is the mechanism.
- **`tests/test_portfolio_engine.py:126` and `:237`** — both named `test_i15_a_foreign_currency_price_is_a_domain_error`, but they are two separate raise-sites (`compute_allocation` vs `compute_residual`). Not a duplicate.

## Where redundancy was expected and not found

The brief flagged the two modules that landed this session as the likeliest overlap. Both were
checked directly against their older siblings and came back clean:

- `test_rule_engine_v1_kinds.py` vs `test_rule_engine.py` — disjoint. `test_rule_engine.py`
  covers `drift_outside_tolerance` plus the engine's own machinery (skip reasons, staleness,
  error isolation, trace/binding shape, `apply_op`/`resolve`); `test_rule_engine_v1_kinds.py`
  covers the other five V1.0 kinds. The only overlap found is the two intra-file MERGE pairs above.
- `test_evaluate_strategy.py` vs `test_strategy_engine.py` — disjoint by layer. All four
  `test_evaluate_strategy.py` tests are named regressions against real DuckDB wiring (review
  BLOCKER 2, MAJOR 3) or exercise a new port method; the strategy-engine tests are unit-level
  formula tests. Neither subsumes the other.

## GAPs

No module or branch was found without a logic test. One soft spot, reported not fixed:
`HttpPriceProvider`'s non-2xx path is reached only by the framework-behavior test in Tier 2
(`test_market_price_providers.py:49`), so if that provider ever grows real error handling
(retry, partial-result, error-body parsing) it will need a test that asserts provider-specific
behaviour. Not a gap today — the provider does nothing extra on that path.

## Sign-off

Awaiting approval of a specific subset. Recommended: **Tier 1 only** (3 deletions + 2 merges).
Tier 2 is 4 items where I would keep two of them (`/design` smoke, non-2xx) and would accept
either answer on the frozen-model trio.
