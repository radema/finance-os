"""YAML serializers for `financeos export --authored` (RFC-0009 §7.1).

RFC-0009 §7.1 closes the one recovery gap forward-only migrations (§7) leave open: derivable
data (Operations, Transactions, prices) can be rebuilt from retained raw imports, but
**authored** data — apportionment, Strategies+Rules, Decisions, Categories, asset
classifications — has no other recovery path. This module writes the three of those five
classes that actually exist in this codebase today.

**Decisions and Categories are absent from this module on purpose, not by oversight:**

- Decisions have zero implementation — RFC-0004 only sketches the design; there is no model,
  no table, nothing to export.
- Categories have zero implementation, explicitly deferred to V1.1 by ADR-0024.

A future reader should not mistake the missing `decisions.yaml`/`categories.yaml` for a bug:
there is no authored data behind either name yet.

**Asset classification history is not exported either, for a related but distinct reason:**
`asset_classification_audit` (RFC-0009 §3.3, E6) exists as a table, but nothing in this
codebase ever writes to it — there is no `reclassify()` method anywhere, so in practice
`asset.asset_class` never changes after creation. `write_asset_classifications` below exports
the current `asset` rows only; there is no change history to lose, because none was ever
recorded.

**Round-trip symmetry differs by class:**

- **Strategies** are fully symmetric. Every frozen `StrategyVersion` in a Strategy's lineage
  is written as its own file, in the exact shape `adapters.importers.yaml_strategy.read_yaml`
  parses. Replaying a Strategy's version files through the existing `financeos import-strategy`
  command, oldest first, reconstructs the whole lineage (new ids are minted on each freeze, as
  always, but the chain of definitions and change notes is identical). This generalizes the
  auto-write-on-freeze mechanism RFC-0005 §5.6 (ADR-0009) describes for strategies specifically
  — that automatic write does not exist in code; this module is the explicit, on-demand export.
- **Apportionment and asset classifications are export-only for now.** No importer reads this
  module's output back in — `financeos seed` imports both from CSV fixtures, a different path
  built for a different purpose. The counterpart importers are follow-on work, not part of
  closing this recovery-path gap.

Every function here is a pure serializer over already-fetched domain objects, with no
`UnitOfWork` — fetching via the repository ports is `financeos.app.export_authored`'s job,
mirroring the read/parse split `adapters.importers` already holds (`read_yaml` never touches a
`UnitOfWork` either).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

from financeos.core.portfolio import ApportionmentRecord, Asset
from financeos.core.shared import BucketId, canonical_decimal, canonical_value
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskProfile,
    Rule,
    StrategyVersion,
    TargetNode,
    Tolerance,
)


def _write_yaml(path: Path, data: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return path


def write_apportionment_history(
    bucket_id: BucketId, records: Sequence[ApportionmentRecord], out_dir: Path
) -> Path:
    """One file per `Bucket`: every `bucket_apportionment` row, superseded rows included.

    Canonicalized via `core.shared.canonical_value` (Decimal-as-string, UTC timestamps, `None`
    omitted) so the output is byte-stable across runs.
    """
    path = out_dir / "apportionment" / f"{bucket_id}.yaml"
    return _write_yaml(path, [canonical_value(record) for record in records])


def write_asset_classifications(assets: Sequence[Asset], out_dir: Path) -> Path:
    """One file for the whole class: current `asset` rows (no history — see module docstring)."""
    path = out_dir / "assets.yaml"
    return _write_yaml(path, [canonical_value(asset) for asset in assets])


def _slugify(name: str) -> str:
    """A filesystem-safe directory name: lowercase, non-alphanumeric runs collapsed to `-`."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "strategy"


def _horizon_yaml(horizon: Horizon) -> dict[str, Any]:
    if horizon.years is not None:
        return {"years": horizon.years}
    assert horizon.target_date is not None  # Horizon._exactly_one_form guarantees this
    return {"target_date": horizon.target_date.isoformat()}


def _risk_yaml(risk: RiskProfile) -> dict[str, Any]:
    return {"level": risk.level.value, "principles": list(risk.principles)}


def _tolerance_yaml(tolerance: Tolerance) -> dict[str, str]:
    return {"kind": tolerance.kind.value, "band": canonical_decimal(tolerance.band)}


def _target_node_yaml(node: TargetNode) -> dict[str, Any]:
    doc: dict[str, Any] = {"key": node.key, "weight": canonical_decimal(node.weight.value)}
    if node.tolerance is not None:
        doc["tolerance"] = _tolerance_yaml(node.tolerance)
    if node.children:
        doc["children"] = [_target_node_yaml(child) for child in node.children]
    return doc


def _condition_yaml(condition: LeafCondition) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "kind": condition.kind,
        "kind_version": condition.kind_version,
        "params": dict(condition.params),
    }
    if condition.max_staleness is not None:
        doc["max_staleness_seconds"] = condition.max_staleness.total_seconds()
    return doc


def _rule_yaml(rule: Rule) -> dict[str, Any]:
    return {
        "id": str(rule.id),
        "name": rule.name,
        "enabled": rule.enabled,
        "priority": rule.priority.value,
        "suggestion_class": rule.suggestion_class.value,
        "message": rule.message,
        "condition": _condition_yaml(rule.condition),
    }


def strategy_version_to_yaml(version: StrategyVersion) -> dict[str, Any]:
    """The exact shape `yaml_strategy.read_yaml` parses — export and import share one shape."""
    definition = version.definition
    doc: dict[str, Any] = {
        "strategy_id": str(version.strategy_id),
        "name": definition.name,
        "objective": definition.objective,
        "horizon": _horizon_yaml(definition.horizon),
        "risk": _risk_yaml(definition.risk),
        "targets": [_target_node_yaml(node) for node in definition.targets.children],
        "rules": [_rule_yaml(rule) for rule in definition.rules],
        "change_note": version.change_note,
    }
    if definition.description is not None:
        doc["description"] = definition.description
    return doc


def write_strategy_lineage(
    versions: Sequence[StrategyVersion], out_dir: Path
) -> tuple[Path, ...]:
    """Every frozen version of one Strategy, oldest first, one file each.

    Directory is `<out_dir>/strategies/<slug>/`, slugified from the *latest* version's name
    (RFC-0005 §5.6 describes one `strategies/<slug>.yaml` per Strategy for the current version
    only; this generalizes it to the full lineage `versions` already carries). Filenames are
    zero-padded by lineage order so re-importing them in filename order through
    `financeos import-strategy` replays the lineage exactly.
    """
    if not versions:
        return ()
    slug = _slugify(versions[-1].definition.name)
    strategy_dir = out_dir / "strategies" / slug
    return tuple(
        _write_yaml(
            strategy_dir / f"{index:03d}_{version.id}.yaml", strategy_version_to_yaml(version)
        )
        for index, version in enumerate(versions, start=1)
    )
