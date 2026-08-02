"""Screen 4 — Buckets & apportionment at `/buckets` (ADR-0025, ADR-0001, ADR-0029)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.cli import app as cli
from financeos.web.main import create_app


def _seed(tmp_path: Path) -> Path:
    db_path = tmp_path / "financeos.duckdb"
    runner = CliRunner()
    seeded = runner.invoke(cli, ["--db-path", str(db_path), "seed", "demo"])
    assert seeded.exit_code == 0, seeded.output
    evaluated = runner.invoke(
        cli, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
    )
    assert evaluated.exit_code == 0, evaluated.output
    return db_path


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_seed(tmp_path)))


@pytest.fixture
def con(client: TestClient) -> duckdb.DuckDBPyConnection:
    shared: duckdb.DuckDBPyConnection = client.app.state.connection  # type: ignore[attr-defined]
    return shared.cursor()


def _one(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> Any:
    row = con.execute(sql, params or []).fetchone()
    assert row is not None
    return row[0]


def test_nav_lists_buckets(client: TestClient) -> None:
    assert 'href="/buckets"' in client.get("/").text


def test_buckets_page_shows_composition_and_signed_residual(client: TestClient) -> None:
    body = client.get("/buckets").text
    assert "Pensione" in body
    # ADR-0025: the UNASSIGNED residual is a signed row in the same reconciliation table.
    assert "UNASSIGNED" in body or "non assegnat" in body.lower()


def test_apportion_write_action_appends_a_row(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """`ApportionBucket` (UX-0001 §2.2): appends an effective-dated row, never updates one."""
    before = _one(con, "SELECT count(*) FROM bucket_apportionment")
    bucket_id = _one(con, "SELECT id FROM bucket LIMIT 1")
    asset_id = _one(con, "SELECT id FROM asset LIMIT 1")

    response = client.post(
        f"/buckets/{bucket_id}/apportion",
        data={"asset_id": asset_id, "quantity": "12.5", "effective_from": "2026-07-25"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/buckets"

    after = _one(con, "SELECT count(*) FROM bucket_apportionment")
    assert after == before + 1


def test_apportion_rejects_malformed_quantity_without_a_500(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """Over-apportionment warns, never blocks (I-9) — but a malformed value is still rejected."""
    bucket_id = _one(con, "SELECT id FROM bucket LIMIT 1")
    response = client.post(
        f"/buckets/{bucket_id}/apportion",
        data={"asset_id": "not-a-uuid", "quantity": "abc", "effective_from": "2026-07-25"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=" in response.headers["location"]
