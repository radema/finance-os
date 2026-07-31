"""`DuckDBStrategyRepository` — `strategy` (definition, mutable) + `strategy_version` (E2,
immutable; ADR-0027: there is no `rule` table, rules live in `definition` JSON).

`strategy.current_version_id` carries no `REFERENCES` (E-1: DuckDB cannot `ALTER TABLE ...
ADD CONSTRAINT` after the fact) so this repository is the integrity guarantee: `freeze_version`
writes the new `strategy_version` row and repoints `current_version_id` in the same call.
Updating `strategy.current_version_id` is a plain CRUD write on a *definition* table, not a
fact table — it is not covered by the C6 append-only contract.
"""

from __future__ import annotations

from uuid import UUID

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.core.shared import StrategyId, StrategyVersionId
from financeos.core.strategy import StrategyDefinition, StrategyVersion


class DuckDBStrategyRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def ensure_strategy(
        self, strategy_id: StrategyId, *, name: str, description: str | None = None
    ) -> None:
        exists = self._con.execute(
            "SELECT 1 FROM strategy WHERE id = ?", [str(strategy_id)]
        ).fetchone()
        if exists is not None:
            return
        self._con.execute(
            "INSERT INTO strategy (id, name, current_version_id, description) "
            "VALUES (?, ?, NULL, ?)",
            [str(strategy_id), name, description],
        )

    def freeze_version(self, version: StrategyVersion) -> None:
        self._con.execute(
            "INSERT INTO strategy_version "
            "(id, strategy_id, parent_version_id, definition, change_note, frozen_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                str(version.id),
                str(version.strategy_id),
                str(version.parent_version_id) if version.parent_version_id else None,
                version.definition.model_dump_json(),
                version.change_note,
                version.frozen_at,
            ],
        )
        self._con.execute(
            "UPDATE strategy SET current_version_id = ? WHERE id = ?",
            [str(version.id), str(version.strategy_id)],
        )

    def current_version(self, strategy_id: StrategyId) -> StrategyVersion:
        row = self._con.execute(
            "SELECT current_version_id FROM strategy WHERE id = ?", [str(strategy_id)]
        ).fetchone()
        if row is None or row[0] is None:
            raise KeyError(f"strategy {strategy_id} has no current version")
        return self.get_version(StrategyVersionId(UUID(row[0])))

    def get_version(self, version_id: StrategyVersionId) -> StrategyVersion:
        row = self._con.execute(
            "SELECT id, strategy_id, parent_version_id, definition, change_note, "
            "CAST(frozen_at AS VARCHAR) FROM strategy_version WHERE id = ?",
            [str(version_id)],
        ).fetchone()
        if row is None:
            raise KeyError(f"no strategy_version {version_id}")
        return self._version_from_row(row)

    def all_ids(self) -> tuple[StrategyId, ...]:
        rows = self._con.execute("SELECT id FROM strategy ORDER BY id").fetchall()
        return tuple(StrategyId(UUID(row[0])) for row in rows)

    def all_versions(self, strategy_id: StrategyId) -> tuple[StrategyVersion, ...]:
        rows = self._con.execute(
            "SELECT id, strategy_id, parent_version_id, definition, change_note, "
            "CAST(frozen_at AS VARCHAR) FROM strategy_version WHERE strategy_id = ? "
            "ORDER BY frozen_at, id",
            [str(strategy_id)],
        ).fetchall()
        return tuple(self._version_from_row(row) for row in rows)

    def _version_from_row(
        self, row: tuple[str, str, str | None, str, str, str]
    ) -> StrategyVersion:
        row_id, strategy_id, parent_id, definition, change_note, frozen_at = row
        return StrategyVersion(
            id=StrategyVersionId(UUID(row_id)),
            strategy_id=StrategyId(UUID(strategy_id)),
            parent_version_id=StrategyVersionId(UUID(parent_id)) if parent_id else None,
            definition=StrategyDefinition.model_validate_json(definition),
            change_note=change_note,
            frozen_at=parse_instant(frozen_at),
        )
