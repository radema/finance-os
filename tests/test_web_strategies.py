"""Screen 6 — Strategy authoring at `/strategies`, `/strategies/{id}` (ADR-0017, ADR-0018,
ADR-0027, ADR-0030). Built last, per RFC-0005 §8 / UX-0001 §9.3.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import unquote

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


def test_nav_lists_strategies(client: TestClient) -> None:
    assert 'href="/strategies"' in client.get("/").text


def test_strategies_index_renders(client: TestClient) -> None:
    response = client.get("/strategies")
    assert response.status_code == 200
    assert "Crescita di lungo periodo" in response.text


def test_strategy_detail_shows_targets_rules_and_requires_change_note(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    body = client.get(f"/strategies/{strategy_id}").text
    assert "EQUITY_DEVELOPED" in body or "Sviluppati" in body
    assert 'name="change_note"' in body
    assert "required" in body


_FREEZE_FORM = {
    "target_key_0": "EQUITY_DEVELOPED",
    "target_weight_0": "0.40000000",
    "target_tol_kind_0": "ABSOLUTE",
    "target_tol_band_0": "0.02000000",
    "target_key_1": "BOND_GOV_EUR",
    "target_weight_1": "0.60000000",
    "target_tol_kind_1": "ABSOLUTE",
    "target_tol_band_1": "0.05000000",
    "rule_id": "8e968a19-7229-5a9c-b2ad-9628229e77ae",
    "rule_enabled": "true",
    "rule_priority": "HIGH",
    "rule_suggestion_class": "CONSIDER_REBALANCE",
    "rule_message": "messaggio invariato {asset_class_label_the_cap}",
}


def test_freeze_appends_a_new_version_and_moves_the_pointer(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """Freeze and pointer move are one transaction (StrategyRepository.freeze_version)."""
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    before_version = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    before_count = _one(con, "SELECT count(*) FROM strategy_version")

    response = client.post(
        f"/strategies/{strategy_id}",
        data={
            **_FREEZE_FORM,
            "change_note": "Verifica trimestrale — nessuna modifica sostanziale.",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text

    after_version = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    after_count = _one(con, "SELECT count(*) FROM strategy_version")
    assert after_count == before_count + 1
    assert after_version != before_version

    detail = client.get(f"/strategies/{strategy_id}").text
    assert "Verifica trimestrale" in detail


def test_freeze_without_a_change_note_is_rejected(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """`StrategyVersion.change_note` has a `min_length=1` constraint (RFC-0007 §7)."""
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    before_count = _one(con, "SELECT count(*) FROM strategy_version")

    response = client.post(
        f"/strategies/{strategy_id}",
        data={**_FREEZE_FORM, "change_note": ""},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=" in response.headers["location"]
    after_count = _one(con, "SELECT count(*) FROM strategy_version")
    assert after_count == before_count


def test_editing_a_rule_param_freezes_a_new_version_and_leaves_the_old_one_intact(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """A params edit goes through the same freeze-a-new-version path as every other edit
    (RFC-0007 §7) — the prior `strategy_version` row and its `definition` are never touched."""
    rule_id = _FREEZE_FORM["rule_id"]
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    old_version_id = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    old_definition = _one(
        con, "SELECT definition FROM strategy_version WHERE id = ?", [old_version_id]
    )

    response = client.post(
        f"/strategies/{strategy_id}",
        data={
            **_FREEZE_FORM,
            f"rule_param_{rule_id}_scope": "bucket:11111111-1111-1111-1111-111111111111",
            "change_note": "Riassegno la regola a un altro bucket.",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text

    new_version_id = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    assert new_version_id != old_version_id

    new_definition = _one(
        con, "SELECT definition FROM strategy_version WHERE id = ?", [new_version_id]
    )
    assert "bucket:11111111-1111-1111-1111-111111111111" in new_definition
    assert "bucket:11111111-1111-1111-1111-111111111111" not in old_definition

    # the old version's row is byte-identical to what it was before the freeze
    unchanged = _one(
        con, "SELECT definition FROM strategy_version WHERE id = ?", [old_version_id]
    )
    assert unchanged == old_definition


def test_editing_a_rule_param_with_an_invalid_value_is_rejected_in_italian(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """An `asset_class` that fails the catalog's own pattern is rejected with a redirect and
    an Italian message — never a 500 (ADR-0014: params are validated against the kind's
    declared schema)."""
    rule_id = _FREEZE_FORM["rule_id"]
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    before_count = _one(con, "SELECT count(*) FROM strategy_version")

    response = client.post(
        f"/strategies/{strategy_id}",
        data={
            **_FREEZE_FORM,
            f"rule_param_{rule_id}_asset_class": "not a valid class!",
            "change_note": "Tentativo con un asset_class non valido.",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303
    location = unquote(response.headers["location"])
    assert "error=" in location
    assert "Parametro" in location
    assert "non valido" in location

    after_count = _one(con, "SELECT count(*) FROM strategy_version")
    assert after_count == before_count


def test_unknown_strategy_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/strategies/{missing}").status_code == 404
