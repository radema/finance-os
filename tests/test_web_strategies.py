"""Screen 6 — Strategy authoring at `/strategies`, `/strategies/{id}` (ADR-0017, ADR-0018,
ADR-0027, ADR-0030). Built last, per RFC-0005 §8 / UX-0001 §9.3.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from uuid import UUID, uuid4

import duckdb
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app.freeze_strategy import freeze_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.cli import app as cli
from financeos.core.shared import (
    Priority,
    RuleId,
    StrategyId,
    SuggestionClass,
    Weight,
    canonical_json,
    sha256_hex,
)
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


def _add_untouched_rule_with_a_non_canonical_param(
    con: duckdb.DuckDBPyConnection, strategy_id: str
) -> str:
    """Freeze a version that adds a second Rule whose stored param is deliberately
    non-canonical (`"0.02"` rather than the `WeightAmount`-quantized `"0.02000000"`) —
    reachable in practice because neither the YAML importer nor `freeze_strategy` validates
    params against the catalog. Returns the new Rule's id."""
    untouched_rule_id = uuid4()
    definition = StrategyDefinition(
        name="Crescita di lungo periodo",
        description=None,
        objective="Preservare e accrescere il capitale su un orizzonte di venti anni.",
        horizon=Horizon(years=20, target_date=None),
        risk=RiskProfile(
            level=RiskLevel.BALANCED,
            principles=("preservare il potere d'acquisto senza fare market timing",),
        ),
        targets=TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY_DEVELOPED",
                    weight=Weight(value=Decimal("0.40")),
                    tolerance=Tolerance(kind=ToleranceKind.ABSOLUTE, band=Decimal("0.02")),
                    children=(),
                ),
                TargetNode(
                    key="BOND_GOV_EUR",
                    weight=Weight(value=Decimal("0.60")),
                    tolerance=Tolerance(kind=ToleranceKind.ABSOLUTE, band=Decimal("0.05")),
                    children=(),
                ),
            )
        ),
        rules=(
            Rule(
                id=RuleId(UUID(_FREEZE_FORM["rule_id"])),
                name="Equity/Developed fuori tolleranza — Pensione",
                enabled=True,
                priority=Priority.HIGH,
                suggestion_class=SuggestionClass.CONSIDER_REBALANCE,
                message="messaggio invariato {asset_class_label_the_cap}",
                condition=LeafCondition(
                    kind="drift_outside_tolerance",
                    kind_version=1,
                    params={
                        "asset_class": "EQUITY_DEVELOPED",
                        "scope": "bucket:44940ba1-0bfd-5d7c-ba07-4d80aefdd508",
                    },
                ),
            ),
            Rule(
                id=RuleId(untouched_rule_id),
                name="Residuo non assegnato sopra soglia",
                enabled=True,
                priority=Priority.MEDIUM,
                suggestion_class=SuggestionClass.REVIEW_ALLOCATION,
                message="Residuo al {residual_pct}% sopra la soglia del {threshold_pct}%.",
                condition=LeafCondition(
                    kind="unassigned_residual_above",
                    kind_version=1,
                    params={"threshold_weight": "0.02"},  # deliberately non-canonical
                ),
            ),
        ),
    )
    uow = DuckDBUnitOfWork(con)
    freeze_strategy(
        uow,
        UUIDv7IdGen(),
        SystemClock(),
        StrategyId(UUID(strategy_id)),
        definition,
        "Preparazione test: regola aggiuntiva con parametro non canonico.",
    )
    return str(untouched_rule_id)


def _rule_condition_params(definition_json: str, rule_id: str) -> dict[str, str]:
    definition = json.loads(definition_json)
    for rule in definition["rules"]:
        if rule["id"] == rule_id:
            params: dict[str, str] = rule["condition"]["params"]
            return params
    raise AssertionError(f"rule {rule_id} not found in definition")


def test_freeze_carries_an_untouched_rules_params_byte_identical(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """BLOCKER regression: `_rebuild_condition` must re-serialize only the params actually
    posted for a Rule. `finding_key = sha256(rule_id ‖ scope_id ‖ canonical(condition.params))`
    (RFC-0008 §4) hashes the raw stored string, so reformatting an untouched Rule's params on
    every freeze — `"0.02"` -> `"0.02000000"` — would change its finding_key and silently
    detach every recorded Decision from its finding."""
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    untouched_rule_id = _add_untouched_rule_with_a_non_canonical_param(con, strategy_id)

    before_version_id = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    before_definition = _one(
        con, "SELECT definition FROM strategy_version WHERE id = ?", [before_version_id]
    )
    before_params = _rule_condition_params(before_definition, untouched_rule_id)
    assert before_params["threshold_weight"] == "0.02"
    scope_id = "portfolio:test"
    before_key = sha256_hex(
        untouched_rule_id, scope_id, canonical_json(before_params)
    )

    # edit only the OTHER rule's `scope` param; leave the untouched Rule alone entirely
    response = client.post(
        f"/strategies/{strategy_id}",
        data={
            **_FREEZE_FORM,
            f"rule_param_{_FREEZE_FORM['rule_id']}_scope": (
                "bucket:22222222-2222-2222-2222-222222222222"
            ),
            "change_note": "Modifico solo la prima regola.",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text

    after_version_id = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    assert after_version_id != before_version_id
    after_definition = _one(
        con, "SELECT definition FROM strategy_version WHERE id = ?", [after_version_id]
    )
    after_params = _rule_condition_params(after_definition, untouched_rule_id)

    assert after_params == before_params
    assert after_params["threshold_weight"] == "0.02"
    after_key = sha256_hex(untouched_rule_id, scope_id, canonical_json(after_params))
    assert after_key == before_key


def test_editing_a_rule_param_with_a_blank_value_is_rejected_not_silently_ignored(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """A field posted as an empty string is a deliberate attempt to clear it, not "no edit" —
    the catalog has no legal empty value for it, so it must be rejected rather than silently
    falling back to the old value while the change note claims an edit happened."""
    rule_id = _FREEZE_FORM["rule_id"]
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    before_count = _one(con, "SELECT count(*) FROM strategy_version")

    response = client.post(
        f"/strategies/{strategy_id}",
        data={
            **_FREEZE_FORM,
            f"rule_param_{rule_id}_asset_class": "",
            "change_note": "Tentativo di svuotare asset_class.",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=" in response.headers["location"]
    after_count = _one(con, "SELECT count(*) FROM strategy_version")
    assert after_count == before_count


def test_unknown_strategy_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/strategies/{missing}").status_code == 404
