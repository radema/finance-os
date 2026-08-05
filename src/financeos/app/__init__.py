"""Application use cases — the only layer holding ports (RFC-0005 §4).

`financeos.app` may not import `financeos.adapters.duckdb.queries` (contract C4): read-side
query modules are for `financeos.web` only.
"""

from financeos.app.apportion_bucket import apportion_bucket
from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.export_authored import ExportResult, export_authored
from financeos.app.export_backup import BackupResult, export_backup
from financeos.app.import_operations import import_operations
from financeos.app.import_prices import import_prices
from financeos.app.import_strategy import import_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork, UnitOfWork

__all__ = [
    "BackupResult",
    "DuckDBUnitOfWork",
    "ExportResult",
    "UnitOfWork",
    "apportion_bucket",
    "evaluate_strategy",
    "export_authored",
    "export_backup",
    "import_operations",
    "import_prices",
    "import_strategy",
]
