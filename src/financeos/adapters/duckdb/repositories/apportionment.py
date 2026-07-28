"""`DuckDBApportionmentRepository` — `bucket_apportionment` (ADR-0025).

Temporal append-only, effective-dated supersession. `virtual_holdings` resolves, per asset,
the row with the latest `effective_from` at or before `as_of` — the same "fold to the latest
applicable fact" shape as `Holding` one level up, and it is deliberately *not* a write-time
`Σ apportioned <= Holding` check (ADR-0025: that is `over_apportioned`, an evaluation-time
finding, not a repository invariant).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

import duckdb

from financeos.core.portfolio import VirtualHolding
from financeos.core.shared import REF_APPORTIONMENT, AssetId, BucketId, Quantity, entity_ref


class DuckDBApportionmentRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def apportion(
        self,
        id: UUID,
        bucket_id: BucketId,
        asset_id: AssetId,
        quantity: Quantity,
        *,
        effective_from: date,
        recorded_at: datetime,
        supersedes_id: UUID | None = None,
    ) -> None:
        self._con.execute(
            "INSERT INTO bucket_apportionment "
            "(id, bucket_id, asset_id, quantity, effective_from, supersedes_id, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                str(id),
                str(bucket_id),
                str(asset_id),
                quantity.amount,
                effective_from,
                str(supersedes_id) if supersedes_id else None,
                recorded_at,
            ],
        )

    def virtual_holdings(self, bucket_id: BucketId, *, as_of: date) -> tuple[VirtualHolding, ...]:
        rows = self._con.execute(
            """
            SELECT id, asset_id, quantity
            FROM (
                SELECT id, asset_id, quantity,
                       row_number() OVER (
                           PARTITION BY asset_id ORDER BY effective_from DESC, recorded_at DESC
                       ) AS rn
                FROM bucket_apportionment
                WHERE bucket_id = ? AND effective_from <= ?
            )
            WHERE rn = 1 AND quantity <> 0
            ORDER BY asset_id
            """,
            [str(bucket_id), as_of],
        ).fetchall()
        return tuple(
            VirtualHolding(
                bucket_id=bucket_id,
                asset_id=AssetId(UUID(row_asset_id)),
                quantity=Quantity(amount=quantity),
                input_refs=(entity_ref(REF_APPORTIONMENT, row_id),),
            )
            for row_id, row_asset_id, quantity in rows
        )
