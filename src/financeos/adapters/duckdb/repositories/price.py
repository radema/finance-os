"""`DuckDBPriceRepository` — `price`, bitemporal append-only (ADR-0031).

The two named accessors RFC-0009 §9 requires ("only two query helpers exist... no query
module may inline a `price` join"):

- `price_latest` — the best current estimate: per asset, the latest `valid_date` at or before
  `as_of`, breaking a same-day restatement tie on the latest `recorded_at`. What a valuation
  reads (RFC-0012, "leaning `price_latest()`").
- `price_as_known_at` — the same resolution, additionally bounded by `recorded_at <= known_at`:
  what the system believed as of a past instant — RFC-0009 §3.1's "price-as-known-then".
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from datetime import date, datetime
from uuid import UUID

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.core.market import PriceView
from financeos.core.shared import AssetId, Currency, PriceId
from financeos.ports.repositories import PriceRecord


class DuckDBPriceRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def add(
        self,
        id: UUID,
        asset_id: AssetId,
        *,
        valid_date: date,
        close: str,
        currency: Currency,
        source: str,
        recorded_at: datetime,
    ) -> None:
        self._con.execute(
            "INSERT INTO price (id, asset_id, valid_date, close, currency, source, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [str(id), str(asset_id), valid_date, close, currency, source, recorded_at],
        )

    def price_latest(
        self, asset_ids: Collection[AssetId], *, as_of: date
    ) -> Mapping[AssetId, PriceView]:
        return self._resolve(asset_ids, as_of=as_of, known_at=None)

    def price_as_known_at(
        self, asset_ids: Collection[AssetId], *, as_of: date, known_at: datetime
    ) -> Mapping[AssetId, PriceView]:
        return self._resolve(asset_ids, as_of=as_of, known_at=known_at)

    def _resolve(
        self, asset_ids: Collection[AssetId], *, as_of: date, known_at: datetime | None
    ) -> Mapping[AssetId, PriceView]:
        if not asset_ids:
            return {}
        ids = [str(a) for a in asset_ids]
        placeholders = ",".join("?" for _ in ids)
        known_at_filter = "AND recorded_at <= ?" if known_at is not None else ""
        params: list[object] = [*ids, as_of]
        if known_at is not None:
            params.append(known_at)
        rows = self._con.execute(
            f"""
            SELECT id, asset_id, valid_date, close, currency, CAST(recorded_at AS VARCHAR)
            FROM (
                SELECT id, asset_id, valid_date, close, currency, recorded_at,
                       row_number() OVER (
                           PARTITION BY asset_id ORDER BY valid_date DESC, recorded_at DESC
                       ) AS rn
                FROM price
                WHERE asset_id IN ({placeholders}) AND valid_date <= ? {known_at_filter}
            )
            WHERE rn = 1
            """,
            params,
        ).fetchall()
        return {
            AssetId(UUID(row_asset_id)): PriceView(
                asset_id=AssetId(UUID(row_asset_id)),
                price_id=PriceId(UUID(row_id)),
                valid_date=valid_date,
                close=close,
                currency=currency,
                recorded_at=parse_instant(recorded_at),
            )
            for row_id, row_asset_id, valid_date, close, currency, recorded_at in rows
        }

    def all(self) -> tuple[PriceRecord, ...]:
        rows = self._con.execute(
            "SELECT asset_id, valid_date, close, currency, source, "
            "CAST(recorded_at AS VARCHAR) FROM price "
            "ORDER BY asset_id, valid_date, recorded_at"
        ).fetchall()
        return tuple(
            PriceRecord(
                asset_id=AssetId(UUID(row[0])),
                valid_date=row[1],
                close=str(row[2]),
                currency=row[3],
                source=row[4],
                recorded_at=parse_instant(row[5]),
            )
            for row in rows
        )
