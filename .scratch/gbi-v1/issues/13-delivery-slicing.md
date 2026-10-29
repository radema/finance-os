# 13 — How v1 is cut into GitHub stories for ticket-loop

Type: grilling
Status: resolved
Blocked by: 05, 06
Map: ../map.md

## Question

The source spec has 6 milestones. Decide the GitHub shape: one parent issue per milestone (story) or one parent for all; label names; what 'ready-for-agent' means here; the gate every trail must pass (lint, types, tests, parity fixture); and the order of stories, with the repo wipe first.

Input from ticket 06: the gate is already set (`pnpm gate`: Biome, tsc strict, Vitest incl. parity, build, `pnpm audit`; no Playwright, UI via `agent-browser` + user eyeball). The wipe story's scope is the keep/drop table in ticket 06.

## Answer

Grilled with the user 2026-10-29 (6 questions). Sources: ticket-loop skill (one parent issue = one story = one branch = one PR), `to-tickets`, `triage/AGENT-BRIEF.md`, `reference/source-spec.md` "Delivery plan", tickets 05, 06, 10, 11, 12.

**Shape: one GitHub parent issue per story, seven stories, cut vertically.** The source spec's 6 milestones are horizontal (engine, then MC, then data, then screens). v1 is re-cut so that every story after S0 ends with usable screens (ticket 05's first increment; to-tickets' vertical-slice rule). Each parent's sub-issues are its tickets. Stories run in order: story k+1 is started only after story k's PR is merged into `main` (ticket-loop branches from `origin/main`). The list below is the outline. Ticket 14 fixes the exact `AC-` ids per story, and ticket 15 may move one item to the next story when a story would not fit, but keeps the order.

| Story | Parent title | Scope (outline) | `Codex review: yes` |
|---|---|---|---|
| S0 | GBI v1 · S0 — Wipe and scaffold | Tag gate (below); wipe per ticket 06 keep/drop, new `CLAUDE.md`, new `.gitignore`; pnpm project with `engine/ server/ web/`, `pnpm gate`, `.github/workflows/gate.yml`, `gbi` command, empty app shell (sidebar, palette D tokens, Geist) | no |
| S1 | GBI v1 · S1 — Goals and deterministic projection | Engine core (holdings from transactions, taxes, stamp duty, commission in basis, `couponRate`, stub year), SQLite schema + migrations, Setup (Products, Allocation, Goals, Assumptions), Transactions screen, Goals table (deterministic columns); golden cases, mock differential test, synthetic fixture (ticket 12) | yes |
| S2 | GBI v1 · S2 — Import, prices and data safety | Import pipeline with Fineco XLSX preset, splits, undo; "Current portfolio" opening form (ticket 08); Prices screen (manual, CSV, Yahoo); JSON export/import; auto backups | no |
| S3 | GBI v1 · S3 — Pension and cash flow | Pension schedule, deduction and refund, exit tax, yearly flow mix; Pension screen; Setup Cash flow + 10-year table | yes |
| S4 | GBI v1 · S4 — Monte Carlo, required contributions and FI | Seeded correlated MC, P(success), fan, required contribution by bisection; Goals MC columns + Goal detail; FI levels engine + Financial independence screen | yes |
| S5 | GBI v1 · S5 — Tracking and Dashboard | Snapshots (monthly catch-up + manual), Goal history, Performance, versioned plan + Plan vs actual, monthly job, Dashboard, rules R1–R10 with Dismissal (ticket 10) | no |
| S6 | GBI v1 · S6 — Optimizer and polish | Mix optimizer O1–O5, Glossary & method, dark mode, layout usable down to ~1024 px | yes |

**Scope changes vs the source spec's milestones** (decided with the user):

- One-off **Excel v2 importer**: out of v1 → v2 candidates (the opening goes through the "Current portfolio" form).
- **Dark mode**: in v1 (S6).
- **Mobile layout from 360 px**: out of v1 → v2 candidates. v1 is desktop-first, usable down to ~1024 px (ticket 11).
- **Playwright suite**: dropped (ticket 06).

**Labels** (ticket 15 creates them; the repo has only GitHub's defaults today):

- `gbi-v1` on every parent and sub-issue (the map's Done-when query). The "GBI v2 backlog" issue does not carry it.
- `ready-for-agent` / `ready-for-human` on sub-issues only, per the user-scope triage mapping. Parents carry no triage label.

**What `ready-for-agent` means here.** A sub-issue with an `## Agent Brief` comment (AGENT-BRIEF.md format) that has `**Dipendenze:**`, `**Complessità:**` (XS, S or M; L is split before publishing), `**Agente:**` and `**AC:**` lines; every `AC-` id resolves to the spec; the acceptance criteria name their checks; the brief has no file paths. The parent body carries the story's `## Definition of done` (its `AC-` ids with check and expected result), the `## Sub-issue DAG`, `Intent: .scratch/gbi-v1/spec.md`, and `Codex review: yes` where the table says so.

**`ready-for-human` gates.**

- S0 starts with a gate: the user creates and pushes the annotated tag `finance-os-legacy` on `fb215e5` (`git tag -a finance-os-legacy fb215e5 -m "..."`, `git push origin finance-os-legacy`). The wipe sub-issue depends on it. ticket-loop never pushes tags.
- S1–S6 each end with one UI gate: the agent checks the story's screens with `agent-browser` and prepares screenshots and notes; the user looks and approves or skips. One gate per story, not per screen.

**Gate every trail must pass.** `pnpm gate` (Biome, `tsc --noEmit` strict, Vitest incl. golden cases + mock differential + fixture snapshot, `pnpm build`, `pnpm audit`, ticket 06) green in the trail worktree, reported as `checks: pnpm gate exit 0`. Exception: the S0 wipe sub-issue runs before `pnpm gate` exists; its check is ticket 06's Check line. From S0 on, `.github/workflows/gate.yml` runs `pnpm gate` on every PR to `main` (the user chose CI; private repos get Actions minutes), so `/ticket-loop pr` needs no `--test-cmd`.

**Running it.** `/ticket-loop #<parent> --base main` (the repo has no `dev`), then `/ticket-loop pr <story> --title "#<N>: <parent title>"`. The user merges each PR.

**Precondition (user, before S0 runs).** Merge `decide/gbi-v1-map` into `main` right after ticket 15, so `spec.md` and `.scratch/gbi-v1/` are on `main` when ticket-loop branches from it.

**Ticket 16 (working prototype).** No prototype code carries into the stories. Its changes reach them only through the spec (ticket 14); briefs may cite the prototype as a UI reference, the same way as the mock.

Check: after ticket 15, `gh issue list -R radema/finance-os --label gbi-v1 --search "GBI v1 · S in:title"` shows 7 parents S0–S6, each with sub-issues labelled `ready-for-agent` or `ready-for-human`; S0's first sub-issue is the tag gate and blocks the wipe; the bodies of S1, S3, S4 and S6 contain `Codex review: yes`; after S0 merges, `.github/workflows/gate.yml` runs `pnpm gate` and the S0 PR shows it green; the spec's v2 candidates list the Excel v2 importer and mobile layout.
