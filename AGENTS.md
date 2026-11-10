# AGENTS.md

## What this is

GBI planner — a local, single-user goal-based investing app. It runs on the user's MacBook as a
local server on `127.0.0.1` plus a browser page, started by the `gbi` command.

## Source of truth

- `.scratch/gbi-v1/spec.md` is the spec. When code and spec disagree, the code is wrong — or the spec
  is fixed first, with the user's OK. Never change behaviour the spec defines without that.
- Non-obvious technical choices: a short ADR in `.scratch/gbi-v1/adr/NNNN-slug.md`.
  Domain terms (English + Italian): `.scratch/gbi-v1/glossary.md`.
- The rest of `.scratch/gbi-v1/` (map, tickets, research) is planning history, not rules.
- Old Finance OS code and docs live only in the git tag `finance-os-legacy`. Never follow them.

## Commands

The package manager is pinned: `pnpm@10.32.1` (`packageManager` in `package.json`).
Rename a script and you update this list in the same PR.

    pnpm install          # lockfile is committed; install scripts are blocked
    pnpm dev              # server + Vite dev UI
    pnpm test             # Vitest (unit, property, architecture)
    pnpm gate             # the full gate, see below
    pnpm build && gbi     # build the bundle and start the installed app

## Gate

`pnpm gate` runs: Biome (lint + format check), `tsc --noEmit` (strict), Vitest including the golden
cases, mock differential and fixture snapshot, `pnpm build`, `pnpm audit`. Nothing merges unless it passes.
UI changes: check the page with `agent-browser`, then the user checks it by eye. No Playwright.

## Architecture

One package: `engine/`, `server/`, `web/`. Node 24, React + Vite, ECharts, SQLite via `node:sqlite`
+ Kysely, zod schemas shared by server and web.

1. `engine/` is pure: no I/O, no imports from `node:*`, `server/` or `web/`.
2. `web/` talks to the server only through the REST API.
3. SQL only in `server/`, through Kysely. Migrations are forward-only.
4. Money is integer cents in the DB; rounding happens only in the view.
5. Network: only downloads of public prices. User data never leaves the machine. No CDN — every
   asset (fonts, libraries) is bundled.
6. Dependencies: exact versions, as few as possible. A new dependency is justified in the PR.

Rules 1–3 are enforced by a test or a Biome rule, not only written here.

Node type stripping: the server runs the TypeScript sources directly. Use `.ts` import extensions,
no enums, no parameter properties, `import type` for types. `tsconfig.json` sets
`erasableSyntaxOnly` and `verbatimModuleSyntax`.

### Architecture evolution

- Architecture-review records live in `.scratch/gbi-v1/architecture/`; they are planning evidence,
  not rules. When changing a reviewed cluster, read its record, improve the cluster when the change
  demonstrates real friction, and refresh the record when its evidence changes.
- Reorganize one coherent, actively changing cluster at a time. Keep paired tests with the
  implementation.

## Clean code

- Start with the simplest thing that works. Add complexity only where a real need shows up.
- No duplicated logic, no abstraction used once, no speculative options or config.
- No code smells: long functions, dead code, magic numbers, comments that repeat the code.

## Data

- Data lives in `GBI_DATA_DIR` (default `~/Library/Application Support/gbi/`), never in the repo.
- Never commit personal data: `.gitignore` blocks `*.sqlite`, `*.db`, `*.xlsx`, `*.csv` outside the
  declared fixtures folder. Do not work around it.

## Design

Follow `DESIGN.md` (palette D + OE Data Viz exhibit rules). Chart colours come from tokens, never
literals.

## Language

Code, identifiers, commits and docs in English. UI in English, with an Italian glossary.

## Git

- `main` is the trunk. Story work on `feat/...` branches from `main`, PR to `main`. The user merges.
- Conventional commits, lowercase, citing the sub-issue or the spec `AC-` id.
- Follow the model-routing instructions supplied for the current session.
