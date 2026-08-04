"""Golden-file test: `seed demo && evaluate` reproduces the UX-0001 §8.5 fixture exactly.

The six-class fixture (UX-0001 §8.5): 10 FIRED / 9 NOT_FIRED / 8 SKIPPED / 1 ERROR, 28
evaluations total = (7 generic Bucket-scope rules x 3 governed Buckets) + 1 Bucket-specific
+ 3 portfolio-scope + 3 Capital-preservation. The canonical row (RFC-0005 §8.3 / RFC-0008
§5.1: Equity/Developed 34.00% actual vs 40.00% target, drift -6.00pp, severity 3.00) is
preserved exactly among the ten.
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
    assert f"{EXPECTED['recommendation_count']} Recommendation" in evaluate_result.output


def test_seed_demo_and_evaluate_matches_golden_file(tmp_path: Path) -> None:
    db_path = tmp_path / "financeos.duckdb"
    _run_seed_and_evaluate(db_path)

    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")

    assert con.execute("SELECT count(*) FROM alert").fetchone() == (EXPECTED["alert_count"],)
    assert con.execute("SELECT count(*) FROM recommendation").fetchone() == (
        EXPECTED["recommendation_count"],
    )
    assert con.execute("SELECT count(*) FROM alert WHERE outcome = 'SKIPPED'").fetchone() == (
        EXPECTED["skipped_count"],
    )
    assert con.execute("SELECT count(*) FROM alert WHERE outcome = 'ERROR'").fetchone() == (
        EXPECTED["error_count"],
    )
    assert con.execute("SELECT count(*) FROM alert WHERE outcome = 'NOT_FIRED'").fetchone() == (
        EXPECTED["not_fired_count"],
    )

    # UX-0001 §8.5's SKIPPED breakdown: 7 x zero_portfolio_value (Personal is empty), 1 x
    # heterogeneous_strategies (portfolio scope) — ADR-L07 is what makes the first seven
    # reachable at all (untargeted_allocation/allocation_absent used to NOT_FIRE / SKIP with
    # the narrower missing_fact reason on a genuinely empty Bucket).
    skip_rows = con.execute(
        "SELECT json_extract_string(trace, '$.skip_reason') AS reason, count(*) "
        "FROM alert WHERE outcome = 'SKIPPED' GROUP BY 1"
    ).fetchall()
    assert dict(skip_rows) == EXPECTED["skip_reasons"]

    # The one ERROR: a Bucket-specific rule authoring a USD target against a EUR Bucket on
    # purpose (I-15, W2-rule-scope-partition.md §1's "1 Bucket-specific" slot).
    error_row = con.execute("SELECT rule_id FROM alert WHERE outcome = 'ERROR'").fetchone()
    assert error_row == (EXPECTED["error_rule_id"],)

    # The ten FIRED findings, in RFC-0008 §3's own order: priority_rank DESC, severity DESC
    # NULLS LAST, rule_id ASC. All three ORDER BY clauses are exercised (UX-0001 §8.5): the
    # CRITICAL row sorts first on band alone, rows 4/5 tie at 1.78781900 and split only on
    # rule_id, and the MEDIUM row (1.21600460) sorts last despite outranking row 9 (1.05) on
    # severity, because Priority dominates.
    rows = con.execute(
        """
        SELECT a.rule_id, a.outcome, a.priority, a.severity, a.trace, r.suggestion_class
        FROM alert a JOIN recommendation r ON r.alert_id = a.id
        ORDER BY
            CASE a.priority
                WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2
                WHEN 'LOW' THEN 1 ELSE 0
            END DESC,
            a.severity DESC,
            a.rule_id ASC
        """
    ).fetchall()
    assert len(rows) == len(EXPECTED["findings"])

    for (rule_id, outcome, priority, severity, trace, suggestion_class), expected in zip(
        rows, EXPECTED["findings"], strict=True
    ):
        assert rule_id == expected["rule_id"]
        assert outcome == expected["outcome"]
        assert priority == expected["priority"]
        assert Decimal(severity) == Decimal(expected["severity"])
        assert suggestion_class == expected["suggestion_class"]

        # Only structured/canonical bindings are pinned — never `asset_class_label` or any
        # other Italian surface string, which the label registry (L05, W1d) is about to
        # change. A prose golden file would fail for a reason that has nothing to do with
        # correctness.
        message_bindings = json.loads(trace)["message_bindings"]
        pinned = {k: v for k, v in message_bindings.items() if k in expected["message_bindings"]}
        assert pinned == expected["message_bindings"]
