# 15 — Publish implementation tickets on GitHub

Type: task
Status: open
Blocked by: 14
Map: ../map.md

## Question

AFK. `gh auth switch -u radema`, then run `/to-tickets` on spec.md with the shape decided in 13, publishing parent + sub-issues on radema/finance-os. Run a `spec-reviewer` `MODE: briefs` pass and fix blocking findings.

Input from ticket 10: also publish the spec's "v2 candidates" section as one GitHub issue "GBI v2 backlog" (checklist), not a sub-issue of the v1 parent.

Input from ticket 13: one parent per story S0–S6 (titles and `Codex review: yes` lines in ticket 13). Create labels `gbi-v1`, `ready-for-agent`, `ready-for-human` first; `gbi-v1` on parents and sub-issues, triage labels on sub-issues only, the v2 backlog issue without `gbi-v1`. Each parent carries its Definition of done, `## Sub-issue DAG` and `Intent: .scratch/gbi-v1/spec.md`. S0 starts with a `ready-for-human` tag gate that blocks the wipe; S1–S6 each end with one `ready-for-human` UI gate. Runs use `--base main`. When done, remind the user to merge `decide/gbi-v1-map` into `main` before running S0.
