"""The five V1.0 rule kinds beyond the walking skeleton (RFC-0006 §3, ADR-L02, ADR-L04):

`untargeted_allocation`, `unassigned_residual_above`, `allocation_absent`,
`bucket_below_target_value`, `over_apportioned`.

Each kind gets: an anchor case (`severity == 1` at its own firing threshold), a firing case,
its params-model guard (where the ADRs require one), and its own edge cases. A shared
`FIRING_FIXTURES` map (kind -> a `(Rule, FactSet)` that reaches `FIRED`) is exported for
`test_condition_registry.py`'s generic explanation-rendering check.
"""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from financeos.core.engines.portfolio_engine import compute_allocation, compute_apportionment
from financeos.core.engines.rule_engine import (
    BucketBelowTargetValueParams,
    FactSet,
    UnassignedResidualAboveParams,
    UntargetedAllocationParams,
    evaluate,
)
from financeos.core.engines.strategy_engine import compute_drift
from financeos.core.portfolio import ApportionmentLine, ApportionmentRecord, Holding
from financeos.core.shared import (
    AssetId,
    Bound,
    BucketId,
    Outcome,
    Priority,
    Quantity,
    Scope,
    SkipReason,
    SourceRef,
    SuggestionClass,
    label,
)
from financeos.core.strategy import LeafCondition, Rule
from tests import factories as f

PORTFOLIO_SCOPE = Scope.for_portfolio(f.PORTFOLIO)

#: `st.decimals` bounds shared by the `compute_apportionment` property tests (MAJOR 5).
APPORTIONED_QUANTITIES = st.decimals(
    min_value=Decimal("-1000"), max_value=Decimal("1000"), places=4, allow_nan=False
)

# --------------------------------------------------------------------------------------
# untargeted_allocation
# --------------------------------------------------------------------------------------

GLOBAL_EQUITY = AssetId(UUID(int=60))
COMMODITIES = AssetId(UUID(int=62))


def _untargeted_allocation_facts(current_pct: str, held_pct: str) -> FactSet:
    """`GLOBAL_EQUITY` untargeted at `current_pct` of the scope; `f.EQUITY` targeted and
    holding `held_pct` — so BLOCKER 1's fix is exercised against a scope where a held class
    genuinely has a target, not one where nothing does."""
    assets = {
        GLOBAL_EQUITY: f.asset(GLOBAL_EQUITY, "EQUITY_GLOBAL", name="Global ETF"),
        f.EQUITY: f.asset(f.EQUITY, "EQUITY_DEVELOPED"),
    }
    prices = {
        GLOBAL_EQUITY: f.price(GLOBAL_EQUITY, "1", n=61),
        f.EQUITY: f.price(f.EQUITY, "1", n=1),
    }
    holdings = [
        Holding(asset_id=GLOBAL_EQUITY, quantity=f.quantity(current_pct)),
        Holding(asset_id=f.EQUITY, quantity=f.quantity(held_pct)),
    ]
    breakdown = compute_allocation(
        holdings, assets, prices, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
    )
    allocation = {
        asset_class: Bound(value=line, source=SourceRef.derived(engine="portfolio"))
        for asset_class, line in breakdown.lines.items()
    }
    targets = f.flat_targets(("EQUITY_DEVELOPED", "1.0", f.absolute("0.9")))
    comp = compute_drift(breakdown, targets, strategy_version_id=f.VERSION)
    return FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, allocation=allocation, drift=comp.lines)


def _untargeted_allocation_rule(threshold_weight: str = "0.05") -> Rule:
    return Rule(
        id=f.rule_id(1),
        name="Classe non targettizzata",
        priority=Priority.HIGH,
        suggestion_class=SuggestionClass.REVIEW_STRATEGY,
        message="capitale non targettizzato",
        condition=LeafCondition(
            kind="untargeted_allocation",
            kind_version=1,
            params={
                "scope": f.BUCKET_SCOPE.ref,
                "threshold_weight": threshold_weight,
            },
        ),
    )


class TestUntargetedAllocation:
    def test_threshold_weight_zero_is_rejected_at_construction(self) -> None:
        """D6 (ADR-L04 §4.7, ratified P30)."""
        with pytest.raises(ValidationError):
            UntargetedAllocationParams(scope="x", threshold_weight=Decimal(0))

    def test_negative_threshold_weight_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UntargetedAllocationParams(scope="x", threshold_weight=Decimal("-0.05"))

    def test_does_not_fire_on_a_class_that_is_targeted(self) -> None:
        """BLOCKER 1 (review): the predicate must check the class actually has no target — a
        held class far above `threshold_weight` (97%, targeted here) must never drive this
        kind's predicate; only the untargeted class (3%, below threshold) is a candidate."""
        facts = _untargeted_allocation_facts("3", "97")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_a_single_untargeted_class_breach_fires(self) -> None:
        facts = _untargeted_allocation_facts("10", "90")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("2.00000000")

    def test_exactly_at_the_threshold_does_not_fire_with_no_severity(self) -> None:
        """ADR-L05: the sole candidate drops out of the (empty) affected set at the boundary —
        `severity = None`, not `1.00` (open-interval shape, same as `over_apportioned`)."""
        facts = _untargeted_allocation_facts("5", "95")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_the_boundary_is_a_limit_never_attained_on_a_fired_row(self) -> None:
        """ADR-L05 §3: the predicate is a strict `gt`, so `severity == 1.00` is a limit
        approached from above, never an attained value on a `FIRED` row.

        Amounts large enough that the 1-unit-of-cent breach survives `Money`'s
        `DECIMAL(19,4)` rounding (a tiny fractional quantity at `Weight`'s own 8-decimal
        scale would round away before the weight division ever sees it)."""
        facts = _untargeted_allocation_facts("50000.01", "949999.99")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity is not None
        assert Decimal("1.00000000") < firing.severity < Decimal("1.00000100")

    def test_multiple_simultaneous_breaches_take_the_worst_severity(self) -> None:
        """ADR-L05 §3: severity is the worst affected class's ratio, not a sum; the message
        names every affected class."""
        assets = {
            GLOBAL_EQUITY: f.asset(GLOBAL_EQUITY, "EQUITY_GLOBAL", name="Global ETF"),
            COMMODITIES: f.asset(COMMODITIES, "COMMODITIES", name="Commodities ETF"),
            f.EQUITY: f.asset(f.EQUITY, "EQUITY_DEVELOPED"),
        }
        prices = {
            GLOBAL_EQUITY: f.price(GLOBAL_EQUITY, "1", n=61),
            COMMODITIES: f.price(COMMODITIES, "1", n=62),
            f.EQUITY: f.price(f.EQUITY, "1", n=1),
        }
        holdings = [
            Holding(asset_id=GLOBAL_EQUITY, quantity=f.quantity("10")),  # 10%, breaches
            Holding(asset_id=COMMODITIES, quantity=f.quantity("20")),  # 20%, breaches, worst
            Holding(asset_id=f.EQUITY, quantity=f.quantity("70")),  # targeted, excluded
        ]
        breakdown = compute_allocation(
            holdings, assets, prices, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
        )
        allocation = {
            asset_class: Bound(value=line, source=SourceRef.derived(engine="portfolio"))
            for asset_class, line in breakdown.lines.items()
        }
        targets = f.flat_targets(("EQUITY_DEVELOPED", "1.0", f.absolute("0.9")))
        comp = compute_drift(breakdown, targets, strategy_version_id=f.VERSION)
        facts = FactSet(
            as_of=f.AS_OF, scope=f.BUCKET_SCOPE, allocation=allocation, drift=comp.lines
        )

        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.FIRED
        # worst affected: COMMODITIES at 20% / 5% threshold = 4.00
        assert firing.severity == Decimal("4.00000000")
        expected_labels = ", ".join(label(ac) for ac in sorted(("COMMODITIES", "EQUITY_GLOBAL")))
        assert firing.trace.message_bindings["asset_class_labels"] == expected_labels

    def test_severity_is_monotonic_in_the_breach_magnitude(self) -> None:
        """MAJOR 7 (review): a representative monotonicity case per formula-bearing kind."""
        (nearer,) = evaluate(
            (_untargeted_allocation_rule("0.05"),), _untargeted_allocation_facts("6", "94")
        )
        (further,) = evaluate(
            (_untargeted_allocation_rule("0.05"),), _untargeted_allocation_facts("20", "80")
        )
        assert nearer.severity is not None
        assert further.severity is not None
        assert nearer.severity < further.severity


# --------------------------------------------------------------------------------------
# unassigned_residual_above
# --------------------------------------------------------------------------------------


def _residual_facts(residual_weight: str) -> FactSet:
    return FactSet(
        as_of=f.AS_OF,
        scope=PORTFOLIO_SCOPE,
        residual=Bound(
            value=Decimal(residual_weight), source=SourceRef.derived(engine="portfolio")
        ),
    )


def _residual_rule(threshold_weight: str = "0.10") -> Rule:
    return Rule(
        id=f.rule_id(1),
        name="Capitale non apportionato",
        priority=Priority.MEDIUM,
        suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
        message="residuo",
        condition=LeafCondition(
            kind="unassigned_residual_above",
            kind_version=1,
            params={"threshold_weight": threshold_weight},
        ),
    )


class TestUnassignedResidualAbove:
    def test_threshold_weight_zero_is_rejected_at_construction(self) -> None:
        with pytest.raises(ValidationError):
            UnassignedResidualAboveParams(threshold_weight=Decimal(0))

    def test_the_ux_0001_fixture_anchor(self) -> None:
        """UX-0001 §8.3: 12.16% against a 10.00% threshold -> 1.22 (ADR-L02 §4.2)."""
        (firing,) = evaluate((_residual_rule("0.10"),), _residual_facts("0.1216"))
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("1.21600000")

    def test_exactly_at_the_threshold_does_not_fire(self) -> None:
        (firing,) = evaluate((_residual_rule("0.10"),), _residual_facts("0.10"))
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("1.00000000")

    def test_a_negative_residual_deficit_does_not_fire_and_severity_is_not_abs(self) -> None:
        """ADR-L02 §4.2 'On negative residuals': no `abs()`, deliberately."""
        (firing,) = evaluate((_residual_rule("0.10"),), _residual_facts("-0.05"))
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("-0.50000000")

    def test_severity_is_monotonic_in_the_residual(self) -> None:
        """MAJOR 7 (review): a representative monotonicity case per formula-bearing kind."""
        (nearer,) = evaluate((_residual_rule("0.10"),), _residual_facts("0.11"))
        (further,) = evaluate((_residual_rule("0.10"),), _residual_facts("0.30"))
        assert nearer.severity is not None
        assert further.severity is not None
        assert nearer.severity < further.severity


# --------------------------------------------------------------------------------------
# allocation_absent
# --------------------------------------------------------------------------------------


def _allocation_absent_facts(*positions: tuple[AssetId, str]) -> FactSet:
    from tests.test_strategy_engine import allocation_of

    computation = compute_drift(
        allocation_of(*positions), f.DEMO_TARGETS, strategy_version_id=f.VERSION
    )
    return FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, drift=computation.lines)


def _allocation_absent_rule(asset_class: str = "EQUITY_DEVELOPED") -> Rule:
    return Rule(
        id=f.rule_id(1),
        name="Classe assente",
        priority=Priority.LOW,
        suggestion_class=SuggestionClass.REVIEW_ALLOCATION,
        message="assente",
        condition=LeafCondition(
            kind="allocation_absent",
            kind_version=1,
            params={"asset_class": asset_class, "scope": f.BUCKET_SCOPE.ref},
        ),
    )


class TestAllocationAbsent:
    def test_a_targeted_class_held_at_zero_fires_with_no_severity(self) -> None:
        facts = _allocation_absent_facts((f.BOND, "100"))  # EQUITY_DEVELOPED unheld
        (firing,) = evaluate((_allocation_absent_rule("EQUITY_DEVELOPED"),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity is None

    def test_a_held_targeted_class_does_not_fire(self) -> None:
        facts = _allocation_absent_facts((f.EQUITY, "34"), (f.BOND, "66"))
        (firing,) = evaluate((_allocation_absent_rule("EQUITY_DEVELOPED"),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_does_not_skip_when_only_the_drift_family_is_flagged_unavailable(self) -> None:
        """MAJOR 6 (review): `allocation_absent` declares `allocation` in `required_facts`,
        not `drift` — an unrelated rule's `drift`-family outage (zero portfolio value, an
        unpriced asset elsewhere in scope) must not gate this kind, since its own class line
        is fine here regardless."""
        from tests.test_strategy_engine import allocation_of

        computation = compute_drift(
            allocation_of((f.BOND, "100")), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        facts = FactSet(
            as_of=f.AS_OF,
            scope=f.BUCKET_SCOPE,
            drift=computation.lines,
            unavailable={"drift": SkipReason.ZERO_PORTFOLIO_VALUE},
        )
        (firing,) = evaluate((_allocation_absent_rule("EQUITY_DEVELOPED"),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity is None


# --------------------------------------------------------------------------------------
# bucket_below_target_value
# --------------------------------------------------------------------------------------


def _bucket_value_facts(amount: str, *, currency: str = "EUR") -> FactSet:
    return FactSet(
        as_of=f.AS_OF,
        scope=f.BUCKET_SCOPE,
        bucket_value=Bound(
            value=f.money(amount, currency), source=SourceRef.derived(engine="portfolio")
        ),
    )


def _bucket_below_target_value_rule(target_amount: str = "24000.00") -> Rule:
    return Rule(
        id=f.rule_id(1),
        name="Fondo sotto il target",
        priority=Priority.CRITICAL,
        suggestion_class=SuggestionClass.REVIEW_LIQUIDITY,
        message="sotto il target",
        condition=LeafCondition(
            kind="bucket_below_target_value",
            kind_version=1,
            params={
                "bucket": f.BUCKET_SCOPE.ref,
                "target_amount": target_amount,
                "target_currency": "EUR",
            },
        ),
    )


class TestBucketBelowTargetValue:
    def test_target_amount_zero_is_rejected_at_construction(self) -> None:
        with pytest.raises(ValidationError):
            BucketBelowTargetValueParams(
                bucket="x", target_amount=Decimal(0), target_currency="EUR"
            )

    def test_negative_target_amount_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            BucketBelowTargetValueParams(
                bucket="x", target_amount=Decimal("-1"), target_currency="EUR"
            )

    def test_the_ux_0001_fixture_anchor(self) -> None:
        """UX-0001 §8.3/§8.4: €18,014.80 against a €24,000.00 target -> 1.25 (ADR-L02 §4.4)."""
        (firing,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("18014.80")
        )
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("1.24938333")

    def test_exactly_at_target_does_not_fire(self) -> None:
        (firing,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("24000.00")
        )
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("1.00000000")

    def test_an_empty_bucket_fires_at_the_worst_severity_not_skipped(self) -> None:
        (firing,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("0")
        )
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("2.00000000")

    def test_no_binding_in_the_trace_is_unsourced(self) -> None:
        """D8: every step operand must trace to a binding, never a fabricated literal."""
        (firing,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("18014.80")
        )
        bound_names = {binding.name for binding in firing.trace.bindings}
        step_outputs = {step_.out for step_ in firing.trace.steps}
        for step in firing.trace.steps:
            for name in step.inputs:
                assert name.partition(".")[0] in bound_names | step_outputs

    def test_currency_mismatch_errors_rather_than_computing_a_bogus_severity(self) -> None:
        """MAJOR 4 (review, I-15): `fact.value.currency` vs `target_currency` must be checked
        before any arithmetic — a mismatch is `Outcome.ERROR` with a NULL severity, never a
        ratio computed across currencies."""
        facts = _bucket_value_facts("18014.80", currency="USD")
        (firing,) = evaluate((_bucket_below_target_value_rule("24000.00"),), facts)
        assert firing.outcome is Outcome.ERROR
        assert firing.severity is None

    def test_severity_is_monotonic_in_the_shortfall(self) -> None:
        """MAJOR 7 (review): a representative monotonicity case per formula-bearing kind."""
        (at_target,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("24000.00")
        )
        (partial,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("18014.80")
        )
        (empty,) = evaluate(
            (_bucket_below_target_value_rule("24000.00"),), _bucket_value_facts("0")
        )
        assert at_target.severity is not None
        assert partial.severity is not None
        assert empty.severity is not None
        assert at_target.severity < partial.severity < empty.severity


# --------------------------------------------------------------------------------------
# over_apportioned
# --------------------------------------------------------------------------------------

FUND = AssetId(UUID(int=70))


def _apportionment_line(
    apportioned: str, holding: str, asset_id: AssetId = FUND
) -> ApportionmentLine:
    return ApportionmentLine(
        asset_id=asset_id,
        apportioned_quantity=Decimal(apportioned),
        holding_quantity=Decimal(holding),
    )


def _over_apportioned_facts(*lines: ApportionmentLine) -> FactSet:
    apportionment = {
        line.asset_id: Bound(value=line, source=SourceRef.derived(engine="portfolio"))
        for line in lines
    }
    return FactSet(as_of=f.AS_OF, scope=PORTFOLIO_SCOPE, apportionment=apportionment)


def _over_apportioned_rule() -> Rule:
    return Rule(
        id=f.rule_id(1),
        name="Sovra-apportionment",
        priority=Priority.HIGH,
        suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
        message="sovra-apportionment",
        condition=LeafCondition(
            kind="over_apportioned",
            kind_version=1,
            params={"scope": PORTFOLIO_SCOPE.ref},
        ),
    )


class TestOverApportioned:
    def test_the_ux_0001_fixture_anchor(self) -> None:
        """UX-0001 §8.2/ADR-L04 §4.1: 53 committed against 46 held -> 1.13207547."""
        facts = _over_apportioned_facts(_apportionment_line("53", "46"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("1.13207547")

    def test_at_the_threshold_apportioned_equals_holding_does_not_fire(self) -> None:
        facts = _over_apportioned_facts(_apportionment_line("53", "53"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_holding_zero_fires_at_the_worst_severity_not_skipped(self) -> None:
        """ADR-L04 §4.1/§4.3: H=0 is the kind's most severe, reachable state — FIRED, not
        SKIPPED(zero_denominator)."""
        facts = _over_apportioned_facts(_apportionment_line("53", "0"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("2.00000000")
        assert firing.skip_reason is None

    def test_an_empty_affected_set_does_not_fire_with_no_severity(self) -> None:
        """Every asset in scope is covered -> NOT_FIRED, severity is None (ADR-L04 §4.3)."""
        facts = _over_apportioned_facts(_apportionment_line("40", "46"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_nothing_apportioned_anywhere_in_scope_does_not_fire(self) -> None:
        facts = _over_apportioned_facts()
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity is None

    def test_unresolvable_apportionment_is_skipped_never_not_fired(self) -> None:
        facts = FactSet(
            as_of=f.AS_OF,
            scope=PORTFOLIO_SCOPE,
            unavailable={"apportionment": SkipReason.MISSING_FACT},
        )
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.SKIPPED

    def test_a_surplus_on_one_asset_never_masks_a_deficit_on_another(self) -> None:
        """I-9 is per-Asset: the predicate stays per-asset even though severity aggregates."""
        surplus_asset = AssetId(UUID(int=71))
        facts = _over_apportioned_facts(
            _apportionment_line("53", "46", asset_id=FUND),
            _apportionment_line("10", "40", asset_id=surplus_asset),  # not affected: A < H
        )
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.FIRED
        # Severity is computed only over the affected asset (FUND), unaffected by the surplus.
        assert firing.severity == Decimal("1.13207547")

    def test_two_affected_assets_aggregate_severity(self) -> None:
        facts = _over_apportioned_facts(
            _apportionment_line("53", "46", asset_id=FUND),
            _apportionment_line("100", "95", asset_id=AssetId(UUID(int=72))),
        )
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.FIRED
        # coverage = (46+95)/(53+100) = 141/153 -> severity = 2 - coverage
        assert firing.severity == Decimal("1.07843137")

    def test_the_final_step_is_the_any_predicate_and_is_boolean(self) -> None:
        facts = _over_apportioned_facts(_apportionment_line("53", "46"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.trace.steps[-1].op.value == "any"
        assert isinstance(firing.trace.steps[-1].value, bool)

    def test_severity_is_a_strict_lower_bound_approached_in_the_limit(self) -> None:
        """ADR-L04 §4.5: the firing range is the *open* interval `(1, 2]`. A tiny deficit
        fires with severity close to, but never equal to, `1.00000000` — at `A == H` exactly
        the asset drops out of the affected set (empty-affected-set `NOT_FIRED`), so `1.00` is
        a limit, never an attained value."""
        facts = _over_apportioned_facts(_apportionment_line("1000000", "999999"))
        (firing,) = evaluate((_over_apportioned_rule(),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity is not None
        assert Decimal("1.00000000") < firing.severity < Decimal("1.00000200")


class TestComputeApportionment:
    """`portfolio_engine.compute_apportionment` (ADR-L04 §4.4/§6.1)."""

    def test_resolves_the_latest_applicable_row_per_bucket_asset(self) -> None:
        original = ApportionmentRecord(
            id=UUID(int=1),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("30"),
            effective_from=date(2026, 1, 1),
            recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
        )
        superseding = ApportionmentRecord(
            id=UUID(int=2),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("53"),
            effective_from=date(2026, 2, 1),
            supersedes_id=UUID(int=1),
            recorded_at=datetime.fromisoformat("2026-02-01T00:00:00+00:00"),
        )
        holdings = [Holding(asset_id=FUND, quantity=f.quantity("46"))]
        lines = compute_apportionment(
            [original, superseding], holdings, as_of=f.AS_OF, scope=PORTFOLIO_SCOPE
        )
        assert lines == (
            ApportionmentLine(
                asset_id=FUND, apportioned_quantity=Decimal("53"), holding_quantity=Decimal("46")
            ),
        )

    def test_a_superseding_row_that_zeroes_the_quantity_emits_no_line(self) -> None:
        """D5/§6.1's property: no line where `apportioned_quantity == 0`."""
        original = ApportionmentRecord(
            id=UUID(int=1),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("30"),
            effective_from=date(2026, 1, 1),
            recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
        )
        zeroed = ApportionmentRecord(
            id=UUID(int=2),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("0"),
            effective_from=date(2026, 2, 1),
            supersedes_id=UUID(int=1),
            recorded_at=datetime.fromisoformat("2026-02-01T00:00:00+00:00"),
        )
        holdings = [Holding(asset_id=FUND, quantity=f.quantity("46"))]
        lines = compute_apportionment(
            [original, zeroed], holdings, as_of=f.AS_OF, scope=PORTFOLIO_SCOPE
        )
        assert lines == ()

    def test_a_row_after_as_of_is_ignored(self) -> None:
        early = ApportionmentRecord(
            id=UUID(int=1),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("53"),
            effective_from=date(2026, 1, 1),
            recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
        )
        future = ApportionmentRecord(
            id=UUID(int=2),
            bucket_id=f.BUCKET,
            asset_id=FUND,
            quantity=f.quantity("99"),
            effective_from=date(2099, 1, 1),
            supersedes_id=UUID(int=1),
            recorded_at=datetime.fromisoformat("2099-01-01T00:00:00+00:00"),
        )
        holdings = [Holding(asset_id=FUND, quantity=f.quantity("46"))]
        lines = compute_apportionment(
            [early, future], holdings, as_of=f.AS_OF, scope=PORTFOLIO_SCOPE
        )
        assert lines[0].apportioned_quantity == Decimal("53.0000000000")

    @given(st.lists(APPORTIONED_QUANTITIES, min_size=1, max_size=6))
    def test_property_every_emitted_line_has_apportioned_quantity_above_zero(
        self, quantities: list[Decimal]
    ) -> None:
        """MAJOR 5 (review): the old example test gave each record a distinct Asset, so it
        never exercised the same-Asset accumulation `compute_apportionment` actually performs
        across Buckets — negative per-bucket quantities and a cancelling sum could never
        arise. Each generated quantity here is a *different Bucket's* chain for the *same*
        Asset, so Hypothesis can and does generate both."""
        records = [
            ApportionmentRecord(
                id=UUID(int=500 + index),
                bucket_id=BucketId(UUID(int=600 + index)),
                asset_id=FUND,
                quantity=Quantity(amount=quantity),
                effective_from=date(2026, 1, 1),
                recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
            )
            for index, quantity in enumerate(quantities)
        ]
        lines = compute_apportionment(records, [], as_of=f.AS_OF, scope=PORTFOLIO_SCOPE)
        assert all(line.apportioned_quantity > 0 for line in lines)

    def test_a_cancelling_sum_across_two_buckets_emits_no_line(self) -> None:
        """ΣA == 0 for one Asset across two Buckets' chains: not a line, not a zero line."""
        records = [
            ApportionmentRecord(
                id=UUID(int=501),
                bucket_id=BucketId(UUID(int=601)),
                asset_id=FUND,
                quantity=Quantity(amount=Decimal("30")),
                effective_from=date(2026, 1, 1),
                recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
            ),
            ApportionmentRecord(
                id=UUID(int=502),
                bucket_id=BucketId(UUID(int=602)),
                asset_id=FUND,
                quantity=Quantity(amount=Decimal("-30")),
                effective_from=date(2026, 1, 1),
                recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
            ),
        ]
        lines = compute_apportionment(records, [], as_of=f.AS_OF, scope=PORTFOLIO_SCOPE)
        assert lines == ()


# --------------------------------------------------------------------------------------
# Shared fixture map, consumed by tests/test_condition_registry.py
# --------------------------------------------------------------------------------------

FIRING_FIXTURES: dict[str, tuple[Rule, FactSet]] = {
    "untargeted_allocation": (
        _untargeted_allocation_rule("0.05"),
        _untargeted_allocation_facts("10", "90"),
    ),
    "unassigned_residual_above": (_residual_rule("0.10"), _residual_facts("0.1216")),
    "allocation_absent": (
        _allocation_absent_rule("EQUITY_DEVELOPED"),
        _allocation_absent_facts((f.BOND, "100")),
    ),
    "bucket_below_target_value": (
        _bucket_below_target_value_rule("24000.00"),
        _bucket_value_facts("18014.80"),
    ),
    "over_apportioned": (
        _over_apportioned_rule(),
        _over_apportioned_facts(_apportionment_line("53", "46")),
    ),
}

#: Kinds that declare a `severity` formula, each at the exact boundary of its own firing
#: threshold: `NOT_FIRED`, `severity == 1.00000000` (ADR-L02 §4.6 / ADR-L04 §4.5, §4.7's
#: generalized registry property). `allocation_absent` declares `severity = None` and has no
#: anchor to check. `over_apportioned` and `untargeted_allocation` are documented exceptions
#: (ADR-L04 §4.5, ADR-L05 §3 respectively — see `OPEN_INTERVAL_KINDS` in
#: `test_condition_registry.py`): their firing ranges are *open* — the sole/worst candidate
#: exactly at its threshold drops out of the affected set entirely (the empty-affected-set
#: `NOT_FIRED`/`severity = None` case), so `1.00` is approached only in the limit, never
#: attained on any row. See `TestOverApportioned.test_severity_is_a_strict_lower_bound_...`
#: and `TestUntargetedAllocation.test_the_boundary_is_a_limit_never_attained_on_a_fired_row`.
ANCHOR_FIXTURES: dict[str, tuple[Rule, FactSet]] = {
    "unassigned_residual_above": (_residual_rule("0.10"), _residual_facts("0.10")),
    "bucket_below_target_value": (
        _bucket_below_target_value_rule("24000.00"),
        _bucket_value_facts("24000.00"),
    ),
}
