"""Application use cases — the only layer holding ports (RFC-0005 §4).

`financeos.app` may not import `financeos.adapters.duckdb.queries` (contract C4): read-side
query modules are for `financeos.web` only.
"""

from financeos.app.apportion_bucket import apportion_bucket
from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.export_authored import ExportResult, export_authored
from financeos.app.import_operations import import_operations
from financeos.app.import_strategy import import_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork, UnitOfWork

__all__ = [
    "DuckDBUnitOfWork",
    "ExportResult",
    "UnitOfWork",
    "apportion_bucket",
    "evaluate_strategy",
    "export_authored",
    "import_operations",
    "import_strategy",
]
