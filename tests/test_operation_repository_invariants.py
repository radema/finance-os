"""W1-W10 — the repository-enforced cross-row invariants (ADR-L01 §4.5, HANDOFF §3.4).

DuckDB's inline `CHECK`s enforce only what is row-local (the ADR-L01 truth table); everything
that spans rows is enforced here, in `DuckDBOperationRepository.write`, and is exercised by one
named test per invariant, before any non-BUY write.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import duckdb
import pytest

from financeos.adapters.duckdb.repositories.operation import DuckDBOperationRepository
from financeos.core.portfolio import Operation, OperationType
from financeos.core.shared import InvariantViolationError, OperationId, Quantity

MIGRATION_PATH = (
    __import__("pathlib").Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
TRADE_DATE = date(2026, 1, 1)
CASH = "00000000-0000-0000-0000-0000000000c1"
SECURITY = "00000000-0000-0000-0000-0000000000a1"
ACCOUNT_1 = "00000000-0000-0000-0000-000000000001"
ACCOUNT_2 = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    connection.execute("INSERT INTO asset VALUES (?, 'Cash EUR', 'CASH', 'EUR', '[]')", [CASH])
    connection.execute(
        "INSERT INTO asset VALUES (?, 'Some ETF', 'EQUITY_DEVELOPED', 'EUR', '[]')", [SECURITY]
    )
    connection.execute(
        "INSERT INTO account VALUES (?, 'Main', 'BROKERAGE', 'EUR', ?)", [ACCOUNT_1, CASH]
    )
    connection.execute(
        "INSERT INTO account VALUES (?, 'Other', 'BROKERAGE', 'EUR', ?)", [ACCOUNT_2, CASH]
    )
    yield connection
    connection.close()


@pytest.fixture
def repo(con: duckdb.DuckDBPyConnection) -> DuckDBOperationRepository:
    return DuckDBOperationRepository(con)


def _op(
    *,
    type_: OperationType,
    account_id: str = ACCOUNT_1,
    asset_id: str = SECURITY,
    quantity: str,
    price: str | None = "100",
    fees: str = "0",
    corrects_id: UUID | None = None,
    transfer_pair_id: UUID | None = None,
    cash_leg_of: UUID | None = None,
    import_batch_id: UUID,
) -> Operation:
    return Operation(
        id=OperationId(uuid4()),
        type=type_,
        account_id=account_id,  # type: ignore[arg-type]
        asset_id=asset_id,  # type: ignore[arg-type]
        trade_date=TRADE_DATE,
        quantity=Quantity(amount=Decimal(quantity)),
        price=Decimal(price) if price is not None else None,
        fees=Decimal(fees),
        currency="EUR",
        import_batch_id=import_batch_id,
        corrects_id=corrects_id,  # type: ignore[arg-type]
        transfer_pair_id=transfer_pair_id,
        cash_leg_of=cash_leg_of,  # type: ignore[arg-type]
        recorded_at=NOW,
    )


def _buy_with_leg(
    batch_id: UUID, *, quantity: str = "10", price: str = "100", leg_quantity: str | None = None
) -> tuple[Operation, Operation]:
    primary = _op(type_=OperationType.BUY, quantity=quantity, price=price, import_batch_id=batch_id)
    formula = -(Decimal(quantity) * Decimal(price))
    leg = _op(
        type_=OperationType.BUY,
        asset_id=CASH,
        quantity=str(leg_quantity if leg_quantity is not None else formula),
        price="1",
        cash_leg_of=primary.id,
        import_batch_id=batch_id,
    )
    return primary, leg


# ---------------------------------------------------------------------------
# W1 — leg totality
# ---------------------------------------------------------------------------


def test_w1_leg_totality_rejects_a_primary_with_no_leg(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    primary = _op(type_=OperationType.BUY, quantity="10", import_batch_id=batch_id)
    with pytest.raises(InvariantViolationError, match="W1"):
        repo.write([primary], import_batch_id=batch_id)


def test_w1_leg_totality_accepts_a_primary_with_exactly_one_leg(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_id = uuid4()
    primary, leg = _buy_with_leg(batch_id)
    repo.write([primary, leg], import_batch_id=batch_id)
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (2,)


# ---------------------------------------------------------------------------
# W2 — leg shape / amount formula
# ---------------------------------------------------------------------------


def test_w2_leg_amount_formula_is_enforced(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    primary, leg = _buy_with_leg(batch_id, quantity="10", price="100", leg_quantity="-999")
    with pytest.raises(InvariantViolationError, match="W2"):
        repo.write([primary, leg], import_batch_id=batch_id)


# ---------------------------------------------------------------------------
# W3 — no leg of a leg
# ---------------------------------------------------------------------------


def test_w3_no_leg_of_a_leg(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    primary, leg = _buy_with_leg(batch_id)
    leg_of_leg = _op(
        type_=OperationType.BUY,
        asset_id=CASH,
        quantity="1",
        price="1",
        cash_leg_of=leg.id,
        import_batch_id=batch_id,
    )
    with pytest.raises(InvariantViolationError, match="W3"):
        repo.write([primary, leg, leg_of_leg], import_batch_id=batch_id)


# ---------------------------------------------------------------------------
# W4 — transfer pair cardinality and nets-to-zero
# ---------------------------------------------------------------------------


def test_w4_transfer_side_alone_is_rejected(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    pair_id = uuid4()
    out_only = _op(
        type_=OperationType.TRANSFER_OUT,
        quantity="-5",
        transfer_pair_id=pair_id,
        import_batch_id=batch_id,
    )
    with pytest.raises(InvariantViolationError, match="W4"):
        repo.write([out_only], import_batch_id=batch_id)


def test_w4_transfer_pair_must_net_to_zero(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    pair_id = uuid4()
    out_side = _op(
        type_=OperationType.TRANSFER_OUT,
        account_id=ACCOUNT_1,
        quantity="-5",
        transfer_pair_id=pair_id,
        import_batch_id=batch_id,
    )
    in_side = _op(
        type_=OperationType.TRANSFER_IN,
        account_id=ACCOUNT_2,
        quantity="4",  # does not net to zero
        transfer_pair_id=pair_id,
        import_batch_id=batch_id,
    )
    with pytest.raises(InvariantViolationError, match="W4"):
        repo.write([out_side, in_side], import_batch_id=batch_id)


def test_w4_valid_transfer_pair_is_accepted(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_id = uuid4()
    pair_id = uuid4()
    out_side = _op(
        type_=OperationType.TRANSFER_OUT,
        account_id=ACCOUNT_1,
        quantity="-5",
        transfer_pair_id=pair_id,
        import_batch_id=batch_id,
    )
    in_side = _op(
        type_=OperationType.TRANSFER_IN,
        account_id=ACCOUNT_2,
        quantity="5",
        transfer_pair_id=pair_id,
        import_batch_id=batch_id,
    )
    repo.write([out_side, in_side], import_batch_id=batch_id)
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (2,)


# ---------------------------------------------------------------------------
# W5 — no correction chains · W6 — correction pair totality (cash)
# ---------------------------------------------------------------------------


def test_w6_correction_of_a_legged_operation_requires_the_paired_cash_correction(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_1 = uuid4()
    primary, leg = _buy_with_leg(batch_1, quantity="100", price="10")
    repo.write([primary, leg], import_batch_id=batch_1)

    batch_2 = uuid4()
    correction_primary = _op(
        type_=OperationType.CORRECTION,
        quantity="-10",
        price="10",
        corrects_id=primary.id,
        import_batch_id=batch_2,
    )
    with pytest.raises(InvariantViolationError, match="W6"):
        repo.write([correction_primary], import_batch_id=batch_2)


def test_w6_and_w1_w2_a_complete_correction_of_a_legged_operation_is_accepted(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_1 = uuid4()
    primary, leg = _buy_with_leg(batch_1, quantity="100", price="10")
    repo.write([primary, leg], import_batch_id=batch_1)

    batch_2 = uuid4()
    correction_primary = _op(
        type_=OperationType.CORRECTION,
        quantity="-10",
        price="10",
        corrects_id=primary.id,
        import_batch_id=batch_2,
    )
    correction_leg = _op(
        type_=OperationType.CORRECTION,
        asset_id=CASH,
        quantity="100",  # -(-10 * 10) - 0
        price="1",
        corrects_id=leg.id,
        cash_leg_of=correction_primary.id,
        import_batch_id=batch_2,
    )
    repo.write([correction_primary, correction_leg], import_batch_id=batch_2)
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (4,)


def test_w5_no_correction_chains(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_1 = uuid4()
    primary, leg = _buy_with_leg(batch_1, quantity="100", price="10")
    repo.write([primary, leg], import_batch_id=batch_1)

    batch_2 = uuid4()
    correction_primary = _op(
        type_=OperationType.CORRECTION,
        quantity="-10",
        price="10",
        corrects_id=primary.id,
        import_batch_id=batch_2,
    )
    correction_leg = _op(
        type_=OperationType.CORRECTION,
        asset_id=CASH,
        quantity="100",
        price="1",
        corrects_id=leg.id,
        cash_leg_of=correction_primary.id,
        import_batch_id=batch_2,
    )
    repo.write([correction_primary, correction_leg], import_batch_id=batch_2)

    batch_3 = uuid4()
    chained_correction = _op(
        type_=OperationType.CORRECTION,
        quantity="1",
        corrects_id=correction_primary.id,  # corrects a CORRECTION — illegal
        import_batch_id=batch_3,
    )
    with pytest.raises(InvariantViolationError, match="W5"):
        repo.write([chained_correction], import_batch_id=batch_3)


# ---------------------------------------------------------------------------
# W7 — correction pair totality (transfer)
# ---------------------------------------------------------------------------


def test_w7_correction_of_one_transfer_side_requires_the_other(
    repo: DuckDBOperationRepository,
) -> None:
    batch_1 = uuid4()
    pair_id = uuid4()
    out_side = _op(
        type_=OperationType.TRANSFER_OUT,
        account_id=ACCOUNT_1,
        quantity="-12",
        transfer_pair_id=pair_id,
        import_batch_id=batch_1,
    )
    in_side = _op(
        type_=OperationType.TRANSFER_IN,
        account_id=ACCOUNT_2,
        quantity="12",
        transfer_pair_id=pair_id,
        import_batch_id=batch_1,
    )
    repo.write([out_side, in_side], import_batch_id=batch_1)

    batch_2 = uuid4()
    lone_correction = _op(
        type_=OperationType.CORRECTION,
        quantity="-3",
        corrects_id=out_side.id,
        import_batch_id=batch_2,
    )
    with pytest.raises(InvariantViolationError, match="W7"):
        repo.write([lone_correction], import_batch_id=batch_2)


def test_w7_equal_and_opposite_transfer_correction_pair_is_accepted(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_1 = uuid4()
    pair_id = uuid4()
    out_side = _op(
        type_=OperationType.TRANSFER_OUT,
        account_id=ACCOUNT_1,
        quantity="-12",
        transfer_pair_id=pair_id,
        import_batch_id=batch_1,
    )
    in_side = _op(
        type_=OperationType.TRANSFER_IN,
        account_id=ACCOUNT_2,
        quantity="12",
        transfer_pair_id=pair_id,
        import_batch_id=batch_1,
    )
    repo.write([out_side, in_side], import_batch_id=batch_1)

    batch_2 = uuid4()
    correct_out = _op(
        type_=OperationType.CORRECTION,
        quantity="-3",
        corrects_id=out_side.id,
        import_batch_id=batch_2,
    )
    correct_in = _op(
        type_=OperationType.CORRECTION,
        quantity="3",
        corrects_id=in_side.id,
        import_batch_id=batch_2,
    )
    repo.write([correct_out, correct_in], import_batch_id=batch_2)
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (4,)


# ---------------------------------------------------------------------------
# W8 — correction leg amount
# ---------------------------------------------------------------------------


def test_w8_correction_leg_amount_formula_is_enforced(repo: DuckDBOperationRepository) -> None:
    batch_1 = uuid4()
    primary, leg = _buy_with_leg(batch_1, quantity="100", price="10")
    repo.write([primary, leg], import_batch_id=batch_1)

    batch_2 = uuid4()
    correction_primary = _op(
        type_=OperationType.CORRECTION,
        quantity="-10",
        price="10",
        corrects_id=primary.id,
        import_batch_id=batch_2,
    )
    wrong_correction_leg = _op(
        type_=OperationType.CORRECTION,
        asset_id=CASH,
        quantity="1",  # should be 100
        price="1",
        corrects_id=leg.id,
        cash_leg_of=correction_primary.id,
        import_batch_id=batch_2,
    )
    with pytest.raises(InvariantViolationError, match="W8"):
        repo.write([correction_primary, wrong_correction_leg], import_batch_id=batch_2)


# ---------------------------------------------------------------------------
# W9 — atomicity
# ---------------------------------------------------------------------------


def test_w9_mismatched_import_batch_id_is_rejected(repo: DuckDBOperationRepository) -> None:
    batch_id = uuid4()
    other_batch_id = uuid4()
    primary, leg = _buy_with_leg(batch_id)
    with pytest.raises(InvariantViolationError, match="W9"):
        repo.write([primary, leg], import_batch_id=other_batch_id)


def test_w9_an_invalid_batch_writes_nothing(
    con: duckdb.DuckDBPyConnection, repo: DuckDBOperationRepository
) -> None:
    batch_id = uuid4()
    primary = _op(type_=OperationType.BUY, quantity="10", import_batch_id=batch_id)  # no leg
    with pytest.raises(InvariantViolationError):
        repo.write([primary], import_batch_id=batch_id)
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (0,)


# ---------------------------------------------------------------------------
# W10 — append-only
# ---------------------------------------------------------------------------


def test_w10_the_repository_exposes_no_update_or_delete_method(
    repo: DuckDBOperationRepository,
) -> None:
    assert not hasattr(repo, "update")
    assert not hasattr(repo, "delete")
