"""YAML -> `StrategyDefinition` (RFC-0005 §5.6, ADR-0009).

Strategies are authored as a canonical YAML file for the skeleton (the editing UI is V1.0
scope, RFC-0005 §8.2). Keys are English (ADR-L03 §5); `name`/`change_note`/`principles`/
`objective` are the user's own Italian prose, imported verbatim and never validated for
language or content.

`yaml.safe_load` returns loosely-typed data (no PyYAML stubs are installed, and the shape is
whatever the file says); every helper here takes `Any` deliberately, as the boundary where that
untyped data becomes the strictly-typed `StrategyDefinition`.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

import yaml  # type: ignore[import-untyped]

from financeos.core.shared import Priority, RuleId, StrategyId, SuggestionClass, Weight
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskLevel,
    RiskProfile,
    Rule,
    StrategyDefinition,
    TargetAllocation,
    TargetNode,
    Tolerance,
    ToleranceKind,
)


@dataclass(frozen=True)
class StrategyImport:
    """A parsed strategy file, ready to be frozen as a new `StrategyVersion`."""

    strategy_id: StrategyId
    definition: StrategyDefinition
    change_note: str


def _parse_tolerance(data: Any) -> Tolerance:
    return Tolerance(kind=ToleranceKind(data["kind"]), band=Decimal(str(data["band"])))


def _parse_node(data: Any) -> TargetNode:
    tolerance = data.get("tolerance")
    children = data.get("children") or []
    return TargetNode(
        key=str(data["key"]),
        weight=Weight(value=Decimal(str(data["weight"]))),
        tolerance=_parse_tolerance(tolerance) if tolerance else None,
        children=tuple(_parse_node(child) for child in children),
    )


def _parse_targets(data: Sequence[Any]) -> TargetAllocation:
    return TargetAllocation(children=tuple(_parse_node(node) for node in data))


def _parse_horizon(data: Any) -> Horizon:
    target_date = data.get("target_date")
    return Horizon(
        years=data.get("years"),
        target_date=date.fromisoformat(str(target_date)) if target_date else None,
    )


def _parse_risk(data: Any) -> RiskProfile:
    return RiskProfile(
        level=RiskLevel(data["level"]),
        principles=tuple(data.get("principles") or ()),
    )


def _parse_rule(data: Any) -> Rule:
    condition = data["condition"]
    max_staleness_seconds = condition.get("max_staleness_seconds")
    return Rule(
        id=RuleId(UUID(str(data["id"]))),
        name=str(data["name"]),
        enabled=bool(data.get("enabled", True)),
        priority=Priority(data["priority"]),
        suggestion_class=SuggestionClass(data["suggestion_class"]),
        message=str(data["message"]),
        condition=LeafCondition(
            kind=str(condition["kind"]),
            kind_version=int(condition["kind_version"]),
            params={str(k): str(v) for k, v in (condition.get("params") or {}).items()},
            max_staleness=(
                timedelta(seconds=float(max_staleness_seconds)) if max_staleness_seconds else None
            ),
        ),
    )


def read_yaml(path: Path) -> StrategyImport:
    """Parse a strategy YAML file into a `StrategyImport`."""
    data: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    definition = StrategyDefinition(
        name=str(data["name"]),
        description=data.get("description"),
        objective=data.get("objective"),
        horizon=_parse_horizon(data["horizon"]),
        risk=_parse_risk(data["risk"]),
        targets=_parse_targets(data["targets"]),
        rules=tuple(_parse_rule(rule) for rule in data["rules"]),
    )
    return StrategyImport(
        strategy_id=StrategyId(UUID(str(data["strategy_id"]))),
        definition=definition,
        change_note=str(data["change_note"]),
    )
