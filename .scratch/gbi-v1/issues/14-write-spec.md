# 14 — Write the v1 spec

Type: task
Status: open
Blocked by: 02, 05, 06, 07, 08, 10, 11, 12, 13, 16
Map: ../map.md

## Question

AFK. Run `/to-spec` to write `.scratch/gbi-v1/spec.md` from `reference/source-spec.md` plus every resolved ticket, with `AC-` ids. Run a `spec-reviewer` pass (SPEC = spec.md, DECISION = map.md) and fix blocking findings.

Input from ticket 10: the spec has a "v2 candidates" section, collected from every resolved ticket's deferred items.

Input from ticket 13: group the spec's `AC-` ids by story S0–S6 (story table in ticket 13), so ticket 15 can cut one parent per story; write each story's Definition of done. Dark mode is in v1; Playwright, the Excel v2 importer and mobile layout from 360 px are not (the last two go to "v2 candidates"); v1 layout is usable down to ~1024 px. Ticket 16's changes enter only through the spec, never as prototype code.
