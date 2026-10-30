# 15 — Publish implementation tickets on GitHub

Type: task
Status: resolved
Blocked by: 14
Map: ../map.md

## Question

AFK. `gh auth switch -u radema`, then run `/to-tickets` on spec.md with the shape decided in 13, publishing parent + sub-issues on radema/finance-os. Run a `spec-reviewer` `MODE: briefs` pass and fix blocking findings.

Input from ticket 10: also publish the spec's "v2 candidates" section as one GitHub issue "GBI v2 backlog" (checklist), not a sub-issue of the v1 parent.

Input from ticket 13: one parent per story S0–S6 (titles and `Codex review: yes` lines in ticket 13). Create labels `gbi-v1`, `ready-for-agent`, `ready-for-human` first; `gbi-v1` on parents and sub-issues, triage labels on sub-issues only, the v2 backlog issue without `gbi-v1`. Each parent carries its Definition of done, `## Sub-issue DAG` and `Intent: .scratch/gbi-v1/spec.md`. S0 starts with a `ready-for-human` tag gate that blocks the wipe; S1–S6 each end with one `ready-for-human` UI gate. Runs use `--base main`. When done, remind the user to merge `decide/gbi-v1-map` into `main` before running S0.

Input from ticket 16 (2026-10-29): add a final story **S7 — UI/UX polish**, after S6: start with an impeccable audit of the built app, then fix its findings and the UI gaps listed in `prototypes/16-app/NOTES.md`. Copy the ticket 16 decisions (31 December goal date, proportional stub year, per-kind price age, own XLSX reader, pnpm pin) into the spec.

## Answer

Published on [radema/finance-os](https://github.com/radema/finance-os/issues?q=label%3Agbi-v1) (2026-10-30). The briefs and the `publish.py` script are in `~/.local/state/reviews/finance-os/gbi-15/`; they are not in the repo.

| Parent | Story | Sub-issues |
|---|---|---|
| [#2](https://github.com/radema/finance-os/issues/2) | S0 Wipe and scaffold | #10–#15 (6) |
| [#3](https://github.com/radema/finance-os/issues/3) | S1 Goals and deterministic projection | #16–#25 (10) |
| [#4](https://github.com/radema/finance-os/issues/4) | S2 Import, prices and data safety | #26–#39 (14) |
| [#5](https://github.com/radema/finance-os/issues/5) | S3 Pension and cash flow | #40–#45 (6) |
| [#6](https://github.com/radema/finance-os/issues/6) | S4 Monte Carlo, required contributions and FI | #46–#52 (7) |
| [#7](https://github.com/radema/finance-os/issues/7) | S5 Tracking and Dashboard | #53–#61 (9) |
| [#8](https://github.com/radema/finance-os/issues/8) | S6 Optimizer and polish | #62–#69 (8) |
| [#9](https://github.com/radema/finance-os/issues/9) | S7 UI/UX polish | #70–#74 (5) |

- GBI v2 backlog: [#75](https://github.com/radema/finance-os/issues/75), 13 checklist items, no label, not a sub-issue.
- 8 parents (not 7: S7 was added by ticket 16). Each parent has `Intent: .scratch/gbi-v1/spec.md`, a `Codex review: yes` line on S1, S3, S4 and S6, its Definition of done, a `## Sub-issue DAG` (mermaid) and the parallel waves.
- Each sub-issue: body with Parent / What to build / Acceptance criteria / Blocked by, the agent brief as the first comment, a native sub-issue link to its parent, native `blocked_by` links, and labels `gbi-v1` + `ready-for-agent` or `ready-for-human`. S0 starts with the human tag gate #10. S1–S6 each end with a human UI gate. S7 starts with the impeccable audit #70.
- Spec-reviewer `MODE: briefs` (one pass, needs-rework): the 3 blocking findings and most should-fix findings were fixed before publishing. Not fixed: S1.6 (#21) and S5.8 (#60) may be size L; ticket-loop can split them.
- User decisions during this ticket: undoing a products/goals import batch deletes only the rows it created; the required-contribution rule text wins over the AC-57 wording; refund room = max(0, cap + extra − worker − employer). The last two are now written in spec.md.
- `publish.py` changed to two passes: it creates every sub-issue first, then writes the bodies, because S0.1's body names S0.2.
- Merge `decide/gbi-v1-spec` into `main` before running S0.

Check: `gh issue list -R radema/finance-os --label gbi-v1 --state all --limit 200` lists 73 issues (8 parents + 65 sub-issues); `gh api repos/radema/finance-os/issues/<parent>/sub_issues` returns 65 distinct sub-issues across #2–#9, each with `## Parent #<that parent>` in its body; all 8 parent bodies contain `## Sub-issue DAG`. AC-1…AC-93 all appear in sub-issue bodies, and each brief's `**AC:**` line names exactly one owner per AC (`publish.py check`: OK). AC-31, AC-89 and AC-92 are also named in one more sub-issue's criteria ("keeps AC-31 true" in #30, "refines AC-89, triage part" in #71, "refines AC-92" in #72). These are cross-references, not second owners.
