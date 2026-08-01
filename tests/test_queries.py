"""Read-side query modules over `mv_holding` / `mv_finding` (adapters.duckdb.queries)."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import duckdb
from click.testing import CliRunner

from financeos.adapters.duckdb.queries.findings import list_findings
from financeos.adapters.duckdb.queries.holdings import list_holdings
from financeos.adapters.duckdb.queries.snapshots import drift_history
from financeos.cli import app

DEMO_PORTFOLIO_ID = "a8283d57-9cc4-5376-8952-1cf4208fcbd7"


def _seeded_and_evaluated(tmp_path: Path) -> Path:
    db_path = tmp_path / "financeos.duckdb"
    runner = CliRunner()
    assert runner.invoke(app, ["--db-path", str(db_path), "seed", "demo"]).exit_code == 0
    assert (
        runner.invoke(
            app, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
        ).exit_code
        == 0
    )
    return db_path


def test_list_findings_returns_the_one_canonical_finding(tmp_path: Path) -> None:
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    findings = list_findings(con)
    assert len(findings) == 1
    assert findings[0].current_priority == "HIGH"
    assert findings[0].occurrences == 1


def test_list_holdings_returns_both_demo_assets(tmp_path: Path) -> None:
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    holdings = list_holdings(con, DEMO_PORTFOLIO_ID)
    asset_classes = {h.asset_class for h in holdings}
    # The demo fixture never funds the account (the skeleton importer is BUY-only, RFC-0005
    # §8.1), so every BUY's auto cash leg (ADR-0026) leaves a negative CASH position at
    # portfolio level — accepted per the fixture's own scope note (see the W1c report).
    assert {"EQUITY_DEVELOPED", "BOND_GOV_EUR"} <= asset_classes
    cash_row = next(h for h in holdings if h.asset_class == "CASH")
    assert cash_row.quantity < 0


def test_drift_history_reads_the_snapshot_written_on_evaluate(tmp_path: Path) -> None:
    """RFC-0009 §5.1/§6: `Snapshot` is written on `evaluate`, and the series reads it
    as-recorded rather than recomputing under today's Strategy."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    (point,) = drift_history(con, DEMO_PORTFOLIO_ID, "EQUITY_DEVELOPED")
    assert point.weight == Decimal("0.34")
    assert point.target == Decimal("0.40")
    assert point.drift == Decimal("-0.06")


def test_drift_history_is_empty_for_an_untargeted_class(tmp_path: Path) -> None:
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    (point,) = drift_history(con, DEMO_PORTFOLIO_ID, "CASH")
    assert point.target is None
    assert point.drift is None
