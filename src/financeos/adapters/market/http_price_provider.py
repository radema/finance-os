"""`HttpPriceProvider` — on-demand EOD price fetch over HTTP (ADR-0031).

Adapters may perform egress; only `core`/`app` may not (C5). No specific EOD vendor is
ratified anywhere in the corpus (RFC-0010 §9 flags "price data fragility" as a known risk
class, not a choice), so this adapter is deliberately vendor-agnostic: one `GET` per `Asset`,
resolved through a small JSON contract (`{"close": ..., "currency": ...}`). Swapping vendors is
a URL/parsing change here, never a port change (`ports.market.PriceProvider`).
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from datetime import date
from decimal import Decimal

import httpx2 as httpx

from financeos.core.portfolio import Asset, IdentifierScheme
from financeos.ports.market import PriceQuote


class HttpPriceProvider:
    """Fetches one EOD close per `Asset` from `base_url`, keyed by its `TICKER` identifier."""

    def __init__(self, base_url: str, *, client: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=10.0)

    def fetch(self, assets: Collection[Asset], *, as_of: date) -> Sequence[PriceQuote]:
        quotes: list[PriceQuote] = []
        for asset in assets:
            ticker = _ticker_of(asset)
            response = self._client.get(
                f"{self._base_url}/eod", params={"symbol": ticker, "date": as_of.isoformat()}
            )
            response.raise_for_status()
            body = response.json()
            quotes.append(
                PriceQuote(
                    asset_id=asset.id,
                    valid_date=as_of,
                    close=Decimal(str(body["close"])),
                    currency=body["currency"],
                    source=self._base_url,
                )
            )
        return quotes


def _ticker_of(asset: Asset) -> str:
    for identifier in asset.identifiers:
        if identifier.scheme is IdentifierScheme.TICKER:
            return identifier.value
    raise ValueError(f"asset {asset.id} has no TICKER identifier — HttpPriceProvider needs one")
