# 10 — Tracking model: snapshots, plan history, alerts, optimizer caps

Type: grilling
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Source spec open questions: snapshot cadence (monthly automatic + manual, or manual only); should changes to monthly contributions be versioned so plan vs actual uses the plan in force at each date; class-level caps in the optimizer (e.g. Gold <= 20%) in v1 or only the per-product cap. Also: what 'dismissed until the condition changes' means for an alert (which inputs define 'changed').

## Answer

Grilled with the user on 2026-10-29. Source: `reference/source-spec.md` (Snapshot, Alert, Goal entities; Plan vs actual; Rules; Mix optimizer; Open questions).

**Snapshots: monthly automatic plus manual.** The app is not always running (local server started with `gbi`), so "automatic" means: on the first app start in a new month, fetch month-end prices, then save the snapshot of the previous month. Missing months are caught up from month-end prices with the current assumptions and labelled `recomputed`. "Save snapshot" stays as the manual way. Saved snapshots never change.

**Plan history: versioned.** `Goal.monthlyContribution` becomes a history of (fromMonth, amount). Editing it asks "from which month" (default: current month). Planned amount since `trackingStart` = the sum, month by month, of the plan in force in that month. `contributionGrowth` is used only for future projections, never for plan vs actual. Bucket weights are not versioned.

**Actual contributions: tracked per month, compared cumulatively.** Actual = invested money (non-`opening` buy transactions) per month. The user wants to invest flexibly: with a plan of €500/month on a goal, 0 in one month and 1,000 in the next is on plan. So plan vs actual compares **cumulative** totals since `trackingStart`, and the view also shows the actual monthly series. Cash set aside but not invested is not a contribution. If ever needed, it can be recorded as buys of a deposit product in the bucket, with no new concept.

**R1 Behind plan** fires only when the cumulative gap is larger than **N months of plan** (setting, default 3, user-configurable) **and** larger than the min efficient ticket. The alert shows the exact gap.

**Optimizer caps: per-product only in v1.** Class-level caps (e.g. Gold ≤ 20%) are a v2 candidate, as in the source spec. With 1–6 products per bucket, a gold ETC's per-product cap already acts as a class cap.

**v2 backlog.** The spec gets a "v2 candidates" section collecting what any ticket defers. Known so far: class-level optimizer caps (10), a second price provider such as EODHD (02). Ticket 15 publishes it as one GitHub issue "GBI v2 backlog" with a checklist, separate from the v1 issues `/ticket-loop` reads.

**Dismissed alerts.** A dismissal is stored as a record (ruleId, scope = goal or product, key, dismissedAt). Alerts themselves stay generated, never stored. A dismissed alert stays hidden while its key is unchanged. When the condition becomes false, the dismissal is cleared, so the alert returns the next time it is true. Key per rule:

| Rule | Key (alert returns when it changes) |
|---|---|
| R1 Behind plan, R6 Need off track | goal + month |
| R2 Deduction room | year |
| R3 Maturity ahead | product + maturity date (never returns for the same bond) |
| R4 Status worsened | goal + new status |
| R5 Stale prices, R10 Price fetch failed | set of products affected |
| R7 Costly trades | id of the latest costly trade |
| R8 Near goal, risky assets | goal (never returns for the same goal) |
| R9 Units mismatch | product + (bucket units, broker units) |

Check: the spec's data model has a contribution-plan history per goal and a Dismissal record with the keys above; a test where plan = 500/month and actual = 0 then 1,000 shows a cumulative gap of 0 after month 2 and no R1; a test with gap = 3 months + 1 € (above min ticket) fires R1; the spec has a "v2 candidates" section listing class-level caps; `gh issue list -R radema/finance-os --search "GBI v2 backlog"` shows one issue after ticket 15.
