# 01 — Storage engine: SQLite or DuckDB 2.0

Ticket: ../issues/01-storage-engine.md · Read: 2026-10-29

## Question

Which embedded store fits a single-user, local-first app with small frequent writes (transactions,
prices, import batches with undo, settings) and monthly time-series reads? Compare SQLite and DuckDB 2.0
(embedded and server mode). Is DuckDB server mode useful for one local user?

## Short answer

Use SQLite in WAL mode, with STRICT tables and money stored as integer cents (or TEXT decimals).
The workload is small row-level OLTP. SQLite is built for it, and ships with Python (`sqlite3`).
Time-series reads over a few thousand rows need no columnar engine.
DuckDB 2.0 server mode (Quack) solves multi-process writers and remote access. A single local user needs neither.
Revisit DuckDB only if analytics grow far beyond thousands of rows (inferred, not expected for v1).

## Comparison

| Topic | SQLite (WAL) | DuckDB 2.0 (embedded) | DuckDB 2.0 server (Quack) |
|---|---|---|---|
| Workload design | Row-oriented, transactional | Analytical (OLAP); docs expect large-scale changes, not row-by-row | Same engine, behind HTTP |
| Transactions | ACID, rollback journal or WAL | ACID via MVCC | Same |
| Concurrency | Many readers + 1 writer, same machine | Many writer threads in one process; optimistic, same-row conflict fails | Many processes can write |
| Web server + app | One writer at a time; readers never block | Open in one process only (read-only mode allows many readers) | Needs a second process and a token |
| Undo of import batch | `BEGIN`/`SAVEPOINT`, or `batch_id` column + `DELETE` | Same pattern; `DELETE` on indexed tables is rewritten as delete + insert | Same |
| Migrations | `ALTER TABLE` plus `PRAGMA user_version` (standard pattern; `ALTER` limits not fetched) | `ALTER` fails with Dependency Error on indexed columns (PK, UNIQUE); CHECK/FK cannot be added later | Same |
| Python | `sqlite3` in stdlib, DB-API | `pip install duckdb`, Python 3.11+, no free-threaded builds; one call at a time per connection | Client via `ATTACH 'quack:...'` |
| Decimal | No DECIMAL: `DECIMAL(10,5)` gets NUMERIC affinity, stored as INTEGER or 8-byte REAL (~15.95 digits). Use integer cents or TEXT | Native `DECIMAL(w,s)`, width 1–38, stored as integers | Same |
| Backup of one file | Online Backup API, `VACUUM INTO`, `Connection.backup()`. Raw copy must include `-wal` | `EXPORT DATABASE 'dir'` (CSV/Parquet + schema). File-copy guidance not found in docs read | Same |
| File format risk | Stable, very old | 2.0 files unreadable by versions before 2.0 | Same |
| Maturity | WAL since 2010; STRICT since 3.37.0 (2021) | 2.0.0 LTS released 2026-10-21, 8 days ago | Protocol first shipped 1.5.3; "polished" in 2.0 |

## What DuckDB 2.0 server mode is, and whether it helps

Confirmed:
- Server mode is the Quack protocol, an extension. One DuckDB process runs `CALL quack_serve(token = '...')`.
  Other DuckDB processes `ATTACH 'quack:localhost' AS qk (TOKEN '...')` and run `CONNECT qk;`.
- It runs over HTTP, default port 9494, binds to `localhost` by default, SSL off by default.
  The authors say to put a TLS reverse proxy in front for remote access.
- Purpose: embedded DuckDB keeps state in process memory, so several processes cannot safely write one file.
  Quack centralizes that state in one server so many writers can work.
- Authors' benchmark (AWS, 0.28 ms ping): 1,038 small transactions/s on one thread, 5,434 on eight.
  Small-write throughput stops scaling past about eight threads on one table.
- The 2.0 announcement does not label Quack "stable". The Quack post says first production release comes with 2.0.
  The concurrency docs say it "shipped in DuckDB 2.0".

Does it help here? No (inference from the above):
- One user, one web process: that process opens the file directly. No second writer exists.
- Server mode adds a token, a port, a process to start and keep alive. The brief says the app has no daemon.
- Its benchmark gain is multi-client write throughput. This app writes a few rows a minute.
- One real case: a CLI or a notebook that must write while the web app runs. SQLite WAL covers that
  on one machine (one writer at a time, readers unblocked).

## Why SQLite fits

- WAL: readers and writers run at the same time. Each reader sees a fixed snapshot.
  Only one writer at a time, which is fine for one user.
- The web server and a monthly-job script can both open the file on the same machine.
  WAL does not work on a network filesystem.
- Money: SQLite has no exact decimal. Store cents as INTEGER, or the decimal string as TEXT and parse with
  Python `Decimal`. Python `sqlite3` has no default Decimal adapter; write one (adapter recipes in the docs).
  For prices with many decimals, TEXT plus `Decimal` avoids REAL rounding.
- Python 3.12+ `connect(autocommit=False)` gives explicit `commit()`/`rollback()`; the docs recommend it.
- Time series: monthly series for a few thousand rows is a plain `GROUP BY` / window query. Both engines handle it.

## Risks

- SQLite: no native decimal. A float slip (`REAL` column, or an untyped column) rounds silently.
  Mitigate with STRICT tables and `INTEGER`/`TEXT` columns only. Add a test that rejects REAL money.
- SQLite: WAL needs `-wal` and `-shm` beside the file. A raw copy of only the `.db` file can lose commits.
  Always back up with `Connection.backup()` or `VACUUM INTO`.
- SQLite: WAL-reset bug in 3.7.0 through 3.51.2, fixed in 3.51.3 (2026-03-13). Check `sqlite3.sqlite_version` at start-up.
- SQLite: Python's `sqlite3` default transaction mode is still the legacy one. Set `autocommit` explicitly.
- DuckDB: 2.0 is eight days old. Python wheels, ORMs and tools may lag (the release notes say some clients lag a few days).
- DuckDB: files written by 2.0 cannot be read by older versions. Pinning the version is mandatory.
- DuckDB: indexed tables block most `ALTER` operations. This makes forward migrations harder than on SQLite.
- DuckDB: the previous app used it. Switching away loses no code (the repo is restarted) but any prior data needs an export/import.
- Both: SQL mixes with Python `Decimal`; the choice does not change the engine reference tests in the Excel audit (ticket 04).

## Not verified

- Alembic or SQLAlchemy support for DuckDB 2.0, and `ALTER TABLE` limits for SQLite (page not fetched).
- DuckDB's recommended file-level backup (`CHECKPOINT`, copy) — the export and overview pages say nothing.
- DuckDB small-write latency on a local file (no primary benchmark found; the Quack numbers are over a network).
- How `duckdb` returns DECIMAL to Python — the Python overview page does not say.
- Whether Quack is "stable": the sources disagree in wording (see above).
- Python `sqlite3` docs fetched were truncated at 100,000 characters; SAVEPOINT notes were not read.

## Sources

- https://duckdb.org/2026/10/21/announcing-duckdb-200 — 2026-10-29
- https://duckdb.org/news/ — 2026-10-29
- https://duckdb.org/2026/05/12/quack-remote-protocol — 2026-10-29
- https://duckdb.org/docs/2.0/connect/concurrency.html — 2026-10-29
- https://duckdb.org/docs/2.0/connect/overview.html — 2026-10-29
- https://duckdb.org/docs/2.0/sql/data_types/numeric.html — 2026-10-29
- https://duckdb.org/docs/2.0/sql/indexes.html — 2026-10-29
- https://duckdb.org/docs/2.0/sql/statements/alter_table.html — 2026-10-29
- https://duckdb.org/docs/2.0/sql/statements/export.html — 2026-10-29
- https://duckdb.org/docs/2.0/clients/python/overview.html — 2026-10-29
- https://duckdb.org/why_duckdb.html — 2026-10-29
- https://sqlite.org/wal.html (page updated 2026-08-25) — 2026-10-29
- https://sqlite.org/datatype3.html — 2026-10-29
- https://sqlite.org/backup.html — 2026-10-29
- https://docs.python.org/3/library/sqlite3.html — 2026-10-29

Note: web fetches return summaries from a small model, not raw page text. Quotes and figures above are as summarized.
