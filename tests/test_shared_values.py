"""Shared-kernel value objects: exactness, I-15, and canonical form."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from financeos.core.shared import (
    Bound,
    BucketId,
    Money,
    Percentage,
    PortfolioId,
    Quantity,
    Scope,
    SourceRef,
    Weight,
    asset_class_label,
    canonical_json,
    sha256_hex,
)
from financeos.core.shared.errors import CurrencyMismatchError, FloatNotAllowedError

CURRENCIES = st.sampled_from(["EUR", "USD", "CHF", "GBP"])
AMOUNTS = st.decimals(
    min_value=Decimal("-1000000"), max_value=Decimal("1000000"), places=4, allow_nan=False
)


def money(amount: str, currency: str = "EUR") -> Money:
    return Money(amount=Decimal(amount), currency=currency)


class TestMoney:
    def test_quantizes_to_money_scale(self) -> None:
        assert money("10.5").canonical() == "10.5000"
        assert money("1.00005").canonical() == "1.0001"

    def test_negative_zero_has_one_canonical_form(self) -> None:
        assert money("-0.00001").canonical() == "0.0000"

    def test_arithmetic_is_exact(self) -> None:
        assert (money("0.1") + money("0.2")).amount == Decimal("0.3")
        assert (money("10") - money("2.5")).canonical() == "7.5000"
        assert (-money("3")).canonical() == "-3.0000"
        assert abs(money("-3")).canonical() == "3.0000"
        assert (money("10") * Decimal("0.4")).canonical() == "4.0000"

    def test_zero_and_is_zero(self) -> None:
        assert Money.zero("EUR").is_zero
        assert not money("0.0001").is_zero

    @given(AMOUNTS, CURRENCIES, AMOUNTS, CURRENCIES)
    def test_i15_arithmetic_requires_identical_currency(
        self, left: Decimal, left_ccy: str, right: Decimal, right_ccy: str
    ) -> None:
        a = Money(amount=left, currency=left_ccy)
        b = Money(amount=right, currency=right_ccy)
        if left_ccy == right_ccy:
            assert (a + b).currency == left_ccy
            assert (a - b).currency == left_ccy
        else:
            with pytest.raises(CurrencyMismatchError):
                a + b
            with pytest.raises(CurrencyMismatchError):
                a - b

    @pytest.mark.parametrize("bad", [1.5, 0.1, True])
    def test_float_and_bool_are_rejected(self, bad: object) -> None:
        with pytest.raises(ValidationError):
            Money(amount=bad, currency="EUR")  # type: ignore[arg-type]

    def test_float_factor_is_rejected(self) -> None:
        with pytest.raises(FloatNotAllowedError):
            money("1") * 0.5  # type: ignore[operator]

    @pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity"])
    def test_non_finite_is_rejected(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            Money(amount=Decimal(bad), currency="EUR")

    def test_value_beyond_declared_precision_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Money(amount=Decimal(10) ** 15, currency="EUR")

    def test_currency_must_be_iso4217_alphabetic(self) -> None:
        with pytest.raises(ValidationError):
            Money(amount=Decimal(1), currency="eur")

    def test_is_frozen(self) -> None:
        with pytest.raises(ValidationError):
            money("1").amount = Decimal(2)


class TestQuantity:
    def test_signed_quantities_and_scale(self) -> None:
        assert Quantity(amount=Decimal("-2.5")).canonical() == "-2.5000000000"
        assert (Quantity(amount=Decimal(3)) + Quantity(amount=Decimal("-1"))).amount == Decimal(2)
        assert (Quantity(amount=Decimal(3)) - Quantity(amount=Decimal(3))).is_zero
        assert (-Quantity(amount=Decimal(3))).amount == Decimal(-3)
        assert Quantity.zero().is_zero


class TestWeightAndPercentage:
    @pytest.mark.parametrize("value", ["0", "0.4", "1"])
    def test_unit_interval_is_accepted(self, value: str) -> None:
        assert Weight(value=Decimal(value)).value == Decimal(value)

    @pytest.mark.parametrize("value", ["-0.0001", "1.0001"])
    def test_outside_unit_interval_is_rejected(self, value: str) -> None:
        with pytest.raises(ValidationError):
            Weight(value=Decimal(value))

    def test_canonical_form_carries_declared_scale(self) -> None:
        assert Weight(value=Decimal("0.4")).canonical() == "0.40000000"

    def test_percentage_from_ratio(self) -> None:
        assert Percentage.from_ratio(Decimal("-0.06")).canonical() == "-6.00"
        assert Percentage.from_ratio(Decimal("0.4")).canonical() == "40.00"


class TestIdentityAndRefs:
    def test_scope_ref(self) -> None:
        bucket = BucketId(uuid4())
        assert Scope.for_bucket(bucket).ref == f"bucket:{bucket}"
        portfolio = PortfolioId(uuid4())
        assert Scope.for_portfolio(portfolio).ref == f"portfolio:{portfolio}"

    @pytest.mark.parametrize(
        ("code", "label"),
        [("EQUITY_DEVELOPED", "Equity/Developed"), ("BONDS", "Bonds"), ("GOV_EUR", "Gov/Eur")],
    )
    def test_asset_class_label(self, code: str, label: str) -> None:
        assert asset_class_label(code) == label


class TestCanonicalForm:
    def test_rules_of_canonicalization(self) -> None:
        rendered = canonical_json(
            {
                "b": Decimal("0.40000000"),
                "a": datetime(2026, 3, 12, 9, 30, tzinfo=UTC),
                "absent": None,
                "c": (True, "x"),
            }
        )
        assert rendered == '{"a":"2026-03-12T09:30:00+00:00","b":"0.40000000","c":[true,"x"]}'

    def test_mapping_order_does_not_change_the_digest(self) -> None:
        first = canonical_json({"x": "1", "y": "2"})
        second = canonical_json({"y": "2", "x": "1"})
        assert first == second
        assert sha256_hex(first) == sha256_hex(second)

    def test_unknown_type_has_no_canonical_form(self) -> None:
        with pytest.raises(TypeError):
            canonical_json({"bad": object()})


class TestBound:
    def test_age_measured_against_the_run_date(self) -> None:
        fact: Bound[Decimal] = Bound(
            value=Decimal("1"),
            source=SourceRef.derived(engine="strategy", inputs=["op:1"]),
            observed_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
        )
        assert fact.age(date(2026, 3, 8)) == timedelta(days=7)

    def test_age_is_none_without_an_observation_time(self) -> None:
        fact: Bound[Decimal] = Bound(value=Decimal("1"), source=SourceRef(kind="seed"))
        assert fact.age(date(2026, 3, 8)) is None

    def test_naive_timestamps_are_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Bound[Decimal](
                value=Decimal("1"),
                source=SourceRef(kind="seed"),
                observed_at=datetime(2026, 3, 1, 12, 0),  # noqa: DTZ001
            )

    def test_source_at_path_narrows_provenance(self) -> None:
        source = SourceRef.derived(engine="strategy", inputs=["sv:1"])
        assert source.at_path("drift.current_weight").path == "drift.current_weight"
        assert source.path is None
