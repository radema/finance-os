# 04 — Excel v2 audit against the spec and the mock engine

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

The source spec uses `gbi-planner-v2.xlsx` (path in the map Notes) as the parity baseline, but the user warns it may contain errors. Map its sheets and formulas (Goals, Pension, Contrib_Schedule, CashFlow, ...) to the formulas in `reference/source-spec.md` and the JS engine in `reference/mock-app.html`. List every disagreement between the three, with a judgement of which one is right and why. Say whether the file holds personal figures, and which inputs/outputs could become a committed, anonymised parity fixture. Output: `research/04-excel-v2-audit.md`.

## Answer

Findings: [research/04-excel-v2-audit.md](../research/04-excel-v2-audit.md).

- **No parity baseline exists yet:** the workbook was written by openpyxl and has no cached values (~285k uncached formulas). Goals!M must be recalculated (Excel or LibreOffice) or replaced by the synthetic fixture proposed in the audit's §Parity.
- **Deterministic tax logic agrees** across Excel, spec and mock (ETF blended rate, 48.08% via tax euros, credits, zainetto, bollo-basis rule, cash, pension 20%, exit rate) — inferred from the algebra; only a few cells could be evaluated.
- **Excel errors:** PMC typed as input; linear "monthly needed"; unseeded per-bucket MC with independent goals and no credits; next contribution includes pension; TODAY().
- **Mock bug M1:** `cashflow()` and `planVsActual()` count the goal year (t = T+1) while the projection stops at t = T; the Excel is right here.
- **Shared simplifications to decide (ticket 12):** year-1 timing gives a full 12 months even in October (E9); pension lump sum ignores the 50% capital limit (S4); BTP coupons treated as deferred gains (S1); commissions not in basis; year-1 pension weights frozen; EUR 2,650 extra deduction every year. Current-account cash pays EUR 34.20 flat stamp duty, not 0.2%.
- **Personal data** sits in Goals!B5:F10, CashFlow!B4/B6/A11:C18 and the product list/weights; never commit the workbook.

Check: `research/04-excel-v2-audit.md` exists; ticket 12's answer rules on E9, S1, S4 and M1 and names the parity oracle.
