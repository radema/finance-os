"""Portfolio Engine: the fold and the valuation (RFC-0005 §8.4 task 6)."""

from datetime import date
from decimal import Decimal

import pytest

from financeos.core.engines.portfolio_engine import (
    compute_allocation,
    compute_holdings,
    compute_residual,
)
from financeos.core.portfolio import ApportionmentLine, OperationType
from financeos.core.shared import AccountId, AssetId, Money, Scope, SkipReason
from financeos.core.shared.errors import CurrencyMismatchError
from tests import factories as f

ASSETS = {
    f.EQUITY: f.asset(f.EQUITY, "EQUITY_DEVELOPED"),
    f.BOND: f.asset(f.BOND, "BONDS_GOV_EUR"),
}
PRICES = {f.EQUITY: f.price(f.EQUITY, "100", n=1), f.BOND: f.price(f.BOND, "100", n=2)}


class TestComputeHoldings:
    def test_folds_signed_quantities(self) -> None:
        holdings = compute_holdings(
            [
                f.operation(1, qty="10"),
                f.operation(2, qty="5"),
                f.operation(3, qty="-4", op_type=OperationType.SELL),
            ],
            as_of=f.AS_OF,
        )
        assert len(holdings) == 1
        assert holdings[0].quantity.amount == Decimal(11)

    def test_carries_the_references_it_folded(self) -> None:
        holdings = compute_holdings([f.operation(1), f.operation(2)], as_of=f.AS_OF)
        assert holdings[0].input_refs == (
            f"op:{f.operation(1).id}",
            f"op:{f.operation(2).id}",
        )

    def test_ignores_operations_after_as_of(self) -> None:
        late = f.operation(1, trade_date=date(2026, 6, 1))
        assert compute_holdings([late], as_of=f.AS_OF) == ()

    def test_restricts_the_fold_to_the_given_accounts(self) -> None:
        other = AccountId(f.PORTFOLIO)
        holdings = compute_holdings(
            [f.operation(1, qty="10"), f.operation(2, qty="7", account_id=other)],
            as_of=f.AS_OF,
            accounts=[f.ACCOUNT],
        )
        assert holdings[0].quantity.amount == Decimal(10)

    def test_drops_positions_that_net_to_zero(self) -> None:
        holdings = compute_holdings(
            [f.operation(1, qty="10"), f.operation(2, qty="-10", op_type=OperationType.SELL)],
            as_of=f.AS_OF,
        )
        assert holdings == ()

    def test_is_deterministic_in_asset_order(self) -> None:
        forward = compute_holdings([f.operation(1), f.operation(2, asset_id=f.BOND)], as_of=f.AS_OF)
        reverse = compute_holdings([f.operation(2, asset_id=f.BOND), f.operation(1)], as_of=f.AS_OF)
        assert [h.asset_id for h in forward] == [h.asset_id for h in reverse]


class TestComputeAllocation:
    def test_values_and_groups_by_asset_class(self) -> None:
        holdings = compute_holdings(
            [f.operation(1, qty="34"), f.operation(2, asset_id=f.BOND, qty="66")], as_of=f.AS_OF
        )
        allocation = compute_allocation(
            holdings, ASSETS, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
        )
        assert allocation.total_value == f.money("10000")
        assert allocation.lines["EQUITY_DEVELOPED"].value == f.money("3400")
        assert allocation.lines["EQUITY_DEVELOPED"].weight.canonical() == "0.34000000"
        assert allocation.lines["BONDS_GOV_EUR"].weight.canonical() == "0.66000000"
        assert allocation.is_complete

    def test_two_assets_of_one_class_are_summed(self) -> None:
        assets = {**ASSETS, f.BOND: f.asset(f.BOND, "EQUITY_DEVELOPED")}
        holdings = compute_holdings(
            [f.operation(1, qty="10"), f.operation(2, asset_id=f.BOND, qty="10")], as_of=f.AS_OF
        )
        allocation = compute_allocation(
            holdings, assets, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
        )
        assert set(allocation.lines) == {"EQUITY_DEVELOPED"}
        assert allocation.lines["EQUITY_DEVELOPED"].value == f.money("2000")

    def test_line_carries_operation_and_price_references(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="10")], as_of=f.AS_OF)
        allocation = compute_allocation(
            holdings, ASSETS, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
        )
        refs = allocation.lines["EQUITY_DEVELOPED"].input_refs
        assert refs == (f"op:{f.operation(1).id}", f"price:{PRICES[f.EQUITY].price_id}")

    def test_an_unpriced_holding_makes_the_breakdown_incomplete(self) -> None:
        holdings = compute_holdings(
            [f.operation(1, qty="10"), f.operation(2, asset_id=f.BOND, qty="10")], as_of=f.AS_OF
        )
        allocation = compute_allocation(
            holdings,
            ASSETS,
            {f.EQUITY: PRICES[f.EQUITY]},
            scope=f.BUCKET_SCOPE,
            as_of=f.AS_OF,
            currency="EUR",
        )
        assert allocation.unpriced_assets == (f.BOND,)
        assert not allocation.is_complete

    def test_an_empty_scope_has_zero_value_and_no_lines(self) -> None:
        allocation = compute_allocation(
            [], ASSETS, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
        )
        assert allocation.total_value == Money.zero("EUR")
        assert allocation.lines == {}

    def test_i15_a_foreign_currency_price_is_a_domain_error(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="10")], as_of=f.AS_OF)
        with pytest.raises(CurrencyMismatchError):
            compute_allocation(
                holdings,
                ASSETS,
                {f.EQUITY: f.price(f.EQUITY, "100", currency="USD")},
                scope=f.BUCKET_SCOPE,
                as_of=f.AS_OF,
                currency="EUR",
            )

    def test_bucket_scope_is_valued_from_apportioned_virtual_holdings(self) -> None:
        """ADR-0025: drift reads VirtualHolding, which is derived, at the run's as_of."""
        from financeos.core.portfolio import VirtualHolding

        virtual = VirtualHolding(
            bucket_id=f.BUCKET,
            asset_id=f.EQUITY,
            quantity=f.quantity("4"),
            input_refs=("apportionment:0001",),
        )
        allocation = compute_allocation(
            [virtual.as_holding()],
            ASSETS,
            PRICES,
            scope=Scope.for_bucket(f.BUCKET),
            as_of=f.AS_OF,
            currency="EUR",
        )
        assert allocation.total_value == f.money("400")
        assert allocation.lines["EQUITY_DEVELOPED"].input_refs[0] == "apportionment:0001"

    def test_a_held_asset_with_no_definition_is_a_loading_defect(self) -> None:
        holdings = compute_holdings([f.operation(1, asset_id=AssetId(f.BUCKET))], as_of=f.AS_OF)
        with pytest.raises(KeyError):
            compute_allocation(
                holdings, ASSETS, PRICES, scope=f.BUCKET_SCOPE, as_of=f.AS_OF, currency="EUR"
            )


class TestComputeResidual:
    """ADR-0029: the `UNASSIGNED` residual, valued Portfolio-wide."""

    def test_fully_apportioned_holdings_have_zero_residual(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="34")], as_of=f.AS_OF)
        apportionment = [
            ApportionmentLine(
                asset_id=f.EQUITY, apportioned_quantity=Decimal(34), holding_quantity=Decimal(34)
            )
        ]
        comp = compute_residual(
            holdings, apportionment, ASSETS, PRICES, as_of=f.AS_OF, currency="EUR"
        )
        assert comp.is_available
        assert comp.residual_weight == Decimal("0.00000000")
        assert comp.unassigned_value == Money.zero("EUR")

    def test_a_partially_apportioned_holding_leaves_a_positive_residual(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="100")], as_of=f.AS_OF)
        apportionment = [
            ApportionmentLine(
                asset_id=f.EQUITY, apportioned_quantity=Decimal(88), holding_quantity=Decimal(100)
            )
        ]
        comp = compute_residual(
            holdings, apportionment, ASSETS, PRICES, as_of=f.AS_OF, currency="EUR"
        )
        assert comp.is_available
        # 12 unassigned of 100 held -> 12%.
        assert comp.residual_weight == Decimal("0.12000000")
        assert comp.unassigned_value == f.money("1200")

    def test_an_over_apportioned_holding_drives_the_residual_negative(self) -> None:
        """RFC-0010:123 / RFC-0011 §12.4 item 3: the signed residual may legitimately go
        negative when Σ apportioned exceeds the Holding (`over_apportioned`'s territory)."""
        holdings = compute_holdings([f.operation(1, qty="100")], as_of=f.AS_OF)
        apportionment = [
            ApportionmentLine(
                asset_id=f.EQUITY, apportioned_quantity=Decimal(110), holding_quantity=Decimal(100)
            )
        ]
        comp = compute_residual(
            holdings, apportionment, ASSETS, PRICES, as_of=f.AS_OF, currency="EUR"
        )
        assert comp.is_available
        assert comp.residual_weight == Decimal("-0.10000000")
        assert comp.unassigned_value == f.money("-1000")

    def test_an_asset_absent_from_apportionment_is_wholly_unassigned(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="34")], as_of=f.AS_OF)
        comp = compute_residual(holdings, [], ASSETS, PRICES, as_of=f.AS_OF, currency="EUR")
        assert comp.residual_weight == Decimal("1.00000000")
        assert comp.unassigned_value == f.money("3400")

    def test_an_unpriced_holding_is_missing_fact(self) -> None:
        holdings = compute_holdings(
            [f.operation(1, qty="34"), f.operation(2, asset_id=f.BOND, qty="66")], as_of=f.AS_OF
        )
        comp = compute_residual(
            holdings, [], ASSETS, {f.EQUITY: PRICES[f.EQUITY]}, as_of=f.AS_OF, currency="EUR"
        )
        assert not comp.is_available
        assert comp.unavailable is SkipReason.MISSING_FACT
        assert comp.residual_weight is None

    def test_a_zero_value_portfolio_is_zero_portfolio_value(self) -> None:
        comp = compute_residual([], [], ASSETS, PRICES, as_of=f.AS_OF, currency="EUR")
        assert not comp.is_available
        assert comp.unavailable is SkipReason.ZERO_PORTFOLIO_VALUE

    def test_i15_a_foreign_currency_price_is_a_domain_error(self) -> None:
        holdings = compute_holdings([f.operation(1, qty="10")], as_of=f.AS_OF)
        with pytest.raises(CurrencyMismatchError):
            compute_residual(
                holdings,
                [],
                ASSETS,
                {f.EQUITY: f.price(f.EQUITY, "100", currency="USD")},
                as_of=f.AS_OF,
                currency="EUR",
            )
