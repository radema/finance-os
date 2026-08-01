"""`price_latest` / `price_as_known_at` — the two named `price` accessors (RFC-0009 §9,
ADR-0031). `price_latest` resolves the best current estimate; `price_as_known_at` additionally
bounds by `recorded_at`, reconstructing what was believed as of a past instant.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import duckdb
import pytest

from financeos.adapters.duckdb.repositories.price import DuckDBPriceRepository
from financeos.core.shared import AssetId

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

ASSET = AssetId(uuid4())


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    connection.execute(
        "INSERT INTO asset VALUES (?, 'Fund', 'EQUITY_DEVELOPED', 'EUR', '[]')", [str(ASSET)]
    )
    yield connection
    connection.close()


@pytest.fixture
def repo(con: duckdb.DuckDBPyConnection) -> DuckDBPriceRepository:
    return DuckDBPriceRepository(con)


def test_price_latest_picks_the_most_recent_valid_date_at_or_before_as_of(
    repo: DuckDBPriceRepository,
) -> None:
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 1),
        close="100",
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 10),
        close="110",
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 10, tzinfo=UTC),
    )

    result = repo.price_latest([ASSET], as_of=date(2026, 1, 15))
    assert result[ASSET].close == Decimal("110")

    result = repo.price_latest([ASSET], as_of=date(2026, 1, 5))
    assert result[ASSET].close == Decimal("100")


def test_price_latest_breaks_a_same_day_restatement_tie_on_recorded_at(
    repo: DuckDBPriceRepository,
) -> None:
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 1),
        close="100",
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 1, 9, tzinfo=UTC),
    )
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 1),
        close="101",  # a same-day restatement
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 1, 18, tzinfo=UTC),
    )

    result = repo.price_latest([ASSET], as_of=date(2026, 1, 1))
    assert result[ASSET].close == Decimal("101")


def test_price_as_known_at_excludes_a_restatement_recorded_after_known_at(
    repo: DuckDBPriceRepository,
) -> None:
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 1),
        close="100",
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 1, 9, tzinfo=UTC),
    )
    repo.add(
        uuid4(),
        ASSET,
        valid_date=date(2026, 1, 1),
        close="101",  # restated the next day
        currency="EUR",
        source="seed",
        recorded_at=datetime(2026, 1, 2, 9, tzinfo=UTC),
    )

    # As known at the moment of the original recording: the restatement hasn't happened yet.
    as_known_then = repo.price_as_known_at(
        [ASSET], as_of=date(2026, 1, 1), known_at=datetime(2026, 1, 1, 12, tzinfo=UTC)
    )
    assert as_known_then[ASSET].close == Decimal("100")

    # `price_latest` reads the same rows without the recorded_at bound and sees the restatement.
    latest = repo.price_latest([ASSET], as_of=date(2026, 1, 1))
    assert latest[ASSET].close == Decimal("101")

    # As known at a later instant, the restatement is visible too.
    as_known_later = repo.price_as_known_at(
        [ASSET], as_of=date(2026, 1, 1), known_at=datetime(2026, 1, 3, tzinfo=UTC)
    )
    assert as_known_later[ASSET].close == Decimal("101")


def test_empty_asset_ids_returns_empty_mapping(repo: DuckDBPriceRepository) -> None:
    assert repo.price_latest([], as_of=date(2026, 1, 1)) == {}
    assert repo.price_as_known_at([], as_of=date(2026, 1, 1), known_at=datetime.now(UTC)) == {}
