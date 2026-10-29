# 04 — Excel v2 audit against the spec and the mock engine

Type: research
Status: claimed
Blocked by: —
Map: ../map.md

## Question

The source spec uses `gbi-planner-v2.xlsx` (path in the map Notes) as the parity baseline, but the user warns it may contain errors. Map its sheets and formulas (Goals, Pension, Contrib_Schedule, CashFlow, ...) to the formulas in `reference/source-spec.md` and the JS engine in `reference/mock-app.html`. List every disagreement between the three, with a judgement of which one is right and why. Say whether the file holds personal figures, and which inputs/outputs could become a committed, anonymised parity fixture. Output: `research/04-excel-v2-audit.md`.
