"""`import_prices` — the one place a `PriceProvider` is composed with `UnitOfWork` (ADR-0031)."""

from __future__ import annotations

from collections.abc import Collection, Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import duckdb
import pytest

from financeos.app.import_prices import import_prices
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.core.portfolio import Asset
from financeos.core.shared import AssetId
from financeos.ports.market import PriceQuote

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

FUND = AssetId(UUID(int=1))
AS_OF = date(2026, 1, 15)


class _FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 1, 15, 12, tzinfo=UTC)


class _CountingIdGen:
    def __init__(self, start: int) -> None:
        self._n = start

    def __call__(self) -> UUID:
        self._n += 1
        return UUID(int=self._n)


class _StubProvider:
    def fetch(self, assets: Collection[Asset], *, as_of: date) -> list[PriceQuote]:
        return [
            PriceQuote(
                asset_id=asset.id, valid_date=as_of, close=Decimal("100"), currency="EUR",
                source="stub",
            )
            for asset in assets
        ]


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    connection.execute(
        "INSERT INTO asset VALUES (?, 'Fund', 'EQUITY_DEVELOPED', 'EUR', '[]')", [str(FUND)]
    )
    yield connection
    connection.close()


def test_import_prices_writes_one_price_row_per_quote(con: duckdb.DuckDBPyConnection) -> None:
    uow = DuckDBUnitOfWork(con)
    asset = Asset(id=FUND, name="Fund", asset_class="EQUITY_DEVELOPED", currency="EUR")

    ids = import_prices(
        uow, _CountingIdGen(0), _FixedClock(), _StubProvider(), [asset], as_of=AS_OF
    )

    assert len(ids) == 1
    row = con.execute("SELECT asset_id, close, currency, source FROM price").fetchone()
    assert row is not None
    assert row[0] == str(FUND)
    assert row[1] == Decimal("100")
    assert row[2] == "EUR"
    assert row[3] == "stub"
