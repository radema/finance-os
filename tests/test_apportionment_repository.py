"""`DuckDBApportionmentRepository.full_history` — every row, superseded included (RFC-0009 §7.1).

`virtual_holdings` folds a supersession chain to its latest-applicable row; `full_history` is
its export-side counterpart and must keep exactly what the fold discards.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest

from financeos.adapters.duckdb.repositories.apportionment import DuckDBApportionmentRepository
from financeos.core.shared import AssetId, BucketId, Quantity

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 1, 2, 12, 0, tzinfo=UTC)
BUCKET = BucketId(UUID(int=1))
OTHER_BUCKET = BucketId(UUID(int=2))
ASSET = AssetId(UUID(int=3))
PORTFOLIO = "00000000-0000-0000-0000-000000000009"
STRATEGY = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    connection.execute(
        "INSERT INTO asset VALUES (?, 'Some ETF', 'EQUITY_DEVELOPED', 'EUR', '[]')", [str(ASSET)]
    )
    connection.execute("INSERT INTO portfolio VALUES (?, 'P')", [PORTFOLIO])
    connection.execute("INSERT INTO strategy VALUES (?, 'S', NULL, NULL)", [STRATEGY])
    for bucket_id in (BUCKET, OTHER_BUCKET):
        connection.execute(
            "INSERT INTO bucket VALUES (?, ?, ?, 'Bucket')", [str(bucket_id), PORTFOLIO, STRATEGY]
        )
    yield connection
    connection.close()


@pytest.fixture
def repo(con: duckdb.DuckDBPyConnection) -> DuckDBApportionmentRepository:
    return DuckDBApportionmentRepository(con)


def test_full_history_includes_the_superseded_row(
    repo: DuckDBApportionmentRepository,
) -> None:
    first_id = uuid4()
    second_id = uuid4()
    repo.apportion(
        first_id,
        BUCKET,
        ASSET,
        Quantity(amount=Decimal("100")),
        effective_from=date(2026, 1, 1),
        recorded_at=NOW,
    )
    repo.apportion(
        second_id,
        BUCKET,
        ASSET,
        Quantity(amount=Decimal("150")),
        effective_from=date(2026, 1, 2),
        recorded_at=LATER,
        supersedes_id=first_id,
    )

    history = repo.full_history(BUCKET)

    assert [record.id for record in history] == [first_id, second_id]
    assert history[0].supersedes_id is None
    assert history[1].supersedes_id == first_id
    assert history[0].quantity.amount == Decimal("100.0000000000")
    assert history[1].quantity.amount == Decimal("150.0000000000")


def test_full_history_is_scoped_to_its_own_bucket(
    repo: DuckDBApportionmentRepository,
) -> None:
    repo.apportion(
        uuid4(),
        BUCKET,
        ASSET,
        Quantity(amount=Decimal("10")),
        effective_from=date(2026, 1, 1),
        recorded_at=NOW,
    )
    assert repo.full_history(OTHER_BUCKET) == ()
