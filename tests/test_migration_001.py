"""Executes migrations/001_init.sql and exercises ADR-L01's truth table.

Every combination of (corrects_id, transfer_pair_id, cash_leg_of) from
ADR-L01 §4.2 is asserted here: legal shapes must insert, illegal shapes must
be rejected by a CHECK constraint. Also covers the two ADR-L01 defect fixes
(mv_holding's dropped type filter and the portfolio_account join column) and
that mv_holding / mv_finding are creatable and selectable.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from pathlib import Path

import duckdb
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

NOW = datetime.datetime(2026, 1, 1, 12, 0, 0)
TRADE_DATE = datetime.date(2026, 1, 1)


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute(MIGRATION_PATH.read_text())
    yield connection
    connection.close()


@pytest.fixture
def seeded(con: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyConnection:
    """A connection with one asset/CASH pair, one account, one portfolio."""
    con.execute("INSERT INTO asset VALUES ('cash', 'Cash EUR', 'CASH', 'EUR', '[]')")
    con.execute("INSERT INTO asset VALUES ('etf', 'Some ETF', 'EQUITY_DEVELOPED', 'EUR', '[]')")
    con.execute("INSERT INTO asset VALUES ('etf2', 'Other ETF', 'EQUITY_DEVELOPED', 'EUR', '[]')")
    con.execute("INSERT INTO account VALUES ('acc1', 'Main', 'BROKERAGE', 'EUR', 'cash')")
    con.execute("INSERT INTO account VALUES ('acc2', 'Other', 'BROKERAGE', 'EUR', 'cash')")
    con.execute("INSERT INTO portfolio VALUES ('p1', 'My Portfolio')")
    con.execute("INSERT INTO portfolio_account VALUES ('p1', 'acc1')")
    con.execute("INSERT INTO portfolio_account VALUES ('p1', 'acc2')")
    return con


def insert_operation(
    con: duckdb.DuckDBPyConnection,
    id_: str,
    type_: str,
    quantity: float,
    *,
    account_id: str = "acc1",
    asset_id: str = "etf",
    corrects_id: str | None = None,
    transfer_pair_id: str | None = None,
    cash_leg_of: str | None = None,
    price: float | None = None,
) -> None:
    con.execute(
        """
        INSERT INTO operation
            (id, type, account_id, asset_id, trade_date, quantity, price, fees,
             currency, import_batch_id, corrects_id, transfer_pair_id, cash_leg_of,
             recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'EUR', NULL, ?, ?, ?, ?)
        """,
        [
            id_,
            type_,
            account_id,
            asset_id,
            TRADE_DATE,
            quantity,
            price,
            corrects_id,
            transfer_pair_id,
            cash_leg_of,
            NOW,
        ],
    )


# ---------------------------------------------------------------------------
# Migration applies cleanly / schema_version
# ---------------------------------------------------------------------------


def test_migration_applies_cleanly(con: duckdb.DuckDBPyConnection) -> None:
    tables = {row[0] for row in con.execute("SHOW TABLES").fetchall()}
    assert "operation" in tables
    assert "schema_version" in tables


def test_schema_version_is_1(con: duckdb.DuckDBPyConnection) -> None:
    assert con.execute("SELECT version FROM schema_version").fetchall() == [(1,)]


# ---------------------------------------------------------------------------
# ADR-L01 §4.2 truth table over (corrects_id, transfer_pair_id, cash_leg_of)
# Rows 1-8, LEGAL / ILLEGAL exactly as documented.
# ---------------------------------------------------------------------------


def test_row1_primary_all_null_is_legal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 10)  # quantity > 0, no links


def test_row2_cash_leg_only_is_legal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 10)
    # cash leg: carries parent's type (BUY), exempt from sign check, negative qty
    insert_operation(
        seeded, "op1-leg", "BUY", -1000, asset_id="cash", cash_leg_of="op1", price=1
    )


def test_row3_transfer_pair_side_only_is_legal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(
        seeded, "out1", "TRANSFER_OUT", -5, account_id="acc1", transfer_pair_id="pair1"
    )
    insert_operation(
        seeded, "in1", "TRANSFER_IN", 5, account_id="acc2", transfer_pair_id="pair1"
    )


def test_row4_pair_id_with_cash_leg_of_is_illegal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(
        seeded, "out1", "TRANSFER_OUT", -5, account_id="acc1", transfer_pair_id="pair1"
    )
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(
            seeded,
            "bad",
            "TRANSFER_OUT",
            -1,
            account_id="acc1",
            transfer_pair_id="pair1",
            cash_leg_of="out1",
        )


def test_row5_correction_primary_only_is_legal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 100)
    insert_operation(seeded, "corr1", "CORRECTION", -10, corrects_id="op1")


def test_row6_correction_cash_side_is_legal_and_mandatory_shape(
    seeded: duckdb.DuckDBPyConnection,
) -> None:
    insert_operation(seeded, "op1", "BUY", 100)
    insert_operation(
        seeded, "op1-leg", "BUY", -1000, asset_id="cash", cash_leg_of="op1", price=1
    )
    insert_operation(seeded, "corr1", "CORRECTION", -10, corrects_id="op1")
    # cash side of the correction: corrects_id -> original leg, cash_leg_of -> sibling correction
    insert_operation(
        seeded,
        "corr1-leg",
        "CORRECTION",
        100,
        asset_id="cash",
        corrects_id="op1-leg",
        cash_leg_of="corr1",
        price=1,
    )


def test_row7_correction_with_pair_id_is_illegal(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 100)
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(
            seeded, "bad", "CORRECTION", -10, corrects_id="op1", transfer_pair_id="pair1"
        )


def test_row8_correction_with_pair_and_leg_is_illegal(
    seeded: duckdb.DuckDBPyConnection,
) -> None:
    insert_operation(seeded, "op1", "BUY", 100)
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(
            seeded,
            "bad",
            "CORRECTION",
            -10,
            corrects_id="op1",
            transfer_pair_id="pair1",
            cash_leg_of="op1",
        )


# ---------------------------------------------------------------------------
# N2/N3/N4 nullability rules and the seven-value type CHECK
# ---------------------------------------------------------------------------


def test_n2_pair_id_only_on_transfer_types(seeded: duckdb.DuckDBPyConnection) -> None:
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(seeded, "bad", "BUY", 10, transfer_pair_id="pair1")


def test_n3_transfer_row_must_be_pair_side_or_leg(seeded: duckdb.DuckDBPyConnection) -> None:
    # TRANSFER_OUT with neither transfer_pair_id nor cash_leg_of
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(seeded, "bad", "TRANSFER_OUT", -5)


def test_n4_no_self_reference_corrects_id(seeded: duckdb.DuckDBPyConnection) -> None:
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(seeded, "op1", "CORRECTION", -10, corrects_id="op1")


def test_type_domain_rejects_unknown_type(seeded: duckdb.DuckDBPyConnection) -> None:
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(seeded, "bad", "DEPOSIT", 10)


def test_type_domain_accepts_all_seven_values(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "buy1", "BUY", 1)
    insert_operation(seeded, "sell1", "SELL", -1)
    insert_operation(seeded, "div1", "DIVIDEND", 0)
    insert_operation(seeded, "cpn1", "COUPON", 0)
    insert_operation(seeded, "out1", "TRANSFER_OUT", -1, transfer_pair_id="pairA")
    insert_operation(
        seeded, "in1", "TRANSFER_IN", 1, account_id="acc2", transfer_pair_id="pairA"
    )
    insert_operation(seeded, "corr1", "CORRECTION", -1, corrects_id="buy1")


# ---------------------------------------------------------------------------
# Sign-check exemptions
# ---------------------------------------------------------------------------


def test_buy_negative_cash_leg_inserts(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 10)
    # exempt: cash leg of a BUY is negative
    insert_operation(
        seeded, "op1-leg", "BUY", -1000, asset_id="cash", cash_leg_of="op1", price=1
    )


def test_buy_primary_with_negative_quantity_is_rejected(
    seeded: duckdb.DuckDBPyConnection,
) -> None:
    with pytest.raises(duckdb.ConstraintException):
        insert_operation(seeded, "bad", "BUY", -10)


# ---------------------------------------------------------------------------
# mv_holding / mv_finding creatable and selectable
# ---------------------------------------------------------------------------


def test_mv_holding_selectable(seeded: duckdb.DuckDBPyConnection) -> None:
    insert_operation(seeded, "op1", "BUY", 10)
    rows = seeded.execute("SELECT * FROM mv_holding").fetchall()
    assert rows == [("etf", "p1", 10)]


def test_mv_holding_includes_dividend_cash_leg(seeded: duckdb.DuckDBPyConnection) -> None:
    """Regression for ADR-L01 defect 1: the type filter used to drop
    DIVIDEND/COUPON cash legs entirely, understating Net Worth."""
    insert_operation(seeded, "div1", "DIVIDEND", 0)
    insert_operation(
        seeded, "div1-leg", "DIVIDEND", 50, asset_id="cash", cash_leg_of="div1", price=1
    )
    rows = {(r[0], r[1]): r[2] for r in seeded.execute("SELECT * FROM mv_holding").fetchall()}
    assert rows[("cash", "p1")] == 50


def test_mv_finding_selectable(seeded: duckdb.DuckDBPyConnection) -> None:
    seeded.execute(
        "INSERT INTO strategy VALUES ('s1', 'Strategy 1', NULL, NULL)"
    )
    seeded.execute(
        """
        INSERT INTO strategy_version
            (id, strategy_id, parent_version_id, definition, change_note, frozen_at)
        VALUES ('sv1', 's1', NULL, '{}', 'initial', ?)
        """,
        [NOW],
    )
    seeded.execute(
        """
        INSERT INTO evaluation_run
            (id, portfolio_id, strategy_id, strategy_version_id, scope_kind, scope_id,
             as_of, evaluated_at, mode, engine_versions, input_digest)
        VALUES ('run1', 'p1', 's1', 'sv1', 'PORTFOLIO', 'p1', ?, ?, 'ACTUAL', '{}', 'digest1')
        """,
        [TRADE_DATE, NOW],
    )
    seeded.execute(
        """
        INSERT INTO alert
            (id, run_id, rule_id, outcome, priority, severity, trace, recorded_at)
        VALUES ('alert1', 'run1', 'rule1', 'FIRED', 'HIGH', 2.4, '{}', ?)
        """,
        [NOW],
    )
    seeded.execute(
        """
        INSERT INTO recommendation
            (id, alert_id, run_id, strategy_version_id, rule_id, finding_key,
             observation, rationale, suggestion_class, input_refs, recorded_at)
        VALUES ('rec1', 'alert1', 'run1', 'sv1', 'rule1', 'finding-key-1',
                'obs', 'because', NULL, '[]', ?)
        """,
        [NOW],
    )
    rows = seeded.execute("SELECT * FROM mv_finding").fetchall()
    assert len(rows) == 1
    row = rows[0]
    assert row[0] == "finding-key-1"  # finding_key
    assert row[2] == "rec1"  # first_recommendation_id
    assert row[3] == "rec1"  # latest_recommendation_id
    assert row[6] == 1  # occurrences
    assert float(row[7]) == pytest.approx(2.4)  # current_severity
