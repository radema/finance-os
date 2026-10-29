# 07 — Financial-independence levels

Type: grilling
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Source spec open questions: do the 300x and 200x multipliers apply to monthly expenses (300x monthly = 25x yearly, the 4% rule)? Level 1: the emergency-fund goal target or N months of essential expenses? Do pension funds count toward FI wealth, and from which age?

## Answer

Grilled with the user 2026-10-29. Changes to the source spec (`reference/source-spec.md` :31, :111-118, :165, :172-174) are marked **(change)**.

Levels (inputs in today's €, from `CashFlow.essential` / `CashFlow.optional`, which are monthly):

- **Level 1 Safety** = target of the emergency-fund goal when `efFromGoal` is set, else `efMonths` (default 12) × essential monthly expenses. Same as spec and mock.
- **Level 2 Barista FIRE** = `l2Mult` × essential **monthly** expenses (default 300 = 25 × yearly, the 4% rule). Confirmed.
- **Level 3 FIRE** = Level 2 + `l3Mult` × optional **monthly** expenses (default 200 ≈ 16.7 × yearly, about 6%: optional spending can be cut). Confirmed.
- Multipliers and `efMonths` stay editable; a change updates the levels at once.

Targets over time **(change)**: targets grow with `CashFlow.expenseGrowth`, the same field the cash-flow table uses. Nominal target(t) = target(0) × (1 + expenseGrowth)^t. Shown in today's €: target(t) = target(0) × ((1 + expenseGrowth) / (1 + inflation))^t. With expenseGrowth = inflation the lines are flat; above inflation they rise and push the year reached later. "Today" figures use target(0).

FI wealth:

- Sum of the **net** value (after liquidation taxes, per the engine's liquidation rule) of the buckets whose goal has `countsTowardFI = true`, deflated to today's €. Net both for today's value and the projection — this fixes mock bug M2 (`fireWealthNow()` sums gross; see ticket 04).
- `countsTowardFI` is a per-goal flag, editable from the goal form and from the FI screen (instant recompute).
- **Pension (change):** counts by default. `FireSettings.includePension` default **true** (spec and mock default false). No age logic. Pension net in year t = value − exit-tax rate of year t (15% → 9% with years of membership, as in the spec's liquidation rule) × basis.
- **Level 1 is measured without the pension bucket (change)**: a pension fund is not liquid and cannot cover an emergency. Levels 2 and 3 use the full FI wealth (pension included when `includePension` is true).

Display:

- FI screen: ladder and table show the pension share separately (progress bar split into accessible / pension, plus a table row). The projection fan stays on the total. Fan in today's €, with level lines following target(t). P(level reached) per year stays on the FI screen.
- Dashboard **(change)**: per level, today's % reached (net, today's prices) and estimated year reached (median and deterministic); plus a small line chart "% of target per year" = median projected FI wealth / target(t), one line per level. The full fan is FI screen only. Input for ticket 11.
- Engine output for the projection therefore adds, per year t: target(t) per level and the median ÷ target ratio; Level 1 uses its own wealth series (FI buckets without pension). Input for ticket 12.

Check: in the spec (`.scratch/gbi-v1/spec.md`), the FI section states `includePension` default true, Level 1 excludes the pension bucket, FI wealth is net today and projected, and targets grow by ((1 + expenseGrowth)/(1 + inflation))^t in today's €; an engine test with essential 1,000, optional 500, expenseGrowth = inflation gives L2 = 300,000 and L3 = 400,000 flat across all years, and with expenseGrowth one point above inflation gives L2(10) ≈ 300,000 × (1.03/1.02)^10 ≈ 331,000 (for 3% vs 2%).
