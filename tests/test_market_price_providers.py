"""`PriceProvider` adapters (ADR-0031): `HttpPriceProvider` (mocked transport, no real network)
and `SeedFilePriceProvider` (static CSV fixture)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import httpx2 as httpx
import pytest

from financeos.adapters.market import HttpPriceProvider, SeedFilePriceProvider
from financeos.core.portfolio import Asset, AssetIdentifier, IdentifierScheme
from financeos.core.shared import AssetId

FUND = AssetId(UUID(int=1))
FUND_NO_TICKER = AssetId(UUID(int=2))


def _fund(asset_id: AssetId, *, ticker: str | None) -> Asset:
    identifiers = (AssetIdentifier(scheme=IdentifierScheme.TICKER, value=ticker),) if ticker else ()
    return Asset(id=asset_id, name="Fund", asset_class="EQUITY_DEVELOPED", currency="EUR",
                 identifiers=identifiers)


# --- HttpPriceProvider -------------------------------------------------------


def test_http_price_provider_fetches_one_quote_per_asset() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["symbol"] == "FUND"
        assert request.url.params["date"] == "2026-01-15"
        return httpx.Response(200, json={"close": "123.45", "currency": "EUR"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = HttpPriceProvider("https://example.invalid", client=client)

    quotes = provider.fetch([_fund(FUND, ticker="FUND")], as_of=date(2026, 1, 15))

    assert len(quotes) == 1
    assert quotes[0].asset_id == FUND
    assert quotes[0].close == Decimal("123.45")
    assert quotes[0].currency == "EUR"
    assert quotes[0].valid_date == date(2026, 1, 15)


def test_http_price_provider_raises_on_non_2xx() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(500))
    )
    provider = HttpPriceProvider("https://example.invalid", client=client)

    with pytest.raises(httpx.HTTPStatusError):
        provider.fetch([_fund(FUND, ticker="FUND")], as_of=date(2026, 1, 15))


def test_http_price_provider_requires_a_ticker_identifier() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
    provider = HttpPriceProvider("https://example.invalid", client=client)

    with pytest.raises(ValueError, match="no TICKER identifier"):
        provider.fetch([_fund(FUND_NO_TICKER, ticker=None)], as_of=date(2026, 1, 15))


# --- SeedFilePriceProvider ----------------------------------------------------


def _write_seed(tmp_path: Path) -> Path:
    path = tmp_path / "prices.csv"
    path.write_text(
        "asset_id,valid_date,close,currency,source\n"
        f"{FUND},2026-01-01,100.00,EUR,seed\n"
        f"{FUND},2026-01-10,110.00,EUR,seed\n",
        encoding="utf-8",
    )
    return path


def test_seed_file_price_provider_picks_latest_row_at_or_before_as_of(tmp_path: Path) -> None:
    provider = SeedFilePriceProvider(_write_seed(tmp_path))

    quotes = provider.fetch([_fund(FUND, ticker="FUND")], as_of=date(2026, 1, 15))
    assert len(quotes) == 1
    assert quotes[0].close == Decimal("110.00")

    quotes = provider.fetch([_fund(FUND, ticker="FUND")], as_of=date(2026, 1, 5))
    assert quotes[0].close == Decimal("100.00")


def test_seed_file_price_provider_skips_assets_with_no_row_at_or_before_as_of(
    tmp_path: Path,
) -> None:
    provider = SeedFilePriceProvider(_write_seed(tmp_path))
    quotes = provider.fetch([_fund(FUND, ticker="FUND")], as_of=date(2025, 12, 31))
    assert quotes == []


def test_seed_file_price_provider_ignores_assets_not_requested(tmp_path: Path) -> None:
    provider = SeedFilePriceProvider(_write_seed(tmp_path))
    quotes = provider.fetch([_fund(FUND_NO_TICKER, ticker=None)], as_of=date(2026, 1, 15))
    assert quotes == []
