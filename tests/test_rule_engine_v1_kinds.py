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
    Outcome,
    Priority,
    Scope,
    SkipReason,
    SourceRef,
    SuggestionClass,
)
from financeos.core.strategy import LeafCondition, Rule
from tests import factories as f

PORTFOLIO_SCOPE = Scope.for_portfolio(f.PORTFOLIO)

# --------------------------------------------------------------------------------------
# untargeted_allocation
# --------------------------------------------------------------------------------------

GLOBAL_EQUITY = AssetId(UUID(int=60))


def _untargeted_allocation_facts(current_pct: str, held_pct: str) -> FactSet:
    """An `allocation` fact for one untargeted class at `current_pct`, plus a targeted class
    holding the rest, so the untargeted class's weight is exactly `current_pct`."""
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
    return FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, allocation=allocation)


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
                "asset_class": "EQUITY_GLOBAL",
                "scope": f.BUCKET_SCOPE.ref,
                "threshold_weight": threshold_weight,
            },
        ),
    )


class TestUntargetedAllocation:
    def test_threshold_weight_zero_is_rejected_at_construction(self) -> None:
        """D6 (ADR-L04 §4.7, ratified P30)."""
        with pytest.raises(ValidationError):
            UntargetedAllocationParams(
                asset_class="EQUITY_GLOBAL", scope="x", threshold_weight=Decimal(0)
            )

    def test_negative_threshold_weight_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UntargetedAllocationParams(
                asset_class="EQUITY_GLOBAL", scope="x", threshold_weight=Decimal("-0.05")
            )

    def test_exactly_at_the_threshold_does_not_fire_and_severity_is_one(self) -> None:
        facts = _untargeted_allocation_facts("5", "95")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("1.00000000")

    def test_above_the_threshold_fires(self) -> None:
        facts = _untargeted_allocation_facts("10", "90")
        (firing,) = evaluate((_untargeted_allocation_rule("0.05"),), facts)
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("2.00000000")

    def test_a_class_not_held_at_all_is_skipped_with_missing_fact(self) -> None:
        facts = _untargeted_allocation_facts("10", "90")
        rule = Rule(
            id=f.rule_id(1),
            name="x",
            priority=Priority.HIGH,
            suggestion_class=SuggestionClass.REVIEW_STRATEGY,
            message="x",
            condition=LeafCondition(
                kind="untargeted_allocation",
                kind_version=1,
                params={
                    "asset_class": "REAL_ESTATE",
                    "scope": f.BUCKET_SCOPE.ref,
                    "threshold_weight": "0.05",
                },
            ),
        )
        (firing,) = evaluate((rule,), facts)
        assert firing.outcome is Outcome.SKIPPED


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


# --------------------------------------------------------------------------------------
# bucket_below_target_value
# --------------------------------------------------------------------------------------


def _bucket_value_facts(amount: str) -> FactSet:
    return FactSet(
        as_of=f.AS_OF,
        scope=f.BUCKET_SCOPE,
        bucket_value=Bound(
            value=f.money(amount), source=SourceRef.derived(engine="portfolio")
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

    @pytest.mark.parametrize("n_buckets", [1, 2, 5])
    def test_property_every_emitted_line_has_apportioned_quantity_above_zero(
        self, n_buckets: int
    ) -> None:
        """The property that keeps `over_apportioned`'s severity denominator safe."""
        records = []
        for index in range(n_buckets):
            records.append(
                ApportionmentRecord(
                    id=UUID(int=100 + index),
                    bucket_id=f.BUCKET,
                    asset_id=AssetId(UUID(int=200 + index)),
                    quantity=f.quantity(str(index)),  # includes a zero quantity
                    effective_from=date(2026, 1, 1),
                    recorded_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
                )
            )
        holdings: list[Holding] = []
        lines = compute_apportionment(records, holdings, as_of=f.AS_OF, scope=PORTFOLIO_SCOPE)
        assert all(line.apportioned_quantity > 0 for line in lines)


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
#: anchor to check. `over_apportioned` is a documented exception (ADR-L04 §4.5): its firing
#: range is the *open* interval `(1, 2]` — an asset exactly at `A == H` drops out of the
#: affected set entirely (the empty-affected-set `NOT_FIRED`/`severity = None` case), so `1.00`
#: is approached only in the limit, never attained on any row. See
#: `TestOverApportioned.test_severity_is_a_strict_lower_bound_approached_in_the_limit`.
ANCHOR_FIXTURES: dict[str, tuple[Rule, FactSet]] = {
    "untargeted_allocation": (
        _untargeted_allocation_rule("0.05"),
        _untargeted_allocation_facts("5", "95"),
    ),
    "unassigned_residual_above": (_residual_rule("0.10"), _residual_facts("0.10")),
    "bucket_below_target_value": (
        _bucket_below_target_value_rule("24000.00"),
        _bucket_value_facts("24000.00"),
    ),
}
