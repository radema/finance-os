"""Read-side query: `/strategies/{id}` — the frozen `StrategyVersion` document (screen 6).

Only `financeos.web` may import this module (contract C4).

Reads `strategy_version.definition` as flat JSON, the same discipline `queries/allocation.py`'s
`_targets_for` already established: the read side parses the frozen document's own shape rather
than reconstructing the strictly-typed `StrategyDefinition` Pydantic aggregate (RFC-0005 §5.3 — no
domain object reaches a template). The write path is a different module (`app/freeze_strategy.py`)
and *does* go through the real aggregate, because a freeze must be validated against every
domain invariant (I-13, ADR-0018) before it is ever persisted.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.core.engines.rule_engine import REGISTRY
from financeos.core.shared import UnknownConditionKindError


@dataclass(frozen=True)
class TargetNodeView:
    """One node of the frozen target tree, flattened for display (depth 1-2, ADR-0017)."""

    key: str
    weight: Decimal
    tolerance_kind: str | None
    tolerance_band: Decimal | None
    children: tuple[TargetNodeView, ...]

    @property
    def is_leaf(self) -> bool:
        return not self.children


@dataclass(frozen=True)
class RuleParamFieldView:
    """One param field the catalog declares for a Rule's `(kind, kind_version)`, with its
    frozen value — the edit form's source of truth for which fields exist (ADR-0014)."""

    name: str
    value: str


@dataclass(frozen=True)
class RuleView:
    """One frozen `Rule`, with its condition's params as an ordered list of (key, value)."""

    id: str
    name: str
    enabled: bool
    priority: str
    suggestion_class: str | None
    message: str
    kind: str
    kind_version: int
    params: tuple[tuple[str, str], ...]
    param_fields: tuple[RuleParamFieldView, ...]
    max_staleness_seconds: float | None


@dataclass(frozen=True)
class StrategyListRow:
    """One row of `/strategies`: identity, name, and the version currently governing it."""

    id: str
    name: str
    current_version_id: str | None
    change_note: str | None
    frozen_at: datetime | None


@dataclass(frozen=True)
class StrategyDetail:
    """Everything `/strategies/{id}` renders: the current frozen version, flattened."""

    strategy_id: str
    strategy_name: str
    version_id: str
    change_note: str
    frozen_at: datetime
    name: str
    description: str | None
    objective: str | None
    horizon_years: int | None
    horizon_target_date: str | None
    risk_level: str
    principles: tuple[str, ...]
    targets: tuple[TargetNodeView, ...]
    rules: tuple[RuleView, ...]


def list_strategies(con: duckdb.DuckDBPyConnection) -> tuple[StrategyListRow, ...]:
    """Every Strategy, with its current version's `change_note` where one is frozen."""
    rows = con.execute(
        """
        SELECT s.id, s.name, s.current_version_id, sv.change_note, CAST(sv.frozen_at AS VARCHAR)
        FROM strategy s
        LEFT JOIN strategy_version sv ON sv.id = s.current_version_id
        ORDER BY s.name
        """
    ).fetchall()
    return tuple(
        StrategyListRow(
            id=str(row[0]),
            name=str(row[1]),
            current_version_id=str(row[2]) if row[2] is not None else None,
            change_note=str(row[3]) if row[3] is not None else None,
            frozen_at=parse_instant(str(row[4])) if row[4] is not None else None,
        )
        for row in rows
    )


def get_strategy_detail(con: duckdb.DuckDBPyConnection, strategy_id: str) -> StrategyDetail | None:
    """The Strategy's currently-frozen version, flattened for display and for the edit form.

    Returns `None` when `strategy_id` does not resolve, or has no frozen version yet — a
    `Strategy` row can exist with `current_version_id IS NULL` only transiently (every write path
    freezes a version in the same transaction it creates the row), so this is reported the same
    way as "not found" rather than as a distinct state.
    """
    row = con.execute(
        """
        SELECT s.id, s.name, sv.id, sv.change_note, CAST(sv.frozen_at AS VARCHAR), sv.definition
        FROM strategy s
        JOIN strategy_version sv ON sv.id = s.current_version_id
        WHERE s.id = ?
        """,
        [strategy_id],
    ).fetchone()
    if row is None:
        return None

    definition: dict[str, Any] = json.loads(str(row[5]))
    horizon = definition.get("horizon") or {}
    risk = definition.get("risk") or {}
    targets_root: dict[str, Any] = definition.get("targets") or {}
    rules_raw = definition.get("rules") or ()

    return StrategyDetail(
        strategy_id=str(row[0]),
        strategy_name=str(row[1]),
        version_id=str(row[2]),
        change_note=str(row[3]),
        frozen_at=parse_instant(str(row[4])),
        name=str(definition.get("name", "")),
        description=definition.get("description"),
        objective=definition.get("objective"),
        horizon_years=horizon.get("years"),
        horizon_target_date=horizon.get("target_date"),
        risk_level=str(risk.get("level", "")),
        principles=tuple(risk.get("principles") or ()),
        targets=tuple(_node(child) for child in (targets_root.get("children") or ())),
        rules=tuple(_rule(rule) for rule in rules_raw),
    )


def _node(data: dict[str, Any]) -> TargetNodeView:
    tolerance = data.get("tolerance")
    return TargetNodeView(
        key=str(data["key"]),
        weight=Decimal(str(data["weight"]["value"])),
        tolerance_kind=str(tolerance["kind"]) if tolerance else None,
        tolerance_band=Decimal(str(tolerance["band"])) if tolerance else None,
        children=tuple(_node(child) for child in (data.get("children") or ())),
    )


def _rule(data: dict[str, Any]) -> RuleView:
    condition = data.get("condition") or {}
    params = condition.get("params") or {}
    kind = str(condition.get("kind", ""))
    kind_version = int(condition.get("kind_version", 1))
    return RuleView(
        id=str(data["id"]),
        name=str(data.get("name", "")),
        enabled=bool(data.get("enabled", True)),
        priority=str(data.get("priority", "")),
        suggestion_class=data.get("suggestion_class"),
        message=str(data.get("message", "")),
        kind=kind,
        kind_version=kind_version,
        params=tuple((str(k), str(v)) for k, v in params.items()),
        param_fields=_param_fields(kind, kind_version, params),
        max_staleness_seconds=(
            float(max_staleness_seconds)
            if (max_staleness_seconds := condition.get("max_staleness_seconds")) is not None
            else None
        ),
    )


def _param_fields(
    kind: str, kind_version: int, params: dict[str, Any]
) -> tuple[RuleParamFieldView, ...]:
    """The edit form's field list for one Rule: the catalog's own declaration (ADR-0014), not
    a hand-copied one, so it can never list a field the Rule Engine would then reject."""
    try:
        spec = REGISTRY.get(kind, kind_version)
        field_names: tuple[str, ...] = tuple(spec.params_model.model_fields)
    except UnknownConditionKindError:
        field_names = tuple(params.keys())
    return tuple(
        RuleParamFieldView(name=name, value=str(params.get(name, ""))) for name in field_names
    )


def rule_catalog_kinds() -> tuple[tuple[str, int, tuple[str, ...]], ...]:
    """Every registered `(kind, kind_version, param field names)` — the rule editor's picklist.

    ADR-0014: the condition catalog is closed and typed. Reading `params_model.model_fields`
    off each registered spec means the editor's field list can never drift from what the Rule
    Engine will actually accept — there is no second, hand-maintained schema to fall out of sync.
    """
    return tuple(
        (spec.kind, spec.kind_version, tuple(spec.params_model.model_fields.keys()))
        for spec in REGISTRY.all_kinds()
    )
