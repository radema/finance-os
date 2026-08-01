"""`import_operations` — the widened V1.0 shapes: `TRANSFER_IN`/`TRANSFER_OUT` pairs and
`CORRECTION` pairs, built from CSV-shaped input against a real `DuckDBUnitOfWork` (ADR-0028,
ADR-L01). `BUY`/`SELL` is a regression check: unchanged from the skeleton.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest

from financeos.adapters.importers.csv_operations import OperationImportRow
from financeos.app.import_operations import import_operations
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.core.portfolio import Asset, OperationType
from financeos.core.shared import AccountId, AssetId
from financeos.ports import AccountInfo

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

TRADE_DATE = date(2026, 1, 1)
CASH = AssetId(UUID("00000000-0000-0000-0000-0000000000c1"))
SECURITY = AssetId(UUID("00000000-0000-0000-0000-0000000000a1"))
ACCOUNT_1 = AccountId(UUID("00000000-0000-0000-0000-000000000001"))
ACCOUNT_2 = AccountId(UUID("00000000-0000-0000-0000-000000000002"))


class _FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 1, 1, 12, tzinfo=UTC)


class _CountingIdGen:
    def __init__(self, start: int) -> None:
        self._n = start

    def __call__(self) -> UUID:
        self._n += 1
        return UUID(int=self._n)


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    yield connection
    connection.close()


@pytest.fixture
def uow(con: duckdb.DuckDBPyConnection) -> DuckDBUnitOfWork:
    unit = DuckDBUnitOfWork(con)
    unit.assets.add(_asset(CASH, "CASH"))
    unit.assets.add(_asset(SECURITY, "EQUITY_DEVELOPED"))
    unit.accounts.add(
        AccountInfo(id=ACCOUNT_1, cash_asset_id=CASH, currency="EUR"),
        name="Main",
        type_="BROKERAGE",
    )
    unit.accounts.add(
        AccountInfo(id=ACCOUNT_2, cash_asset_id=CASH, currency="EUR"),
        name="Other",
        type_="BROKERAGE",
    )
    return unit


def _asset(asset_id: AssetId, asset_class: str) -> Asset:
    return Asset(id=asset_id, name=asset_class, asset_class=asset_class, currency="EUR")


def _one(con: duckdb.DuckDBPyConnection, sql: str) -> UUID:
    row = con.execute(sql).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _row(
    *,
    account_id: AccountId,
    type_: OperationType,
    quantity: str,
    price: str | None = "100",
    fees: str = "0",
    ref: str | None = None,
    asset_id: AssetId = SECURITY,
) -> OperationImportRow:
    return OperationImportRow(
        account_id=account_id,
        asset_id=asset_id,
        type=type_,
        trade_date=TRADE_DATE,
        quantity=Decimal(quantity),
        price=Decimal(price) if price is not None else None,
        fees=Decimal(fees),
        currency="EUR",
        ref=ref,
    )


def test_buy_still_writes_primary_and_leg(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    row = _row(account_id=ACCOUNT_1, type_=OperationType.BUY, quantity="10", price="100")
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [row])
    assert con.execute("SELECT count(*) FROM operation").fetchone() == (2,)


def test_transfer_pair_writes_two_linked_rows(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    out_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.TRANSFER_OUT,
        quantity="-10",
        ref="T1",
        asset_id=SECURITY,
    )
    in_row = _row(
        account_id=ACCOUNT_2,
        type_=OperationType.TRANSFER_IN,
        quantity="10",
        ref="T1",
        asset_id=SECURITY,
    )
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [out_row, in_row])

    rows = con.execute(
        "SELECT type, transfer_pair_id FROM operation ORDER BY type"
    ).fetchall()
    assert len(rows) == 2
    assert rows[0][1] == rows[1][1]  # same transfer_pair_id
    assert {r[0] for r in rows} == {"TRANSFER_IN", "TRANSFER_OUT"}


def test_transfer_row_with_nonzero_fees_is_rejected(uow: DuckDBUnitOfWork) -> None:
    out_row = _row(
        account_id=ACCOUNT_1, type_=OperationType.TRANSFER_OUT, quantity="-10", ref="T1", fees="1"
    )
    in_row = _row(account_id=ACCOUNT_2, type_=OperationType.TRANSFER_IN, quantity="10", ref="T1")
    with pytest.raises(ValueError, match="fees must be 0"):
        import_operations(uow, _CountingIdGen(0), _FixedClock(), [out_row, in_row])


def test_unpaired_transfer_ref_is_rejected(uow: DuckDBUnitOfWork) -> None:
    out_row = _row(account_id=ACCOUNT_1, type_=OperationType.TRANSFER_OUT, quantity="-10", ref="T1")
    with pytest.raises(ValueError, match="must group exactly one"):
        import_operations(uow, _CountingIdGen(0), _FixedClock(), [out_row])


def test_correction_of_a_buy_writes_a_paired_cash_correction(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    buy_row = _row(account_id=ACCOUNT_1, type_=OperationType.BUY, quantity="100", price="10")
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [buy_row])
    target_id = _one(con, "SELECT id FROM operation WHERE type = 'BUY'")

    correction_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="-10",
        price=None,
        ref=str(target_id),
    )
    import_operations(uow, _CountingIdGen(1000), _FixedClock(), [correction_row])

    corrections = con.execute(
        "SELECT type, quantity, corrects_id, cash_leg_of FROM operation "
        "WHERE type = 'CORRECTION' ORDER BY quantity"
    ).fetchall()
    assert len(corrections) == 2
    # cash correction leg: -( -10 * 10 ) - 0 = 100
    quantities = {row[1] for row in corrections}
    assert quantities == {Decimal("-10"), Decimal("100")}


def test_correction_target_must_exist(uow: DuckDBUnitOfWork) -> None:
    correction_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="-10",
        price=None,
        ref=str(uuid4()),
    )
    with pytest.raises(KeyError):
        import_operations(uow, _CountingIdGen(0), _FixedClock(), [correction_row])


def test_correction_of_a_correction_is_rejected(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    buy_row = _row(account_id=ACCOUNT_1, type_=OperationType.BUY, quantity="100", price="10")
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [buy_row])
    target_id = _one(con, "SELECT id FROM operation WHERE type = 'BUY'")

    correction_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="-10",
        price=None,
        ref=str(target_id),
    )
    import_operations(uow, _CountingIdGen(1000), _FixedClock(), [correction_row])
    correction_id = _one(
        con, "SELECT id FROM operation WHERE type = 'CORRECTION' AND cash_leg_of IS NULL"
    )

    chained = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="1",
        price=None,
        ref=str(correction_id),
    )
    with pytest.raises(ValueError, match="W5"):
        import_operations(uow, _CountingIdGen(2000), _FixedClock(), [chained])


def test_correction_of_one_transfer_side_derives_the_equal_and_opposite_correction(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    out_row = _row(account_id=ACCOUNT_1, type_=OperationType.TRANSFER_OUT, quantity="-12", ref="T1")
    in_row = _row(account_id=ACCOUNT_2, type_=OperationType.TRANSFER_IN, quantity="12", ref="T1")
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [out_row, in_row])
    out_id = _one(con, "SELECT id FROM operation WHERE type = 'TRANSFER_OUT'")

    correction_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="-3",
        price=None,
        ref=str(out_id),
    )
    import_operations(uow, _CountingIdGen(1000), _FixedClock(), [correction_row])

    corrections = con.execute("SELECT quantity FROM operation WHERE type = 'CORRECTION'").fetchall()
    quantities = {row[0] for row in corrections}
    assert quantities == {Decimal("-3"), Decimal("3")}


def test_correcting_a_cash_leg_directly_is_rejected(
    con: duckdb.DuckDBPyConnection, uow: DuckDBUnitOfWork
) -> None:
    buy_row = _row(account_id=ACCOUNT_1, type_=OperationType.BUY, quantity="100", price="10")
    import_operations(uow, _CountingIdGen(0), _FixedClock(), [buy_row])
    leg_id = _one(con, "SELECT id FROM operation WHERE cash_leg_of IS NOT NULL")

    correction_row = _row(
        account_id=ACCOUNT_1,
        type_=OperationType.CORRECTION,
        quantity="1",
        price=None,
        ref=str(leg_id),
    )
    with pytest.raises(ValueError, match="cannot directly correct cash leg"):
        import_operations(uow, _CountingIdGen(1000), _FixedClock(), [correction_row])
