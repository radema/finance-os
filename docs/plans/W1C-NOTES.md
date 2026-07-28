# W1c plumbing — implementation notes

Branch: `feat/w1c-plumbing`, rebased onto `build/skeleton` tip `2cab22e`.

## C6 (append-only) enforcement
`tests/test_c6_append_only.py` greps `src/financeos/**/*.py` and `*.sql` for `UPDATE|DELETE`
co-occurring on a line with one of the 9 append-only fact tables (list derived from
`001_init.sql`'s own table-class comments, not guessed):

    operation, bucket_apportionment, price, evaluation_run, alert, recommendation,
    strategy_version, asset_classification_audit, snapshot

A second test asserts every name in that list is actually a `CREATE TABLE` in 001_init.sql, so
the list can't silently drift from the migration. Definition tables (asset, account,
portfolio, bucket, strategy, ...) are ordinary CRUD and excluded — `strategy.current_version_id`
is legitimately `UPDATE`d by `DuckDBStrategyRepository.freeze_version` (E-1 workaround).

## C4 positive half
`tests/test_c4_read_write_split.py` AST-scans every `.py` under `src/financeos` (excluding
`web/` and `adapters/duckdb/queries/` itself) for an import of
`financeos.adapters.duckdb.queries`; fails if any non-web module imports it.

## W1-W10
All ten in `tests/test_operation_repository_invariants.py`, one test (some two: positive +
negative) per invariant, hitting `DuckDBOperationRepository.write` directly — not Hypothesis-
randomized (time budget), deterministic scenarios per invariant. W10 additionally checked by
C6 plus a structural "no update/delete method" assertion.

## Engineering notes / divergences worth flagging
1. **DuckDB `pytz` gap (new, undocumented in HANDOFF).** DuckDB 1.5.5's Python client requires
   `pytz` (not a project dependency) to convert a native `TIMESTAMPTZ` column to `datetime` on
   fetch — writing (binding a `datetime` param) is unaffected. Worked around without adding a
   dependency: `connection.connect()` pins the session `SET TimeZone='UTC'`, and every
   repository read of a `TIMESTAMPTZ` column does `CAST(col AS VARCHAR)` +
   `adapters/duckdb/_time.parse_instant`. Affects `strategy.get_version` (frozen_at),
   `price.as_of` (recorded_at), `operation.for_accounts` (recorded_at). Flagging this as a
   sibling to E-1/E-2 for whoever writes migration 002 or new read paths.
2. **Demo fixture is deliberately the RFC-0005 §8.1 minimal shape**, not the full V1.0
   UX-0001 §8 fixture (which needs `over_apportioned`, `untargeted_allocation`,
   `unassigned_residual_above`, `bucket_below_target_value`, `heterogeneous_strategies` — none
   built). RFC-0005 §8.1 itself specifies "one Bucket holding 100% of both Assets" as the
   skeleton's scope, so this isn't a corpus divergence — but it does mean `demo/` cannot be
   trivially "grown into" the V1.0 fixture; V1.0's opening batch will need materially more
   fixture data (9 assets, 2 strategies, apportionment residuals).
3. **Negative CASH holding at portfolio level.** The skeleton CSV importer is BUY-only, so
   nothing ever funds the demo account — every BUY's auto cash leg (ADR-0026) leaves a large
   negative CASH position in `mv_holding` at the Portfolio level. Inert for the gate (Bucket
   scope never apportions CASH), asserted explicitly in `tests/test_queries.py`. A real
   importer will need TRANSFER_IN/COUPON/DIVIDEND before Net Worth is meaningful — V1.0 scope.
4. **`PriceView` ASOF resolution lives in `adapters/duckdb/repositories/price.py`**, not
   `adapters/duckdb/queries/`, because C4 forbids `app` from importing the latter. The wiring
   note's "already ASOF-resolved by the query layer" phrase is satisfied by a repository
   method, not the read-side `queries` package — worth confirming that's the intended reading.
5. **W6/W7/W8** implement the documented worked cases (correcting a legged primary; correcting
   a transfer side) faithfully, including the formula-generalization for W8 (delta quantity ×
   original price). A direct correction of a leg row (not modeled in ADR-L01's worked examples)
   is accepted without further pairing requirements — flagged in a code comment, not tested.
6. `financeos export --authored` (RFC-0009 §7.1) was **not** built — not one of the five CLI
   commands this task named, and no migration 002 is landing in this batch. Still an open
   follow-up per HANDOFF §4.1.
