# 01 — Storage engine: SQLite or DuckDB 2.0

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Which embedded store fits a single-user, local-first app whose writes are small and frequent (transactions, prices, imports with undo, settings) and whose reads include monthly time series (performance, snapshots)? Compare SQLite and DuckDB 2.0 (embedded, and its new server mode): transactional writes and concurrency with a web server process, schema migrations, Python tooling, backup of one file, decimal support, maturity. Is DuckDB's server mode useful at all for one local user? Output: `research/01-storage-engine.md` with a recommendation.

## Answer

Findings: [research/01-storage-engine.md](../research/01-storage-engine.md).

Recommendation: SQLite in WAL mode, STRICT tables, money as integer cents or TEXT read into Python `Decimal`. The workload is small row-level writes plus small time-series reads; SQLite is built for it and ships with Python (online backup via `Connection.backup` / `VACUUM INTO`). DuckDB 2.0 server mode (Quack) solves several writer processes and remote access — one local user needs neither, and it adds a port, a token and a process. DuckDB 2.0 files are not readable by older versions. Final choice is made in ticket 05 (stack).

Check: `research/01-storage-engine.md` exists with sources; ticket 05's answer names the store and cites this file.
