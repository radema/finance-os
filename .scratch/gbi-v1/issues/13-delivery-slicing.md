# 13 — How v1 is cut into GitHub stories for ticket-loop

Type: grilling
Status: open
Blocked by: 05, 06
Map: ../map.md

## Question

The source spec has 6 milestones. Decide the GitHub shape: one parent issue per milestone (story) or one parent for all; label names; what 'ready-for-agent' means here; the gate every trail must pass (lint, types, tests, parity fixture); and the order of stories, with the repo wipe first.

Input from ticket 06: the gate is already set (`pnpm gate`: Biome, tsc strict, Vitest incl. parity, build, `pnpm audit`; no Playwright, UI via `agent-browser` + user eyeball). The wipe story's scope is the keep/drop table in ticket 06.
