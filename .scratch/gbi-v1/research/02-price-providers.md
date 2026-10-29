# 02 - Price providers: is yfinance enough, and what is the fallback

Read 2026-10-29. Ticket: `../issues/02-price-providers.md`.

## Question

Does yfinance work in 2026 for EUR ETFs on Borsa Italiana, BTP and Italian pension funds?
Which cheap or free provider is the fallback? Where do pension unit values come from?

## Short answer (recommendation for v1)

- Ship one online adapter: yfinance, for ETFs on `.MI` only. Confirmed working today (see Test).
- Ship CSV import and manual entry for BTP and pension funds. No free provider covers them reliably.
- Do not build a second online adapter in v1. Keep the `PriceProvider` interface so one can be added later.
- First fallback to add later, if Yahoo breaks: EODHD "EOD Historical Data" at about 20 EUR/month. Inferred, not tested.
- Treat Yahoo as best effort: cache, retry with backoff, never block the app, raise R10. This matches the source spec.

## Test run (confirmed, 2026-10-29)

Command: `uv run --with yfinance python -I -c ...` in a scratch dir. yfinance 1.7.0 (Python 3.14).

| Ticker | Result |
|---|---|
| `VWCE.MI` | 6 monthly rows. Oct 2026 close 171.45 EUR. `currency` = EUR. |
| `SWDA.MI` | 6 rows. Oct 2026 close 131.48 EUR. EUR. |
| `ENI.MI` | 6 rows, EUR. |
| `IT0005534984.MI` (a BTP ISIN) | Empty frame; `fast_info['currency']` raises `KeyError`. |

- The VWCE close 171.45 matches the Borsa Italiana page for IE00BK5BQT80 (171.45, 29/10/2026). Confirmed.
- yfinance printed many Pandas4Warning lines (`inplace` deprecation). Harmless, but pin versions.
- A monthly interval row is dated the first of the month and holds the last close of the month only for completed months. The current month row is a partial month. Use daily bars and take the last trading day. Inferred, not tested.
- One call per ticker was tested. Bulk rate limits were not tested.

## Provider table

| Provider | ETF `.MI` | BTP | Pension | Cost / limits | Terms (personal use) | Reliability |
|---|---|---|---|---|---|---|
| yfinance (Yahoo) | Yes, tested | No (ISIN test empty) | No | Free. No official quota. 429 reports exist. | No official API. Yahoo ToS bans automated collection (s.2(d)(9)). yfinance README says "personal use only". | Releases every 2-6 weeks in 2026 (1.7.0 on 2026-08-26). Open issues on 429s and repair bugs. |
| Stooq | Not confirmed | Not confirmed | No | Free CSV | Not read | Scripted `curl` to `stooq.com/q/d/l/` now returns a JavaScript proof-of-work page, not CSV. Not usable from a plain HTTP client. |
| EODHD | Likely (MI exchange). Not verified on page. | Not verified | No | Free: 20 calls/day, 1 year EOD history. Paid from 19.99 EUR/month. | Personal and commercial plans are separate. Terms page not read. | Not tested. |
| Twelve Data | Not confirmed. Pricing page lists no Borsa Italiana. | No | No | Free: 8 credits/min, 800/day | Not read | EU data listed under Pro tier. |
| Alpha Vantage | Not confirmed. Page does not mention Milan. | No | No | Free: 25 requests/day | Not read | Not tested. |
| Financial Modeling Prep | Unknown. Pricing page returned HTTP 403. | Unknown | No | Unknown | Unknown | Not reached. |
| Borsa Italiana pages | Last price per page (171.45 seen). No history download on the page. | Yes: MOT BTP pages show reference price per day (ISIN pages, recent days only). | No | Free to view | Scraping terms not read. Do not scrape in v1. | HTML can change. No export link found. |
| justETF | Not checked | No | No | - | Not checked | - |

"Not confirmed" means the source I read did not say. It does not mean "no".

## Pension funds

- Unit value (valore quota) comes from the fund itself: its website, its periodic statement, or the member area.
- COVIP (the regulator) publishes returns and cost indicators (ISC). I did not find a downloadable unit-value series. Searches returned no such file. Unconfirmed.
- COVIP pages returned HTTP 403 to my fetch, so I could not read the site directly.
- A third-party comparator says it uses "COVIP Open Data" for ISC and returns per compartment. Not verified. This is annual data, not month-end unit values.
- Result for v1: manual entry (one field per fund and month, as in the mock), or CSV import. No adapter.
- Optional later: per-fund scraping of the fund's public unit-value page. Fund sites differ, so it needs one adapter per fund. Out of scope.

## BTP

- Yahoo returned nothing for a BTP ISIN with the `.MI` suffix. Other suffixes were not tried.
- The broker statement gives price per 100. This is the source of truth for the user's own holdings.
- Borsa Italiana MOT pages show a daily reference price (seen: 102.98 to 113.53 for several BTP ISINs, dated July to October 2026). They give no history export.
- Result for v1: manual or CSV, as the source spec already says.

## Risks

- Yahoo ToS: automated collection is banned in text. The yfinance README says personal use only. Risk is low for one user on a laptop, but it is real. State it in the app docs.
- Yahoo can block or change endpoints without notice. 429 issues are open in the yfinance tracker (for example #2721, 2026-03).
- yfinance `repair=True` can rescale a price table by 100x (issue #2924, 2026-07). Do not enable `repair`. The 25% month-on-month check in the spec also catches this.
- `.MI` ETFs can quote in other currencies (GBp, USD). Reject any non-EUR currency, as the spec says.
- Dependency churn: yfinance pulls `curl_cffi`. Issue #2913 (2026-07) reports `nospam` extra packages unusable with it. Pin the version.
- Month-end alignment: Borsa Italiana holidays shift the last trading day. Store the actual bar date next to the month.
- Free tiers of paid providers are small (20-25 calls/day). A portfolio of 15 products fits, but a backfill does not.

## Open

- EODHD coverage of `.MI` ETFs and BTP: not verified on a primary page. Needs a test with a free key.
- Stooq: check whether an official download or API path remains. The CSV endpoint is gated.
- Borsa Italiana: read the Disclaimer page for redistribution terms if scraping is ever considered.
- COVIP: confirm by hand on covip.it whether unit-value series exist.
- Yahoo ToS: only the first 100,000 of 125,418 characters were read.

## Sources (all read 2026-10-29)

- yfinance 1.7.0 run: local test, see Test run.
- yfinance releases: https://api.github.com/repos/ranaroussi/yfinance/releases
- yfinance issues (2721, 2913, 2924): https://github.com/ranaroussi/yfinance/issues
- yfinance README disclaimer: https://github.com/ranaroussi/yfinance#readme
- Yahoo terms: https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- Twelve Data pricing: https://twelvedata.com/pricing
- Alpha Vantage premium page: https://www.alphavantage.co/premium/
- EODHD pricing: https://eodhd.com/pricing
- FMP pricing: https://site.financialmodelingprep.com/pricing-plans (HTTP 403)
- Borsa Italiana ETF page: https://www.borsaitaliana.it/borsa/etf/scheda/IE00BK5BQT80.html?lang=en
- Borsa Italiana BTP page example: https://www.borsaitaliana.it/borsa/obbligazioni/mot/btp/scheda/IT0004532559.html
- Stooq CSV endpoint: https://stooq.com/q/d/l/?s=vwce.de&i=m (proof-of-work page)
- COVIP: https://www.covip.it (HTTP 403; web search only)
