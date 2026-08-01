"""`SeedFilePriceProvider` — a static CSV fixture standing in for a real price feed (ADR-0031).

Test-only in intent (RFC-0010's V1.0 table: "`SeedFilePriceProvider` for tests"), but no
different in shape from `demo/prices.csv`: ``asset_id,valid_date,close,currency,source``.
Resolves `price_latest` semantics — the latest row at or before `as_of` per asset — so it can
stand in for `HttpPriceProvider` with no behaviour change beyond "no network".
"""

from __future__ import annotations

import csv
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from financeos.core.portfolio import Asset
from financeos.core.shared import AssetId
from financeos.ports.market import PriceQuote


@dataclass(frozen=True)
class _SeedRow:
    asset_id: AssetId
    valid_date: date
    close: Decimal
    currency: str
    source: str


class SeedFilePriceProvider:
    """Reads `path` once at construction; `fetch` never touches the filesystem again."""

    def __init__(self, path: Path) -> None:
        self._rows = _read(path)

    def fetch(self, assets: Collection[Asset], *, as_of: date) -> Sequence[PriceQuote]:
        wanted = {asset.id for asset in assets}
        latest: dict[AssetId, _SeedRow] = {}
        for row in self._rows:
            if row.asset_id not in wanted or row.valid_date > as_of:
                continue
            current = latest.get(row.asset_id)
            if current is None or row.valid_date > current.valid_date:
                latest[row.asset_id] = row
        return [
            PriceQuote(
                asset_id=row.asset_id,
                valid_date=row.valid_date,
                close=row.close,
                currency=row.currency,
                source=row.source,
            )
            for row in latest.values()
        ]


def _read(path: Path) -> tuple[_SeedRow, ...]:
    with path.open(newline="", encoding="utf-8") as fh:
        return tuple(
            _SeedRow(
                asset_id=AssetId(UUID(record["asset_id"])),
                valid_date=date.fromisoformat(record["valid_date"]),
                close=Decimal(record["close"]),
                currency=record["currency"],
                source=record["source"],
            )
            for record in csv.DictReader(fh)
        )
