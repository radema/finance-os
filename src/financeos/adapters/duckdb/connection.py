"""DuckDB connection + forward-only migration runner (RFC-0009 §7).

One file, `platformdirs`-located (RFC-0005 §5.2). Migrations are numbered SQL scripts applied
in order inside a transaction; `schema_version` (created by `001_init.sql` itself) records
which have run, so re-running `migrate` is idempotent.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
from platformdirs import user_data_dir

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
APP_NAME = "FinanceOS"


def default_db_path() -> Path:
    """The single DuckDB file's default location (RFC-0005 §6)."""
    return Path(user_data_dir(APP_NAME, appauthor=False)) / "financeos.duckdb"


def connect(path: Path) -> duckdb.DuckDBPyConnection:
    """Open (creating parent directories if needed) and migrate the store at `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path))
    # Fixes the session TimeZone so every `CAST(TIMESTAMPTZ AS VARCHAR)` read is UTC (see
    # `_time.py` for why repositories cast rather than fetch TIMESTAMPTZ natively).
    con.execute("SET TimeZone='UTC'")
    migrate(con)
    return con


def _applied_versions(con: duckdb.DuckDBPyConnection) -> set[int]:
    tables = {row[0] for row in con.execute("SHOW TABLES").fetchall()}
    if "schema_version" not in tables:
        return set()
    return {row[0] for row in con.execute("SELECT version FROM schema_version").fetchall()}


def migrate(con: duckdb.DuckDBPyConnection) -> None:
    """Apply every migration in `migrations/` not yet recorded in `schema_version`."""
    applied = _applied_versions(con)
    for script in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = int(script.name.split("_", 1)[0])
        if version in applied:
            continue
        con.execute(script.read_text())
