# 16 — Working prototype before implementation

Type: prototype
Status: resolved
Blocked by: 05, 07, 10, 11, 12
Map: ../map.md

## Question

Before the spec is frozen and implementation starts: does the redesigned app behave right end to end? Build a cheap, throwaway working prototype on the chosen stack (05) and UI direction (11): the real engine formulas (12) on fixture data, the main flows (first run and setup, add/import transactions, monthly prices, Dashboard, Goal detail, FI levels, optimizer) clickable. The user uses it and reacts. Output: `prototypes/16-app/` plus a note of what changed in the decisions; changes feed the spec (14). The prototype code is not the product: implementation starts clean from the spec.

## Answer

Prototype: [prototypes/16-app/](../prototypes/16-app/) — run with `pnpm install && pnpm dev`, open http://127.0.0.1:8717. What works, what was learnt and all 26 findings: [prototypes/16-app/NOTES.md](../prototypes/16-app/NOTES.md). The user tried it on 2026-10-29: it works; several UI/UX fixes are still needed.

What the prototype proved: the ticket 05 stack works end to end (Node 24 running TS directly, node:http + zod, node:sqlite + Kysely through a 12-line adapter, React + Vite + ECharts, pnpm 10 with `minimumReleaseAge` and blocked install scripts, 5 runtime deps, `pnpm audit` clean). Engine port with tickets 07 and 12 rules passes 18 golden tests (`vitest run`: 18 passed; `tsc --noEmit`: exit 0). Performance is well inside budget: full analysis (1,000 paths + solve + FI) 230 ms; optimizer 1,001 mixes 680 ms.

Decisions taken with the user on the prototype's findings:

- **Goal date:** a goal falls due on **31 December** of its target year. (With the pro-rata stub year, 1 January made the sample emergency fund Off track.) A per-goal month stays a v2 candidate.
- **Stub year, everything proportional to time:** contributions (ticket 12), volatility scaled by √(fraction), inflation on the real elapsed time, cash flow (income, expenses) scaled by the fraction.
- **Price age per price kind:** daily-priced products (Yahoo ETFs) are old after 7 days; monthly-priced products (pension funds, manual BTP) are old only if the previous month-end price is missing. R5 follows this rule.
- **Fineco XLSX:** keep the dependency-free reader; add a local, uncommitted test against `real/fineco-movimenti-sample.xlsx` plus committed synthetic fixtures with the same shape.
- **Stack notes for the spec:** pin `"packageManager": "pnpm@10.32.1"` (default corepack pnpm is broken here); Kysely 0.29 imports `Migrator` from `kysely/migration`.
- **UI/UX polish:** the user wants a dedicated final story for UI/UX fixes, starting with an impeccable audit of the built app (see notes on tickets 14 and 15).

The prototype code is throwaway: S0 starts clean from the spec.

Check: the spec states the 31 December goal date, the proportional stub year, the per-kind price age and the XLSX reader choice; ticket 15's output includes a UI/UX polish story that starts with an impeccable audit.
