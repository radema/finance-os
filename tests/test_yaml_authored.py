"""`adapters.exporters.yaml_authored` — pure serializers (RFC-0009 §7.1).

Strategy serialization is checked against `yaml_strategy.read_yaml` directly: the module's own
claim is that the two share one shape, so the test that matters is the round trip, not a
snapshot of the dict.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import yaml  # type: ignore[import-untyped]

from financeos.adapters.exporters.yaml_authored import (
    write_apportionment_history,
    write_asset_classifications,
    write_strategy_lineage,
)
from financeos.adapters.importers.yaml_strategy import read_yaml
from financeos.core.portfolio import ApportionmentRecord
from financeos.core.shared import Quantity, StrategyVersionId
from tests import factories as f


def test_write_apportionment_history_keeps_superseded_rows(tmp_path: Path) -> None:
    first_id = UUID(int=1)
    second_id = UUID(int=2)
    records = (
        ApportionmentRecord(
            id=first_id,
            bucket_id=f.BUCKET,
            asset_id=f.EQUITY,
            quantity=Quantity(amount=Decimal("100")),
            effective_from=date(2026, 1, 1),
            recorded_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        ),
        ApportionmentRecord(
            id=second_id,
            bucket_id=f.BUCKET,
            asset_id=f.EQUITY,
            quantity=Quantity(amount=Decimal("150")),
            effective_from=date(2026, 1, 2),
            supersedes_id=first_id,
            recorded_at=datetime(2026, 1, 2, 9, 0, tzinfo=UTC),
        ),
    )

    path = write_apportionment_history(f.BUCKET, records, tmp_path)

    assert path == tmp_path / "apportionment" / f"{f.BUCKET}.yaml"
    loaded = yaml.safe_load(path.read_text())
    assert [row["id"] for row in loaded] == [str(first_id), str(second_id)]
    assert "supersedes_id" not in loaded[0]  # rule 4: None is omitted, never null
    assert loaded[1]["supersedes_id"] == str(first_id)


def test_write_asset_classifications_covers_every_asset(tmp_path: Path) -> None:
    assets = (f.asset(f.EQUITY, "EQUITY_DEVELOPED"), f.asset(f.BOND, "BOND_GOV_EUR"))

    path = write_asset_classifications(assets, tmp_path)

    loaded = yaml.safe_load(path.read_text())
    assert {row["id"] for row in loaded} == {str(f.EQUITY), str(f.BOND)}
    assert {row["asset_class"] for row in loaded} == {"EQUITY_DEVELOPED", "BOND_GOV_EUR"}


def test_write_strategy_lineage_covers_every_version_and_round_trips(tmp_path: Path) -> None:
    v1 = f.strategy_version(change_note="Prima versione.")
    v2 = f.strategy_version(
        version_id=StrategyVersionId(UUID(int=99)), change_note="Seconda versione."
    )

    paths = write_strategy_lineage((v1, v2), tmp_path)

    assert len(paths) == 2
    assert paths[0].name.startswith("001_")
    assert paths[1].name.startswith("002_")
    strategy_dir = tmp_path / "strategies" / "crescita-di-lungo-periodo"
    assert paths[0].parent == paths[1].parent == strategy_dir

    for original, path in ((v1, paths[0]), (v2, paths[1])):
        imported = read_yaml(path)
        assert imported.strategy_id == original.strategy_id
        assert imported.change_note == original.change_note
        assert imported.definition == original.definition


def test_write_strategy_lineage_of_no_versions_writes_nothing(tmp_path: Path) -> None:
    assert write_strategy_lineage((), tmp_path) == ()
