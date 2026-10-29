# 03 — Fineco facts: commissions, zero-commission ETFs, export formats

Researched 2026-10-29. Status tags: CONFIRMED = read on a Fineco page; SECONDARY = third party only; NOT PUBLIC = no source found.

## Question

For a Fineco account in regime amministrato: (a) ETF and bond commissions on Italian markets (the app assumes 0.19%, min EUR 2.95, max EUR 19); (b) the zero-commission ETF list or rule; (c) the movimenti export format.

## Short answer

- The app assumption is CONFIRMED for ETFs on the Conto Fineco Trading plan: 0.19%, min EUR 2.95, max EUR 19.
- Bonds differ: the minimum is EUR 2.95 only for bonds on a Fineco list; all others pay EUR 5.95. The max is EUR 19 on MOT/EuroTLX, with no max on Euronext bonds.
- Zero commission applies to purchases only, on selected ETFs of 5 issuers. There is no fixed list. Fineco publishes a monthly PDF.
- The movimenti export format is NOT PUBLIC. No column headers, delimiter or number format found. The user must supply a real file.

## Commissions

Plan: Conto Fineco Trading (variable fee). Source: https://it.finecobank.com/trading/commissioni/ (fetched 2026-10-29; the page shows no date or version).

| Instrument | Rate | Min | Max |
|---|---|---|---|
| ETF (also shares, certificates) | 0.19% of value | EUR 2.95 | EUR 19 |
| Bonds | 0.19% of value | EUR 2.95 or EUR 5.95 | EUR 19 |

- The EUR 2.95 bond minimum applies only to bonds on a Fineco list. Filter: Mercati > Obbligazioni > Ricerca obbligazioni > "Commissione minimo 2,95€". Other bonds pay EUR 5.95. (same page)
- SECONDARY: Euronext bonds have min EUR 5.95 and no max. MOT, EuroMOT, EuroTLX and Vorvel Bonds have max EUR 19. Source: https://www.sfadvisor.it/fineco-trading/ (updated 2026-10-28).
- SECONDARY: ETF rate on Euronext Milan, Vorvel, Xetra, Euronext. Other markets have higher minimums (EUR 9.95 or 12.95). Source: https://www.justetf.com/it/academy/fineco-vs-scalable-capital.html (published 2026-09-17; cites Fineco fogli informativi v5/2026 dated 2026-08-03).
- Plans One, Classic, Max use a flat fee per order instead (EUR 19 down to EUR 2.95, by monthly commissions generated). New clients pay EUR 9.95 in the opening months. Under-30 pay EUR 2.95 per order on Italian shares and ETFs. (same Fineco page; band limits are unclear on the page)
- The app must key the fee model on the account plan. The 0.19% model fits Trading only.
- A separate Fineco page (https://it.finecobank.com/trading/obbligazioni/) shows bonds as "fixed fee per order, decreasing with activity", min EUR 2.95, max EUR 19. It matches the One/Classic/Max model, not Trading.
- Not found: the official foglio informativo PDF itself. The Fineco commissions page links to /trasparenza/ and /documentazione-informativa.
- Not checked: stamp duty, FTT (Italian shares only, not ETFs), bond accrued-interest handling.

## Zero-commission ETFs

Source: https://it.finecobank.com/trading/etf/etf-zero-commissioni/ (fetched 2026-10-29).

- Rule: purchase orders only. Sales pay the normal commission.
- No order-value limit. Valid for single orders and for Replay plans.
- Needs an active deposito titoli at Fineco.
- Promotion by issuer, with end dates on the page:
  - Fineco Asset Management: to 2026-12-01.
  - Xtrackers: to 2026-12-01.
  - Amundi: to 2027-03-28.
  - iShares (BlackRock): to 2027-03-31.
- justETF also lists Fidelity (SECONDARY, 2026-09-17), which the Fineco page text I read did not show. Treat Fidelity as unconfirmed.
- Count: SECONDARY, 708 ETFs per justETF (the same page says both "over 700" and "over 800").
- List: updated monthly, published as a PDF only. The Fineco page does not reproduce it. The PDF URL was not found.
- The "30 most traded zero-commission ETFs" on the page are ideas, not the official list.
- FX spread applies if the ETF currency differs from the account currency and Multicurrency is off.
- Promotions have end dates. The app should store the zero-commission flag per ETF as user-editable data, not as hard-coded logic.

## Export formats

- NOT PUBLIC. I found no Fineco help page or document that lists headers, delimiter, decimal format, date format or the buy/sell column values.
- Only evidence: a Portfolio Performance forum thread (https://forum.portfolio-performance.info/t/fineco-bank-excel-portfolio/31018, posts 2024-12-27 to 2025-01-06).
  - Fineco offers the portfolio ("portafoglio") download as an Excel file.
  - The user converted it to CSV with "," as separator.
  - The export has summary lines starting with "Totale" and "EUR". They must be skipped on import.
  - That thread covers the securities portfolio, not the transactions export. It shows no headers or sample rows.
- Fineco site facts (https://it.finecobank.com/banking, fetched via search 2026-10-29): online movements can cover up to 4 years. A paper "lista movimenti" is available on request, for a fee.
- Third-party tools list Fineco as an import source (Sharesight uses email confirmations). They do not document the file.
- Do not assume: CSV vs XLSX, delimiter, decimal comma, date format (likely dd/mm/yyyy), buy/sell labels. All unverified.

## Open points

1. Export format needs a real file. Ask the user to download the movimenti and the securities-transactions export from the Fineco web app and save samples (redacted) under `real/`. Then fix the parser spec from the file.
2. Confirm the user's account plan (Trading vs One/Classic/Max). It sets the fee model.
3. Get the zero-commission PDF URL and the current foglio informativo from /trasparenza/ (page needs a browser).
4. Fidelity: confirm whether it is in the zero-commission program.
5. Fineco pages were read through a text extractor. A human should re-read the fee table before it becomes a spec.

## Sources

- https://it.finecobank.com/trading/commissioni/ (2026-10-29, undated)
- https://it.finecobank.com/trading/etf/etf-zero-commissioni/ (2026-10-29, undated)
- https://it.finecobank.com/trading/obbligazioni/ (2026-10-29, undated)
- https://it.finecobank.com/banking (2026-10-29)
- https://www.sfadvisor.it/fineco-trading/ (updated 2026-10-28, secondary)
- https://www.justetf.com/it/academy/fineco-vs-scalable-capital.html (2026-09-17, secondary)
- https://forum.portfolio-performance.info/t/fineco-bank-excel-portfolio/31018 (2025-01-06, forum)
- Not reached: Fineco /trasparenza/ foglio informativo PDF; zero-commission PDF list; any export help page.
