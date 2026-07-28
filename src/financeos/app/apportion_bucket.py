"""`apportion_bucket` — write one `bucket_apportionment` row (ADR-0025)."""

from __future__ import annotations

from datetime import date

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.shared import AssetId, BucketId, Quantity
from financeos.ports import Clock, IdGen


def apportion_bucket(
    uow: UnitOfWork,
    id_gen: IdGen,
    clock: Clock,
    bucket_id: BucketId,
    asset_id: AssetId,
    quantity: Quantity,
    *,
    effective_from: date,
) -> None:
    """Apportion `quantity` of `asset_id` to `bucket_id`, effective from `effective_from`.

    A pure write (ADR-0025): `over_apportioned` is an evaluation-time finding, so nothing here
    checks the apportioned sum against the scope's `Holding`.
    """
    uow.apportionments.apportion(
        id_gen(),
        bucket_id,
        asset_id,
        quantity,
        effective_from=effective_from,
        recorded_at=clock.now(),
    )
