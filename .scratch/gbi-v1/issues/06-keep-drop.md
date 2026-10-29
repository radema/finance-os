# 06 — What to keep from the current repo, and the new CLAUDE.md

Type: grilling
Status: resolved
Blocked by: 05
Map: ../map.md

## Question

The repo is emptied and restarted. Using the inventory (old stack: Python, DuckDB, FastAPI, Jinja + htmx, vendored ECharts and fonts, design tokens, DESIGN.md, PRODUCT.md, RFC corpus, wiki, handoffs, demo data, real/ layout), decide per item: keep as is, keep adapted, or delete. Decide what the new `CLAUDE.md` says (commands, gate, architecture rules, design rules) so ticket-loop implementers follow the new rules, and how the old state is preserved (tag, archive folder). (The old HANDOFF-* files are already in docs/archive/.)

## Answer

Decided with the user, 2026-10-29 (grilling, 3 rounds). The wipe itself is the first implementation sub-issue.

**Old state.** Annotated tag `finance-os-legacy` on `fb215e5` (current `main`), pushed to origin, created before the wipe. No `archive/` folder: old code and docs live only in git history. Old local branches are out of scope: the wipe does not touch them (a later `/git-sweep` is separate work).

**Keep / drop.**

| Item | Verdict |
|---|---|
| `src/`, `tests/`, `pyproject.toml`, `uv.lock` | delete |
| `docs/seed/`, `docs/wiki/`, `docs/plans/`, `docs/archive/`, `docs/handoff/`, `docs/features-candidates/`, `docs/design/` | delete |
| `PRODUCT.md` | delete |
| `README.md` | delete; new one written from scratch |
| `DESIGN.md`, `.impeccable/` | delete; new `DESIGN.md` built from ticket 11's assets (with impeccable if useful) |
| Fonts in `src/financeos/web/static/fonts/` | delete; ticket 11 picks the fonts (user prefers a fresher, modern face); old ones stay reachable in the tag as fallback |
| `demo/`, `real/` | delete; data lives in `GBI_DATA_DIR` (ticket 05), new demo data comes from the spec |
| `.gitignore` | keep adapted: rewritten for Node (`node_modules/`, `dist/`, coverage, tool caches); keeps `.claude/worktrees/`, OS/editor files, `*:Zone.Identifier`; adds `*.sqlite`, `*.db`, `*.xlsx`, `*.csv` outside a declared fixtures folder |
| `CLAUDE.md` | replace with the new one (draft below) |
| `.scratch/gbi-v1/` | keep as is (already tracked, not ignored) |

**Where truth lives during the build.** `.scratch/gbi-v1/spec.md` is the source of truth; ADRs go to `.scratch/gbi-v1/adr/NNNN-slug.md`, the glossary to `.scratch/gbi-v1/glossary.md`. They move to `docs/` (with any `docs/adr`, `docs/wiki`) only when implementation is done and the real app docs are written. No RFCs, no numbered invariants.

**Gate.** `pnpm gate` = Biome (lint + format) + `tsc --noEmit` strict + Vitest (incl. parity fixture) + `pnpm build` + `pnpm audit`. No Playwright: UI is checked with `agent-browser` by the agent, then by the user by eye. This supersedes the "Playwright for UI smoke" part of ticket 05.

**New CLAUDE.md.** Short (60–80 lines): what the app is, source of truth, commands, gate, six architecture rules (pure engine; web only via REST; SQL only in server via Kysely, forward-only migrations; money in integer cents; network only for public prices, no CDN; few exact-pinned deps), clean code (simple first, complexity only where needed, no duplication, no single-use abstractions, no code smells), data rules, design (points to `DESIGN.md`), language, git (`main` trunk, `feat/...` branches, PR to `main`, user merges, conventional commits citing sub-issue or `AC-`, Sonnet implements / Opus reviews). Draft: [research/06-claude-md-draft.md](../research/06-claude-md-draft.md).

Check: after the wipe sub-issue, `git ls-remote --tags origin finance-os-legacy` returns `fb215e5…`; `git ls-files src/financeos docs/seed demo real DESIGN.md PRODUCT.md .impeccable` returns nothing; `CLAUDE.md` matches the draft's sections; `git check-ignore -q x.sqlite x.xlsx x.csv` exits 0.
