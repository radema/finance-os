# 02 — Price providers: is yfinance enough, and what is the fallback

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

For EUR ETFs on Borsa Italiana (tickers like VWCE.MI), Italian govt bonds (BTP) and Italian pension funds: does yfinance work in 2026 (coverage, rate limits, terms of use, recent breakages)? Which free or cheap providers could be a fallback or a second adapter? Where do pension fund unit values come from? Output: `research/02-price-providers.md`, with a recommendation for v1 (one provider + manual/CSV, or two providers).

## Answer

Findings: [research/02-price-providers.md](../research/02-price-providers.md).

v1 ships one online adapter, yfinance, for `.MI` ETFs only — tested today: EUR monthly closes for VWCE.MI (matches Borsa Italiana), SWDA.MI, ENI.MI. BTP (a BTP ISIN returned nothing) and pension funds (no COVIP download; unit values from the fund site or statement) are manual or CSV. No second online adapter in v1; keep the `PriceProvider` interface. Later fallback candidate: EODHD (~EUR 20/month, untested). Yahoo is best effort: its terms ban automated collection, yfinance says personal use only, open issues on rate limits (429) and a 100x rescale bug in `repair=True` — so cache, retry, never block, raise R10, and do not use `repair=True`. Stooq is no longer usable over plain HTTP.

Check: the spec's Prices section names yfinance for ETFs only, manual/CSV for BTP and pension, and keeps the >25% move review list; `uv run --with yfinance python -c "import yfinance as y; print(y.Ticker('VWCE.MI').history(period='3mo', interval='1mo')['Close'].tail(1))"` prints an EUR price.
