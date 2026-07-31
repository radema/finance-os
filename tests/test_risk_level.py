"""`RiskLevel`'s 7-member ordinal scale (P31/P32) — the ratified migration off the rejected
5-member enum.

`risk_level_rank` is the sole source of the 1-7 ordinal; nothing here computes it.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from financeos.adapters.exporters.yaml_authored import write_strategy_lineage
from financeos.adapters.importers.yaml_strategy import read_yaml
from financeos.core.shared import StrategyVersionId
from financeos.core.strategy import RiskLevel, risk_level_rank
from tests import factories as f

REPO_ROOT = Path(__file__).resolve().parents[1]

#: P32's ratified order, 1-7.
_ORDERED_MEMBERS = (
    RiskLevel.VERY_CONSERVATIVE,
    RiskLevel.CONSERVATIVE,
    RiskLevel.MODERATE,
    RiskLevel.BALANCED,
    RiskLevel.GROWTH,
    RiskLevel.HIGH_GROWTH,
    RiskLevel.AGGRESSIVE,
)


def test_risk_level_rank_matches_p32_ordinal_for_every_member() -> None:
    assert [risk_level_rank(level) for level in _ORDERED_MEMBERS] == [1, 2, 3, 4, 5, 6, 7]


def test_risk_level_has_exactly_seven_members() -> None:
    assert set(RiskLevel) == set(_ORDERED_MEMBERS)


def test_demo_strategy_yaml_balanced_maps_to_the_midpoint_four() -> None:
    imported = read_yaml(REPO_ROOT / "demo" / "strategy.yaml")

    assert imported.definition.risk.level == RiskLevel.BALANCED
    assert risk_level_rank(imported.definition.risk.level) == 4


def test_a_new_member_round_trips_through_yaml_export_and_import(tmp_path: Path) -> None:
    version = f.strategy_version(
        version_id=StrategyVersionId(UUID(int=42)), risk_level=RiskLevel.HIGH_GROWTH
    )

    (path,) = write_strategy_lineage((version,), tmp_path)
    imported = read_yaml(path)

    assert imported.definition.risk.level == RiskLevel.HIGH_GROWTH
    assert risk_level_rank(imported.definition.risk.level) == 6
    assert imported.definition == version.definition
