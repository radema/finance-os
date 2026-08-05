"""`export_backup` round-trip (product-owner decision, 2026-08-05): the full-backup zip at
`/data-io/backup` must reload through `financeos seed` and reproduce the golden-file
Recommendation count — not just "shape looks right" (`test_export_authored.py`'s bar), because
this bundle's whole reason to exist is re-seedability.

`financeos seed FIXTURE` resolves `REPO_ROOT / FIXTURE`; passing an absolute path as `FIXTURE`
makes `Path.__truediv__` discard `REPO_ROOT` entirely (a documented pathlib behaviour, not a
CLI flag) — the mechanism this test uses to point `seed` at the unzipped backup directory
without adding a new CLI option.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from pathlib import Path

import duckdb
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.cli import app as cli
from financeos.web.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = REPO_ROOT / "demo"
EXPECTED = json.loads((DEMO_DIR / "expected" / "findings.json").read_text())

# demo/<name>.csv -> its header row, verbatim (the contract `financeos seed` parses).
_DEMO_CSV_HEADERS = {
    csv_path.name: csv_path.read_text(encoding="utf-8").splitlines()[0]
    for csv_path in DEMO_DIR.glob("*.csv")
}


def _seed_and_evaluate(db_path: Path, fixture: str | Path = "demo") -> None:
    runner = CliRunner()
    seeded = runner.invoke(cli, ["--db-path", str(db_path), "seed", str(fixture)])
    assert seeded.exit_code == 0, seeded.output
    evaluated = runner.invoke(
        cli, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
    )
    assert evaluated.exit_code == 0, evaluated.output


def _recommendation_count(db_path: Path) -> int:
    con = duckdb.connect(str(db_path))
    try:
        row = con.execute("SELECT count(*) FROM recommendation").fetchone()
        assert row is not None
        return int(row[0])
    finally:
        con.close()


def test_backup_round_trips_through_seed_to_the_golden_recommendation_count(
    tmp_path: Path,
) -> None:
    # 1. Seed + evaluate the original demo DB, sanity-check the golden count holds here too.
    original_db = tmp_path / "original.duckdb"
    _seed_and_evaluate(original_db)
    assert _recommendation_count(original_db) == EXPECTED["recommendation_count"]

    # 2. Hit the real `/data-io/backup` route against that DB — the exact code path a user
    #    downloading a backup exercises, not a bare call into `app.export_backup`.
    client = TestClient(create_app(original_db))
    response = client.get("/data-io/backup")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "financeos-backup.zip" in response.headers["content-disposition"]

    # 3. Unzip into a fresh fixture directory.
    extracted_dir = tmp_path / "extracted-backup"
    extracted_dir.mkdir()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        archive.extractall(extracted_dir)

    # 4. Every emitted CSV has demo/'s exact column headers (the shape `financeos seed` reads).
    for name, expected_header in _DEMO_CSV_HEADERS.items():
        emitted = (extracted_dir / name).read_text(encoding="utf-8").splitlines()[0]
        assert emitted == expected_header, f"{name}: header drifted from demo/'s"

    # 5. Exactly one Strategy YAML per distinct Strategy in the DB (two, in the demo fixture),
    #    matching `strategy*.yaml` — the glob `financeos seed` itself walks.
    strategy_files = sorted(extracted_dir.glob("strategy*.yaml"))
    assert len(strategy_files) == 2

    # 6. Feed the unzipped bundle back through the *actual* `financeos seed` code path (an
    #    absolute FIXTURE argument, per this module's docstring) into a brand-new store, then
    #    evaluate it exactly as the original was evaluated.
    replay_db = tmp_path / "replay.duckdb"
    _seed_and_evaluate(replay_db, fixture=extracted_dir)

    # 7. The reconstructed store must evaluate to the same 10 Recommendations as the original.
    assert _recommendation_count(replay_db) == EXPECTED["recommendation_count"]


def test_backup_operations_csv_excludes_auto_emitted_cash_legs(tmp_path: Path) -> None:
    """`operations.csv` carries only primary rows — `cash_leg_of IS NULL` — the same 12 rows
    `demo/operations.csv` itself authors; the 6 auto-emitted BUY cash legs are not among them
    (`import_operations` re-derives them on reseed)."""
    db_path = tmp_path / "financeos.duckdb"
    _seed_and_evaluate(db_path)

    client = TestClient(create_app(db_path))
    response = client.get("/data-io/backup")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        operations_csv = archive.read("operations.csv").decode("utf-8")

    demo_rows = list(csv.DictReader((DEMO_DIR / "operations.csv").read_text().splitlines()))
    backup_rows = list(csv.DictReader(operations_csv.splitlines()))
    assert len(backup_rows) == len(demo_rows)
    assert {row["type"] for row in backup_rows} == {"BUY", "TRANSFER_IN", "TRANSFER_OUT"}
