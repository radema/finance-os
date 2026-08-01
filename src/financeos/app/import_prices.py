"""`import_prices` — `PriceProvider` fetch to `price` writes (ADR-0031).

The one place a `PriceProvider` is composed with `UnitOfWork` (RFC-0005 §4: composition
happens exactly once, in `app`). One id/`recorded_at` per quote, minted here — a port never
mints an id or reads a clock (I-7, generalized to the ports boundary `ports/repositories.py`
already documents).
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import date
from uuid import UUID

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.portfolio import Asset
from financeos.ports import Clock, IdGen
from financeos.ports.market import PriceProvider


def import_prices(
    uow: UnitOfWork,
    id_gen: IdGen,
    clock: Clock,
    provider: PriceProvider,
    assets: Collection[Asset],
    *,
    as_of: date,
) -> tuple[UUID, ...]:
    """Fetch one EOD close per Asset from `provider` and write each as a fresh `price` row.

    Returns:
        The minted `price.id`s, one per quote `provider.fetch` returned.
    """
    quotes = provider.fetch(assets, as_of=as_of)
    recorded_at = clock.now()
    ids: list[UUID] = []
    for quote in quotes:
        price_id = id_gen()
        uow.prices.add(
            price_id,
            quote.asset_id,
            valid_date=quote.valid_date,
            close=str(quote.close),
            currency=quote.currency,
            source=quote.source,
            recorded_at=recorded_at,
        )
        ids.append(price_id)
    return tuple(ids)
