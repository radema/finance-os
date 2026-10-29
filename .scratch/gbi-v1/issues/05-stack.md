# 05 — Stack for an incremental build

Type: grilling
Status: resolved
Blocked by: 01
Map: ../map.md

## Question

The source spec proposes Python engine + FastAPI + SQLite + React SPA in one Docker image, and asks about a single-language TypeScript app with the engine in the browser. The user wants simple first, complex only where needed, clean code. Decide: engine language (port of the mock JS engine), API shape, frontend (server-rendered + htmx vs React SPA vs TS app), chart library (ECharts vs Chart.js vs other, given the OE exhibit rules), storage (from 01), packaging. State what the first increment is and what triggers a later upgrade.

Constraint added by the user (2026-10-29): the app must be installable on the user's personal MacBook, with a fitting install mode (e.g. `uv tool install`, a Homebrew formula, a packaged `.app`, Docker Desktop — compare, keep it simple). Data always stays local on the machine and never goes to a cloud service. Decide the install and update path, where the data file lives on macOS, how backup works, and how the monthly job (prices + snapshot) runs without a server.

## Answer

Decided with the user, 2026-10-29 (grilling, 10 questions).

| Area | Decision |
|---|---|
| Shape | Local server on `127.0.0.1` + browser; one `gbi` command starts it and opens the page. |
| Language | TypeScript everywhere. |
| Engine | Pure TS module (no I/O), ported function by function from `reference/mock-app.html`, behind an interface. Escalation path for harder numerics: `@stdlib` libs → Python sidecar (`uv run`, JSON in/out) → WASM. One engine only, never duplicated across languages. |
| Server | Node 24 LTS; REST JSON; zod schemas shared with the UI. One package, folders `engine/ server/ web/`. |
| UI | React + Vite; charts with Apache ECharts, themed from palette D + OE Data Viz rules. No Plotly. |
| Storage | SQLite via built-in `node:sqlite` (no native module); Kysely query builder (zero runtime deps); TS migrations applied at start. Money as integer cents in the DB (prices/units with more decimals), float64 in the engine; rounding only in display. To verify in the spec: how Kysely binds to `node:sqlite` (direct or a small adapter). Research 01 backs SQLite. |
| Data folder | Configurable: `GBI_DATA_DIR`, default `~/Library/Application Support/gbi/`; warn if the folder is cloud-synced. Auto backup with `VACUUM INTO` to `<data>/backups/`, keep 30; full JSON export on demand. Docker-compatible via a volume on `/data`. |
| Network | Only downloads of public data (prices). Prices via `yahoo-finance2` (npm) instead of yfinance — supersedes the library named in ticket 02; the rest of 02 holds. User data never leaves the Mac. |
| Monthly job | Catch-up of missing months at start, plus a manual trigger limited to once a day unless the last run failed. No launchd. |
| Supply chain | pnpm 10: install scripts blocked, `minimumReleaseAge` 7 days, exact versions, committed lockfile, few deps, `pnpm audit` in the gate. Installed app is one JS bundle: no `node_modules` at runtime. |
| Install | Build the bundle, install globally from the repo (`gbi` command) on the user's MacBook. |
| Tests | Vitest + fast-check; differential tests against the mock engine; parity fixture (ticket 12); Playwright for UI smoke. |
| Quality | TypeScript `strict`; Biome for lint + format. |
| First increment | Engine + DB + minimal server + one screen; later milestones add screens without changing the stack. |

Check: `package.json` pins exact versions with `pnpm` as `packageManager`; `.npmrc`/`pnpm-workspace.yaml` sets `minimumReleaseAge`; `pnpm build && gbi` starts a server bound to 127.0.0.1 with the DB in `GBI_DATA_DIR`; `grep -r "plotly\|better-sqlite3" package.json` returns nothing.
