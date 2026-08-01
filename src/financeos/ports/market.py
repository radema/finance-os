"""`PriceProvider` — external EOD price fetch port (ADR-0031, RFC-0011 §3).

Sibling of `core`, like every other port: two adapters implement it —
`adapters.market.HttpPriceProvider` (on-demand HTTP) and
`adapters.market.SeedFilePriceProvider` (a static fixture, for tests). Neither writes to
`price` directly; composition into a write happens exactly once, in `app.import_prices`
(RFC-0005 §4: `app` is the only layer that holds ports).
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol

from financeos.core.portfolio import Asset
from financeos.core.shared import AssetId, Currency


@dataclass(frozen=True)
class PriceQuote:
    """One fetched close, before it is written as a `price` row."""

    asset_id: AssetId
    valid_date: date
    close: Decimal
    currency: Currency
    source: str


class PriceProvider(Protocol):
    """Fetches EOD close prices for a set of Assets (Market context, ADR-0031)."""

    def fetch(self, assets: Collection[Asset], *, as_of: date) -> Sequence[PriceQuote]: ...
