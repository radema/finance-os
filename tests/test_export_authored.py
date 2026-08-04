"""CLI integration tests for `financeos export --authored` (RFC-0009 §7.1)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import yaml  # type: ignore[import-untyped]
from click.testing import CliRunner

from financeos.adapters.duckdb.connection import connect
from financeos.adapters.duckdb.repositories.apportionment import DuckDBApportionmentRepository
from financeos.cli import REPO_ROOT, app
from financeos.core.shared import AssetId, BucketId, Quantity

BUCKET_ID = UUID("44940ba1-0bfd-5d7c-ba07-4d80aefdd508")
EQUITY_ID = UUID("45369af8-b13e-5748-ad1d-bc4d703aceb7")
DEMO_STRATEGY_YAML = REPO_ROOT / "demo" / "strategy.yaml"


def _seed(runner: CliRunner, db_path: Path) -> None:
    result = runner.invoke(app, ["--db-path", str(db_path), "seed", "demo"])
    assert result.exit_code == 0, result.output


def _export(runner: CliRunner, db_path: Path, out_dir: Path) -> None:
    result = runner.invoke(
        app, ["--db-path", str(db_path), "export", "--authored", "--out-dir", str(out_dir)]
    )
    assert result.exit_code == 0, result.output


def test_authored_flag_is_required() -> None:
    result = CliRunner().invoke(app, ["export"])
    assert result.exit_code != 0
    assert "--authored" in result.output


def test_apportionment_export_includes_a_superseded_row(tmp_path: Path) -> None:
    runner = CliRunner()
    db_path = tmp_path / "financeos.duckdb"
    _seed(runner, db_path)

    con = connect(db_path)
    row = con.execute(
        "SELECT id FROM bucket_apportionment WHERE bucket_id = ? AND asset_id = ?",
        [str(BUCKET_ID), str(EQUITY_ID)],
    ).fetchone()
    assert row is not None
    original_id = UUID(row[0])
    DuckDBApportionmentRepository(con).apportion(
        uuid4(),
        BucketId(BUCKET_ID),
        AssetId(EQUITY_ID),
        Quantity(amount=Decimal("200")),
        effective_from=date(2026, 2, 1),
        recorded_at=datetime(2026, 2, 1, 9, 0, tzinfo=UTC),
        supersedes_id=original_id,
    )
    con.close()

    out_dir = tmp_path / "export"
    _export(runner, db_path, out_dir)

    records = yaml.safe_load((out_dir / "apportionment" / f"{BUCKET_ID}.yaml").read_text())
    # UX-0001 §8.2: Pensione apportions 6 distinct Assets + the supersession just written.
    assert len(records) == 7
    assert str(original_id) in {r["id"] for r in records}  # superseded row is not dropped
    superseding = next(r for r in records if r.get("supersedes_id") == str(original_id))
    assert superseding["quantity"]["amount"] == "200.0000000000"


def test_asset_export_covers_every_current_row(tmp_path: Path) -> None:
    runner = CliRunner()
    db_path = tmp_path / "financeos.duckdb"
    _seed(runner, db_path)

    out_dir = tmp_path / "export"
    _export(runner, db_path, out_dir)

    assets = yaml.safe_load((out_dir / "assets.yaml").read_text())
    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")
    expected_ids = {row[0] for row in con.execute("SELECT id FROM asset").fetchall()}
    con.close()
    assert {a["id"] for a in assets} == expected_ids


def test_strategy_export_covers_every_version_and_round_trips(tmp_path: Path) -> None:
    runner = CliRunner()
    db_path = tmp_path / "financeos.duckdb"
    _seed(runner, db_path)

    # Freeze a second version of the same Strategy before exporting.
    result = runner.invoke(
        app, ["--db-path", str(db_path), "import-strategy", str(DEMO_STRATEGY_YAML)]
    )
    assert result.exit_code == 0, result.output

    out_dir = tmp_path / "export"
    _export(runner, db_path, out_dir)

    strategy_dir = out_dir / "strategies" / "crescita-di-lungo-periodo"
    version_files = sorted(strategy_dir.glob("*.yaml"))
    assert [p.name[:3] for p in version_files] == ["001", "002"]

    replay_db = tmp_path / "replay.duckdb"
    for version_file in version_files:
        result = runner.invoke(
            app, ["--db-path", str(replay_db), "import-strategy", str(version_file)]
        )
        assert result.exit_code == 0, result.output

    con = duckdb.connect(str(replay_db))
    con.execute("SET TimeZone='UTC'")
    row = con.execute("SELECT count(*) FROM strategy_version").fetchone()
    con.close()
    assert row == (2,)
