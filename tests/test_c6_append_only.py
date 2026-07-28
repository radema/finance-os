"""CI contract C6 — append-only (RFC-0005 §7, HANDOFF §3.8): no `UPDATE`/`DELETE` statement
may target an append-only fact table anywhere in `src/`.

DuckDB has no per-table grants (RFC-0005 §5.2), so this grep is the only thing enforcing I-10
and ADR-L01's W10. The table list is derived from `001_init.sql`'s own table-class comments
(`fact` / append-only / immutable), not guessed:

    operation, bucket_apportionment, price, evaluation_run, alert, recommendation,
    strategy_version, asset_classification_audit, snapshot

`definition` tables (`asset`, `account`, `portfolio`, `bucket`, `strategy`, ...) are ordinary
CRUD and are *not* in this list — `strategy.current_version_id` is legitimately `UPDATE`d by
`DuckDBStrategyRepository.freeze_version`.
"""

from __future__ import annotations

import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "financeos"

APPEND_ONLY_TABLES = (
    "operation",
    "bucket_apportionment",
    "price",
    "evaluation_run",
    "alert",
    "recommendation",
    "strategy_version",
    "asset_classification_audit",
    "snapshot",
)

_FORBIDDEN = re.compile(
    r"\b(UPDATE|DELETE)\b.*\b(" + "|".join(APPEND_ONLY_TABLES) + r")\b", re.IGNORECASE
)


def _source_files() -> list[Path]:
    return [
        path
        for path in SRC.rglob("*")
        if path.suffix in (".py", ".sql") and "__pycache__" not in path.parts
    ]


def test_no_update_or_delete_against_append_only_tables() -> None:
    violations = []
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if _FORBIDDEN.search(line):
                violations.append(f"{path.relative_to(SRC)}:{lineno}: {line.strip()}")
    assert not violations, "C6 violated (UPDATE/DELETE against a fact table):\n" + "\n".join(
        violations
    )


def test_append_only_table_list_matches_migration_001() -> None:
    migration = (SRC / "adapters" / "duckdb" / "migrations" / "001_init.sql").read_text()
    for table in APPEND_ONLY_TABLES:
        assert re.search(rf"CREATE TABLE {table}\b", migration), (
            f"{table} is not a table in 001_init.sql — update APPEND_ONLY_TABLES"
        )
