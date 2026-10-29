# 14 — Write the v1 spec

Type: task
Status: resolved
Blocked by: 02, 05, 06, 07, 08, 10, 11, 12, 13, 16
Map: ../map.md

## Question

AFK. Run `/to-spec` to write `.scratch/gbi-v1/spec.md` from `reference/source-spec.md` plus every resolved ticket, with `AC-` ids. Run a `spec-reviewer` pass (SPEC = spec.md, DECISION = map.md) and fix blocking findings.

Input from ticket 10: the spec has a "v2 candidates" section, collected from every resolved ticket's deferred items.

Input from ticket 13: group the spec's `AC-` ids by story S0–S6 (story table in ticket 13), so ticket 15 can cut one parent per story; write each story's Definition of done. Dark mode is in v1; Playwright, the Excel v2 importer and mobile layout from 360 px are not (the last two go to "v2 candidates"); v1 layout is usable down to ~1024 px. Ticket 16's changes enter only through the spec, never as prototype code.

Input from ticket 16 (2026-10-29): add a final story **S7 — UI/UX polish**, after S6: start with an impeccable audit of the built app, then fix its findings and the UI gaps listed in `prototypes/16-app/NOTES.md`. Copy the ticket 16 decisions (31 December goal date, proportional stub year, per-kind price age, own XLSX reader, pnpm pin) into the spec.

## Answer

Spec: [spec.md](../spec.md) (AFK, 2026-10-29). 93 acceptance criteria AC-1…AC-93, grouped under S0–S7 headings; each heading is that story's Definition of done. Ids are global, so ticket 15 can move one AC to the next story without renaming.

- Covers: every resolved ticket (tagged "(tNN)" in the spec), keep/drop table and new `CLAUDE.md` sections, the 11 source-spec open questions (table in Further Notes), v2 candidates (13 items), S7 UI/UX polish starting with an impeccable audit.
- **Ticket 16's 31 December due date overrides ticket 12:** the stub year is followed by full years through the goal year (contribution included), target inflation and FI deflation use the real time τ = f + (goalYear − Y0). Ticket 12's golden case (a) becomes 2,600 (was 1,400); ticket 12's M1 wording ("`y <= g.year` becomes `y < g.year`") no longer holds — contributions run through the goal year in every function.
- Choices made while writing (no ticket covered them; veto if wrong): Commission has `plan` + `feeModel` (`percent` | `flat`) and a user-set `minTicket` for flat plans (t03 Check); settings stored as zod-validated JSON documents, no settings history (t16 finding 22); units/prices as integers × 10^6; backups once a day at start; fixtures folder `fixtures/`; optimizer budget restated as 286 mixes (the source's 462 exceeds what its own step rules allow); S7 also ends with a UI gate; products/goals CSV import, generic CSV mapping and R9 broker units stay in v1.
- Map fog cleared: perf budgets kept (t16 measured 5–10× margin); glossary = term list in the spec, wording by the user later.
- `/to-spec` steps skipped by the AFK brief: no seam check with the user, no publishing (ticket 15 publishes), user stories kept short.

Spec-reviewer (one pass, verdict needs-rework): 2 blocking findings fixed — the mock differential domain (contributionGrowth 0, ralGrowth 0, named functions, cash flow from Y0+2, buy-only plan vs actual) and AC-32 undo (dump excludes ImportBatch). Should-fix findings also fixed: AC-25 limited to S1 columns, fixture extended in S3/S4, required contribution solved when r > 0, duplicate rule compares file vs stored totals (and is marked as an engineering refinement of t08), Y0 refund rule, coupon with no holder → "needs a goal", targetYear < Y0 clamped, plan vs actual from trackingStart, `fixtures/` path named, AC-90 made checkable.

Still open (not fixed):
- R7 and min efficient ticket with `feeModel = flat` (no rate; rate = 0 divides by zero) — define in S1/S5 briefs or ask the user.
- Nits: AC-9 port not named; AC-14 does not state contributionGrowth 0; R1 "N months of plan" does not name the plan version (use the plan in force in the current month).
- Outside this ticket: ticket 13's Check line and the map say 7 parents S0–S6; with S7 there are 8 — ticket 15's check must expect 8.

Check: `.scratch/gbi-v1/spec.md` exists; `grep -c '^- AC-' .scratch/gbi-v1/spec.md` prints 93; it has headings S0–S7 under "Definition of done", a "v2 candidates" section and a "Source spec open questions" table with 11 rows.
