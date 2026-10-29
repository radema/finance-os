# 01 — Storage engine: SQLite or DuckDB 2.0

Type: research
Status: open
Blocked by: —
Map: ../map.md

## Question

Which embedded store fits a single-user, local-first app whose writes are small and frequent (transactions, prices, imports with undo, settings) and whose reads include monthly time series (performance, snapshots)? Compare SQLite and DuckDB 2.0 (embedded, and its new server mode): transactional writes and concurrency with a web server process, schema migrations, Python tooling, backup of one file, decimal support, maturity. Is DuckDB's server mode useful at all for one local user? Output: `research/01-storage-engine.md` with a recommendation.
