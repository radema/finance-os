"""Read-side query modules over `mv_holding` / `mv_finding` (adapters.duckdb.queries)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import duckdb
from click.testing import CliRunner

from financeos.adapters.duckdb.queries.dashboard import (
    aggregate_outcome_counts,
    bucket_findings_states,
)
from financeos.adapters.duckdb.queries.findings import list_findings
from financeos.adapters.duckdb.queries.holdings import list_holdings
from financeos.adapters.duckdb.queries.runs import latest_actual_run_for_scope
from financeos.adapters.duckdb.queries.snapshots import drift_history
from financeos.cli import app

DEMO_PORTFOLIO_ID = "a8283d57-9cc4-5376-8952-1cf4208fcbd7"
DEMO_BUCKET_ID = "44940ba1-0bfd-5d7c-ba07-4d80aefdd508"


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


def test_bucket_findings_states_carries_both_counts_together(tmp_path: Path) -> None:
    """`/dashboard`'s guard (task #12): open findings and unevaluated always travel together."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    states = bucket_findings_states(con, [DEMO_BUCKET_ID], as_of=date(2026, 7, 24))
    state = states[DEMO_BUCKET_ID]
    assert state.run_id is not None
    assert state.open_findings == 1
    assert state.rules_measured == 1
    assert state.rules_unevaluated == 0
    assert state.worst_severity == Decimal("3.00000000")


def test_bucket_findings_states_reports_never_evaluated_rather_than_zero(
    tmp_path: Path,
) -> None:
    """A Bucket with no run of its own is `None`, not a false `0` (ADR-0016)."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    never_run_id = "00000000-0000-0000-0000-000000000000"
    states = bucket_findings_states(con, [never_run_id], as_of=date(2026, 7, 24))
    state = states[never_run_id]
    assert state.run_id is None
    assert state.open_findings is None
    assert state.rules_measured is None
    assert state.rules_unevaluated is None
    assert state.worst_severity is None


def test_aggregate_outcome_counts_sums_across_runs(tmp_path: Path) -> None:
    db_path = _seeded_and_evaluated(tmp_path)
    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")
    bucket_run = latest_actual_run_for_scope(con, "BUCKET", DEMO_BUCKET_ID)
    portfolio_run = latest_actual_run_for_scope(con, "PORTFOLIO", DEMO_PORTFOLIO_ID)
    assert bucket_run is not None
    assert portfolio_run is not None

    counts = aggregate_outcome_counts(con, [bucket_run.id, portfolio_run.id])
    assert counts.total == 1  # the single demo rule is Bucket-gated (ADR-L06)
    assert counts.fired == 1
