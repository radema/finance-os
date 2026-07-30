"""it-IT display formatting (gap 2, L05 §7.3): punctuation only, never rounding surprises,
and never touching a word binding."""

from __future__ import annotations

from decimal import Decimal

from financeos.adapters.duckdb.queries.it_locale import (
    format_money_it,
    format_number_it,
    render_observation_it,
)


class TestFormatNumberIt:
    def test_comma_decimal_no_thousands_below_one_thousand(self) -> None:
        assert format_number_it(Decimal("40.00")) == "40,00"

    def test_dot_thousands_above_one_thousand(self) -> None:
        assert format_number_it(Decimal("-3240.0000")) == "-3.240,0000"

    def test_never_rounds_preserves_the_value_s_own_scale(self) -> None:
        assert format_number_it(Decimal("18360.0000")) == "18.360,0000"

    def test_a_whole_number_gets_no_trailing_comma(self) -> None:
        assert format_number_it(Decimal("100")) == "100"


class TestFormatMoneyIt:
    def test_the_net_worth_format_target(self) -> None:
        assert format_money_it(Decimal("107586.33")) == "€107.586,33"

    def test_negative_amounts_keep_the_sign_before_the_symbol(self) -> None:
        assert format_money_it(Decimal("-3240.0000")) == "-€3.240,00"

    def test_rounds_a_four_scale_money_amount_to_two_places(self) -> None:
        assert format_money_it(Decimal("18360.0000")) == "€18.360,00"


class TestRenderObservationIt:
    def test_localizes_only_the_declared_numeric_bindings(self) -> None:
        rendered = render_observation_it(
            "{asset_class_label} è al {current_pct}% ({drift_value} {currency}).",
            {
                "asset_class_label": "Equity/Developed",
                "current_pct": "34.00",
                "drift_value": "-3240.0000",
                "currency": "EUR",
            },
            frozenset({"current_pct", "drift_value"}),
        )
        assert rendered == "Equity/Developed è al 34,00% (-3.240,0000 EUR)."

    def test_a_bond_isin_in_a_word_binding_is_never_corrupted(self) -> None:
        """The trap C-L05-3 exists to close: `.replace(".", ",")` over prose would mangle an
        ISIN-bearing instrument name. Declaring bindings, not regexing values, prevents it."""
        rendered = render_observation_it(
            "Posizione «{asset_name}» sovra-assegnata.",
            {"asset_name": "BTP 3.85% 2035"},
            frozenset(),
        )
        assert rendered == "Posizione «BTP 3.85% 2035» sovra-assegnata."
