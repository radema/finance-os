"""Strategy Engine: drift, tolerance semantics, severity, and every documented edge case
(RFC-0007 §4.1, §10; RFC-0005 §8.4 task 7)."""

from collections.abc import Sequence
from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from financeos.core.engines.portfolio_engine import compute_allocation
from financeos.core.engines.strategy_engine import compute_drift, compute_targets
from financeos.core.portfolio import AllocationBreakdown, AllocationLine, Holding
from financeos.core.shared import AssetId, Money, SkipReason, Weight
from financeos.core.strategy import DriftLine, TargetAllocation
from tests import factories as f

ASSETS = {
    f.EQUITY: f.asset(f.EQUITY, "EQUITY_DEVELOPED"),
    f.BOND: f.asset(f.BOND, "BONDS_GOV_EUR"),
}
PRICES = {f.EQUITY: f.price(f.EQUITY, "100", n=1), f.BOND: f.price(f.BOND, "100", n=2)}


def allocation_of(*positions: tuple[AssetId, str], currency: str = "EUR") -> AllocationBreakdown:
    """An `AllocationBreakdown` from `(asset, quantity)` pairs valued at 100 each."""
    holdings = [
        Holding(asset_id=asset_id, quantity=f.quantity(qty), input_refs=(f"op:{asset_id}",))
        for asset_id, qty in positions
    ]
    return compute_allocation(
        holdings, ASSETS, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency=currency
    )


def line_for(targets: TargetAllocation, *positions: tuple[AssetId, str]) -> DriftLine:
    """The `EQUITY_DEVELOPED` drift line for a given allocation."""
    computation = compute_drift(allocation_of(*positions), targets, strategy_version_id=f.VERSION)
    return computation.lines["EQUITY_DEVELOPED"].value


class TestDriftArithmetic:
    def test_the_canonical_skeleton_finding(self) -> None:
        """RFC-0005 §8.3: 34.0% against a 40.0% target with a ±2.0pp band."""
        line = line_for(f.DEMO_TARGETS, (f.EQUITY, "34"), (f.BOND, "66"))
        assert line.current_value == f.money("3400")
        assert line.current_weight == Decimal("0.34000000")
        assert line.effective_target == Decimal("0.40000000")
        assert line.target_value == f.money("4000")
        assert line.drift == Decimal("-0.06000000")
        assert line.drift_value == f.money("-600")
        assert line.effective_band == Decimal("0.02000000")
        assert line.severity == Decimal("3.00000000")

    def test_every_binding_rfc0007_names_is_emitted(self) -> None:
        line = line_for(f.DEMO_TARGETS, (f.EQUITY, "34"), (f.BOND, "66"))
        assert set(DriftLine.model_fields) == {
            "asset_class",
            "current_value",
            "current_weight",
            "effective_target",
            "target_value",
            "drift",
            "drift_value",
            "tolerance",
            "effective_band",
            "severity",
        }
        assert line.tolerance == f.absolute("0.02")

    def test_facts_pin_the_strategy_version_and_the_allocation_inputs(self) -> None:
        computation = compute_drift(
            allocation_of((f.EQUITY, "34"), (f.BOND, "66")),
            f.DEMO_TARGETS,
            strategy_version_id=f.VERSION,
        )
        source = computation.lines["EQUITY_DEVELOPED"].source
        assert source.kind == "derived"
        assert source.engine == "strategy"
        assert source.inputs[0] == f"sv:{f.VERSION}"
        assert f"price:{PRICES[f.EQUITY].price_id}" in source.inputs

    def test_a_targeted_leaf_with_no_holding_drifts_by_its_whole_target(self) -> None:
        line = line_for(f.DEMO_TARGETS, (f.BOND, "100"))
        assert line.current_value == Money.zero("EUR")
        assert line.drift == Decimal("-0.40000000")
        assert line.severity == Decimal("20.00000000")

    def test_untargeted_holdings_stay_in_the_denominator(self) -> None:
        """RFC-0007 §4.1: the capital genuinely is there, so it dilutes every weight."""
        targets = f.flat_targets(("EQUITY_DEVELOPED", "1", f.absolute("0.02")))
        line = line_for(targets, (f.EQUITY, "50"), (f.BOND, "50"))
        assert line.current_weight == Decimal("0.50000000")
        assert line.drift == Decimal("-0.50000000")

    def test_drift_is_computed_at_leaves_of_a_deeper_tree(self) -> None:
        from financeos.core.strategy import TargetNode

        targets = TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY",
                    weight=f.weight("0.6"),
                    children=(
                        TargetNode(
                            key="EQUITY_DEVELOPED",
                            weight=f.weight("0.7"),
                            tolerance=f.absolute("0.02"),
                        ),
                        TargetNode(
                            key="BONDS_GOV_EUR",
                            weight=f.weight("0.3"),
                            tolerance=f.absolute("0.02"),
                        ),
                    ),
                ),
                TargetNode(key="CASH_EUR", weight=f.weight("0.4"), tolerance=f.absolute("0.02")),
            )
        )
        computation = compute_drift(
            allocation_of((f.EQUITY, "42"), (f.BOND, "58")),
            targets,
            strategy_version_id=f.VERSION,
        )
        assert set(computation.lines) == {"EQUITY_DEVELOPED", "BONDS_GOV_EUR", "CASH_EUR"}
        assert computation.lines["EQUITY_DEVELOPED"].value.effective_target == Decimal("0.42000000")
        assert computation.lines["EQUITY_DEVELOPED"].value.drift == Decimal("0.00000000")


class TestToleranceSemantics:
    def test_absolute_band_is_percentage_points(self) -> None:
        targets = f.flat_targets(
            ("EQUITY_DEVELOPED", "0.4", f.absolute("0.05")),
            ("BONDS_GOV_EUR", "0.6", f.absolute("0.05")),
        )
        line = line_for(targets, (f.EQUITY, "36"), (f.BOND, "64"))
        assert line.effective_band == Decimal("0.05000000")
        assert line.severity == Decimal("0.80000000")

    def test_relative_band_is_proportional_to_the_effective_target(self) -> None:
        targets = f.flat_targets(
            ("EQUITY_DEVELOPED", "0.04", f.relative("0.25")),
            ("BONDS_GOV_EUR", "0.96", f.absolute("0.05")),
        )
        line = line_for(targets, (f.EQUITY, "3"), (f.BOND, "97"))
        assert line.effective_target == Decimal("0.04000000")
        assert line.effective_band == Decimal("0.01000000")
        assert line.drift == Decimal("-0.01000000")
        assert line.severity == Decimal("1.00000000")

    def test_severity_is_exactly_one_at_the_band(self) -> None:
        line = line_for(f.DEMO_TARGETS, (f.EQUITY, "38"), (f.BOND, "62"))
        assert line.drift == Decimal("-0.02000000")
        assert line.severity == Decimal("1.00000000")

    @given(st.integers(min_value=0, max_value=40), st.integers(min_value=0, max_value=40))
    def test_severity_is_monotonic_in_the_absolute_drift(self, nearer: int, further: int) -> None:
        """RFC-0007 §10: severity is monotonically non-decreasing in |drift|."""
        lines = [
            line_for(f.DEMO_TARGETS, (f.EQUITY, str(40 - step)), (f.BOND, str(60 + step)))
            for step in (min(nearer, further), max(nearer, further))
        ]
        assert abs(lines[0].drift) <= abs(lines[1].drift)
        assert lines[0].severity is not None
        assert lines[1].severity is not None
        assert lines[0].severity <= lines[1].severity

    def test_a_zero_band_leaves_severity_undefined(self) -> None:
        """A RELATIVE band on a zero target: undefined, not infinite (ERR-1)."""
        targets = f.flat_targets(
            ("EQUITY_DEVELOPED", "0", f.relative("0.25")),
            ("BONDS_GOV_EUR", "1", f.absolute("0.05")),
        )
        line = line_for(targets, (f.EQUITY, "10"), (f.BOND, "90"))
        assert line.effective_band == Decimal(0)
        assert line.severity is None


class TestEdgeCases:
    def test_zero_portfolio_value_skips_rather_than_dividing(self) -> None:
        computation = compute_drift(allocation_of(), f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        assert computation.unavailable is SkipReason.ZERO_PORTFOLIO_VALUE
        assert computation.lines == {}
        assert not computation.is_available

    def test_an_incomplete_valuation_skips_with_missing_fact(self) -> None:
        allocation = compute_allocation(
            [
                Holding(asset_id=f.EQUITY, quantity=f.quantity("10")),
                Holding(asset_id=f.BOND, quantity=f.quantity("10")),
            ],
            ASSETS,
            {f.EQUITY: PRICES[f.EQUITY]},
            scope=f.BUCKET_SCOPE,
            as_of=f.AS_OF,
            currency="EUR",
        )
        computation = compute_drift(allocation, f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        assert computation.unavailable is SkipReason.MISSING_FACT
        assert computation.lines == {}

    def test_a_partial_denominator_is_never_produced(self) -> None:
        """The incomplete case must not fall back to valuing what it can."""
        hand_built = AllocationBreakdown(
            scope=f.BUCKET_SCOPE,
            as_of=f.AS_OF,
            total_value=f.money("1000"),
            lines={
                "EQUITY_DEVELOPED": AllocationLine(
                    asset_class="EQUITY_DEVELOPED",
                    value=f.money("1000"),
                    weight=Weight(value=Decimal(1)),
                )
            },
            unpriced_assets=(f.BOND,),
        )
        assert compute_drift(hand_built, f.DEMO_TARGETS, strategy_version_id=f.VERSION).lines == {}


class TestDeterminism:
    def test_the_same_allocation_yields_identical_facts(self) -> None:
        positions: Sequence[tuple[AssetId, str]] = ((f.EQUITY, "34"), (f.BOND, "66"))
        first = compute_drift(
            allocation_of(*positions), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        second = compute_drift(
            allocation_of(*positions), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        assert first == second


class TestComputeTargets:
    """ADR-L05 §5: the `targets` fact family `untargeted_allocation` tests membership
    against, independent of `drift`."""

    def test_resolves_one_bound_leaf_per_targeted_class(self) -> None:
        facts = compute_targets(f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        assert set(facts) == {"EQUITY_DEVELOPED", "BONDS_GOV_EUR"}
        assert facts["EQUITY_DEVELOPED"].value.effective_target == Decimal("0.40000000")
        assert facts["BONDS_GOV_EUR"].value.effective_target == Decimal("0.60000000")

    def test_an_untargeted_class_is_simply_absent(self) -> None:
        facts = compute_targets(f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        assert "COMMODITIES" not in facts

    def test_source_pins_the_strategy_version(self) -> None:
        facts = compute_targets(f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        assert facts["EQUITY_DEVELOPED"].source.inputs == (f"sv:{f.VERSION}",)
