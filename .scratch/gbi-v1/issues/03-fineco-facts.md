# 03 — Fineco facts: commissions, zero-commission ETFs, export formats

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

From public Fineco sources (2026): the commission schedule for ETFs and bonds on Italian markets (rate, minimum — the spec assumes €2.95 — maximum €19), the list or rule for zero-commission ETFs, and the formats of the 'movimenti' / transactions export (CSV or XLSX, columns, delimiter, decimal and date format, buy/sell column). Output: `research/03-fineco-facts.md`. Mark every fact with its source URL and date.

## Answer

Findings: [research/03-fineco-facts.md](../research/03-fineco-facts.md).

- ETF fees 0.19% / min EUR 2.95 / max EUR 19 confirmed for the Conto Fineco Trading plan only; other plans (One/Classic/Max) use flat per-order fees, so the fee model must be keyed on the account plan.
- Bonds: min EUR 2.95 only for bonds on a Fineco list, else EUR 5.95; no max on Euronext bonds (secondary source).
- Zero commission: purchases only, selected ETFs of 5 issuers, list published as a monthly PDF with end dates — model it as a per-product flag the user maintains, not a fixed list.
- The 'movimenti' export format is not public: ticket 09 (real sample) is required before 08.
- Open for the user: which Fineco plan; re-read the fee table by hand before it enters the spec.

Check: `research/03-fineco-facts.md` exists and cites https://it.finecobank.com/trading/commissioni/; the spec's Commission entity carries a plan/fee-model field and a per-product zero-commission flag.
