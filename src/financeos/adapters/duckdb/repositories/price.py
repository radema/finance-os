"""`DuckDBPriceRepository` — `price`, bitemporal append-only (ADR-0031).

`as_of` is the one named ASOF accessor this repository exposes (RFC-0009 §9 Consequences:
"only two query helpers exist... no query module may inline a `price` join"). It resolves,
per asset, the latest `valid_date` at or before `as_of`, breaking a same-day restatement tie
on the latest `recorded_at`.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from datetime import date, datetime
from uuid import UUID

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.core.market import PriceView
from financeos.core.shared import AssetId, Currency, PriceId


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

    def as_of(self, asset_ids: Collection[AssetId], *, as_of: date) -> Mapping[AssetId, PriceView]:
        if not asset_ids:
            return {}
        ids = [str(a) for a in asset_ids]
        placeholders = ",".join("?" for _ in ids)
        rows = self._con.execute(
            f"""
            SELECT id, asset_id, valid_date, close, currency, CAST(recorded_at AS VARCHAR)
            FROM (
                SELECT id, asset_id, valid_date, close, currency, recorded_at,
                       row_number() OVER (
                           PARTITION BY asset_id ORDER BY valid_date DESC, recorded_at DESC
                       ) AS rn
                FROM price
                WHERE asset_id IN ({placeholders}) AND valid_date <= ?
            )
            WHERE rn = 1
            """,
            [*ids, as_of],
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
