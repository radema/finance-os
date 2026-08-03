"""Screen 7 — Run health at `/runs`, `/runs/{id}` (RFC-0006 §5, ADR-0016, RFC-0008 §8).

Exercised through `TestClient` against the real demo fixture, the same discipline
`test_web_views.py` established for the walking skeleton.
"""

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


def test_runs_list_renders(client: TestClient) -> None:
    response = client.get("/runs")
    assert response.status_code == 200
    assert "run:" in response.text


def test_run_detail_shows_every_outcome_never_as_reassurance(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """SKIPPED != NOT_FIRED (ADR-0016): a bare count is never rendered without its reasons.

    The current demo fixture (being grown to six classes in parallel) fires exactly one Rule
    and skips none, so this asserts the general contract against the real read models rather
    than a specific outcome mix: every alert this run produced gets its own chip, and the
    persistent skip notice appears exactly when — and only when — the run's own counts say it
    skipped or errored on something.
    """
    run_id = _one(con, "SELECT id FROM evaluation_run LIMIT 1")
    body = client.get(f"/runs/{run_id}").text
    assert "Scattata" in body
    row = con.execute(
        "SELECT count_if(outcome = 'SKIPPED'), count_if(outcome = 'ERROR') "
        "FROM alert WHERE run_id = ?",
        [run_id],
    ).fetchone()
    assert row is not None
    skipped, error = row
    if skipped or error:
        assert "Non valutato non significa conforme." in body
    else:
        assert "Non valutato non significa conforme." not in body


def test_unknown_run_is_404(client: TestClient) -> None:
    assert client.get("/runs/does-not-exist").status_code == 404


def test_provenance_bar_links_to_run_health(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """The provenance bar links to *the* run — the truly latest `ACTUAL` one (ADR-L06 §6.1).

    `financeos evaluate` now writes at least two `evaluation_run` rows per `as_of` (one per
    governed Bucket plus one Portfolio-scope call, RFC-0007 §5), so picking "a run" with no
    ordering is meaningless — this mirrors `latest_actual_run`'s own
    `mode = 'ACTUAL', ORDER BY as_of DESC, evaluated_at DESC` exactly, rather than asserting
    against whichever row an unordered scan happens to return first.
    """
    latest_run_id = _one(
        con,
        "SELECT id FROM evaluation_run WHERE mode = 'ACTUAL' "
        "ORDER BY as_of DESC, evaluated_at DESC LIMIT 1",
    )
    earlier_run_id = _one(
        con,
        "SELECT id FROM evaluation_run WHERE mode = 'ACTUAL' AND id != ? "
        "ORDER BY as_of DESC, evaluated_at DESC LIMIT 1",
        [latest_run_id],
    )
    body = client.get("/").text
    assert f'href="/runs/{latest_run_id}"' in body
    assert f'href="/runs/{earlier_run_id}"' not in body


def test_nav_lists_run_health(client: TestClient) -> None:
    assert 'href="/runs"' in client.get("/").text
