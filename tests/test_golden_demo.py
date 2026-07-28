"""Golden-file test: `seed demo && evaluate` reproduces the canonical fixture exactly.

The canonical row (RFC-0005 §8.3 / UX-0001 §8): Equity/Developed 34.00% actual vs 40.00%
target, ±2.00pp ABSOLUTE, drift −6.00pp, severity 3.00, drift value −€3,240.00 — and it is the
*only* Recommendation the demo dataset produces.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import duckdb
from click.testing import CliRunner

from financeos.cli import app

REPO_ROOT = Path(__file__).resolve().parents[1]
EXPECTED = json.loads((REPO_ROOT / "demo" / "expected" / "findings.json").read_text())


def _run_seed_and_evaluate(db_path: Path) -> None:
    runner = CliRunner()
    seed_result = runner.invoke(app, ["--db-path", str(db_path), "seed", "demo"])
    assert seed_result.exit_code == 0, seed_result.output
    evaluate_result = runner.invoke(
        app, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
    )
    assert evaluate_result.exit_code == 0, evaluate_result.output
    assert "1 Recommendation" in evaluate_result.output


def test_seed_demo_and_evaluate_matches_golden_file(tmp_path: Path) -> None:
    db_path = tmp_path / "financeos.duckdb"
    _run_seed_and_evaluate(db_path)

    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")

    assert con.execute("SELECT count(*) FROM alert").fetchone() == (EXPECTED["alert_count"],)
    assert con.execute("SELECT count(*) FROM recommendation").fetchone() == (
        EXPECTED["recommendation_count"],
    )

    row = con.execute(
        """
        SELECT a.rule_id, a.outcome, a.priority, a.severity, a.trace, r.suggestion_class
        FROM alert a JOIN recommendation r ON r.alert_id = a.id
        """
    ).fetchone()
    assert row is not None
    rule_id, outcome, priority, severity, trace, suggestion_class = row
    expected = EXPECTED["findings"][0]

    assert rule_id == expected["rule_id"]
    assert outcome == expected["outcome"]
    assert priority == expected["priority"]
    assert Decimal(severity) == Decimal(expected["severity"])
    assert suggestion_class == expected["suggestion_class"]

    message_bindings = json.loads(trace)["message_bindings"]
    assert message_bindings == expected["message_bindings"]
