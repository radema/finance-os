"""Screen 5 — Operations, the ledger, at `/operations` (ADR-0026, ADR-0028, I-10)."""

from __future__ import annotations

from pathlib import Path

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


def test_nav_lists_operations(client: TestClient) -> None:
    assert 'href="/operations"' in client.get("/").text


def test_operations_ledger_renders_and_offers_no_edit_or_delete(client: TestClient) -> None:
    response = client.get("/operations")
    assert response.status_code == 200
    body = response.text
    assert "Acquisto" in body  # BUY, localized (P17)
    # I-10: append-only. No edit/delete control anywhere on the page.
    assert "Modifica" not in body
    assert "Elimina" not in body
    assert 'name="delete"' not in body
