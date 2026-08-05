"""`export_backup` — a full, re-seedable CSV+YAML bundle, distinct from `export_authored`
(RFC-0009 §7.1). Product-owner decision, 2026-08-05: PRODUCT.md's "One DuckDB file; backup is
`cp`" line assumed the whole store lives in one file an operator can copy from outside the app;
this adds the alternative for when that isn't practical (the app is the only thing that can see
the live DuckDB file, e.g. `serve` running against it) — a bundle downloadable through the
`/data-io` screen and reloadable with the existing `financeos seed <bundle-dir>` command,
unchanged.

**Distinct from `export --authored` in shape and scope, on purpose:**

- `export_authored` covers *only* the classes with no other recovery path (apportionment
  history, Strategy+Rule lineage, asset classifications) in a YAML shape nothing currently
  re-imports for two of the three (apportionment, assets are export-only).
- `export_backup` covers *everything* `financeos seed` reads — including the derivable classes
  (Operations, prices) `export_authored`'s docstring says can already be rebuilt from raws — in
  the CSV/YAML shape `seed` itself parses, so the *whole* store round-trips through one existing
  command with no new importer.

**What does not round-trip exactly, and why that is an accepted gap, not an oversight:**

- Apportionment history: only the *current* (non-superseded) row per (bucket, asset) is
  exported — `financeos seed` only ever writes one row per pair, and the superseded chain has
  no meaning to reseed anyway. The full chain is `export --authored`'s job.
- CORRECTION-type Operations are excluded entirely. `import_operations` turns one CSV
  CORRECTION row into either one or two new `operation` rows depending on what it targets
  (`app.import_operations._correction_pair`); for a correction of a TRANSFER_IN/OUT side, the
  *counter*-correction on the paired sibling has no field of its own that distinguishes it as
  "already produced by another row" — exporting it back as a second CSV row would double-apply
  it on reseed. The demo fixture has zero CORRECTION rows, so this gap is untested here as a
  gap; restoring a Correction after reseeding a backup must be done by hand.
- `Asset`/`Portfolio`/`Bucket`/`Account`/`Strategy` identifiers are all preserved verbatim (they
  come straight from the CSV/YAML `financeos seed` itself would have minted them from), but
  `Operation`/apportionment/price row `id`s and `recorded_at` timestamps are re-minted by
  `IdGen`/`Clock` on reseed, same as any other `financeos seed` run.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from financeos.adapters.exporters.csv_backup import (
    write_accounts_csv,
    write_apportionment_csv,
    write_assets_csv,
    write_buckets_csv,
    write_operations_csv,
    write_portfolio_accounts_csv,
    write_portfolios_csv,
    write_prices_csv,
    write_strategy_yaml,
)
from financeos.app.unit_of_work import UnitOfWork
from financeos.core.portfolio import ApportionmentRecord, OperationType


@dataclass(frozen=True)
class BackupResult:
    """The files one full-backup run wrote, in `demo/`'s fixture-directory shape."""

    accounts_file: Path
    assets_file: Path
    portfolios_file: Path
    portfolio_accounts_file: Path
    buckets_file: Path
    apportionment_file: Path
    prices_file: Path
    operations_file: Path
    strategy_files: tuple[Path, ...]


def _current_apportionment(uow: UnitOfWork) -> tuple[ApportionmentRecord, ...]:
    """One row per (bucket, asset): every Bucket's `full_history`, minus whichever rows another
    row's `supersedes_id` names — the same "current" resolution `virtual_holdings` folds
    internally, exposed here because `apportionment.csv`'s shape has no `supersedes_id` column
    to carry the chain through in the first place."""
    current: list[ApportionmentRecord] = []
    for bucket_id in uow.buckets.all_ids():
        history = uow.apportionments.full_history(bucket_id)
        superseded_ids = {r.supersedes_id for r in history if r.supersedes_id is not None}
        current.extend(r for r in history if r.id not in superseded_ids)
    return tuple(current)


def export_backup(uow: UnitOfWork, out_dir: Path) -> BackupResult:
    """Export the whole store as a `financeos seed`-reloadable bundle."""
    accounts = uow.accounts.all()
    portfolios = uow.portfolios.all()
    buckets = tuple(uow.buckets.get(bucket_id) for bucket_id in uow.buckets.all_ids())
    operations = tuple(
        op for op in uow.operations.all_primary() if op.type is not OperationType.CORRECTION
    )
    strategy_versions = tuple(
        uow.strategies.current_version(strategy_id) for strategy_id in uow.strategies.all_ids()
    )

    return BackupResult(
        accounts_file=write_accounts_csv(accounts, out_dir),
        assets_file=write_assets_csv(uow.assets.all(), out_dir),
        portfolios_file=write_portfolios_csv(portfolios, out_dir),
        portfolio_accounts_file=write_portfolio_accounts_csv(portfolios, out_dir),
        buckets_file=write_buckets_csv(buckets, out_dir),
        apportionment_file=write_apportionment_csv(_current_apportionment(uow), out_dir),
        prices_file=write_prices_csv(uow.prices.all(), out_dir),
        operations_file=write_operations_csv(operations, out_dir),
        strategy_files=tuple(write_strategy_yaml(v, out_dir) for v in strategy_versions),
    )
