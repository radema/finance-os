"""`export_authored` — RFC-0009 §7.1: the only recovery path for authored data.

Reads every Bucket's apportionment history, every Strategy's frozen-version lineage, and every
current `Asset` row through the repository ports, then hands each to
`adapters.exporters.yaml_authored` for serialization. See that module's docstring for what is
deliberately excluded (Decisions, Categories, asset-classification history) and which classes
round-trip through an existing importer.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from financeos.adapters.exporters.yaml_authored import (
    write_apportionment_history,
    write_asset_classifications,
    write_strategy_lineage,
)
from financeos.app.unit_of_work import UnitOfWork


@dataclass(frozen=True)
class ExportResult:
    """The files one `export --authored` run wrote."""

    apportionment_files: tuple[Path, ...]
    strategy_files: tuple[Path, ...]
    asset_file: Path


def export_authored(uow: UnitOfWork, out_dir: Path) -> ExportResult:
    """Export every authored class this codebase can currently read."""
    apportionment_files = tuple(
        write_apportionment_history(
            bucket_id, uow.apportionments.full_history(bucket_id), out_dir
        )
        for bucket_id in uow.buckets.all_ids()
    )

    strategy_files = tuple(
        path
        for strategy_id in uow.strategies.all_ids()
        for path in write_strategy_lineage(uow.strategies.all_versions(strategy_id), out_dir)
    )

    asset_file = write_asset_classifications(uow.assets.all(), out_dir)

    return ExportResult(
        apportionment_files=apportionment_files,
        strategy_files=strategy_files,
        asset_file=asset_file,
    )
