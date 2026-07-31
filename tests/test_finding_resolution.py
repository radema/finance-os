"""Resolution (RFC-0008 §4): synthetic rows only.

"A finding is resolved when its key is absent from the most recent `ACTUAL` run in which its
rule was evaluated with outcome `NOT_FIRED`." Reproduces the false-alarm bug the Wave-1 gate
review found: clearing a drift condition and re-evaluating must stop the old finding from
showing as open, but a `SKIPPED` re-evaluation must not be mistaken for resolution
(ADR-0016 — silence is not reassurance).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pytest

from financeos.adapters.duckdb.queries.findings import list_findings

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)
T1 = datetime(2026, 1, 1, tzinfo=UTC)
T2 = T1 + timedelta(days=7)


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    connection.execute("INSERT INTO portfolio VALUES ('p1', 'P')")
    connection.execute("INSERT INTO strategy VALUES ('s1', 'S', NULL, NULL)")
    connection.execute(
        "INSERT INTO strategy_version (id, strategy_id, parent_version_id, definition, "
        "change_note, frozen_at) VALUES ('sv1', 's1', NULL, '{}', 'n', ?)",
        [T1],
    )
    for run_id, evaluated_at in (("run1", T1), ("run2", T2)):
        connection.execute(
            "INSERT INTO evaluation_run (id, portfolio_id, strategy_id, strategy_version_id, "
            "scope_kind, scope_id, as_of, evaluated_at, mode, engine_versions, input_digest) "
            "VALUES (?, 'p1', 's1', 'sv1', 'PORTFOLIO', 'p1', ?, ?, 'ACTUAL', '{}', ?)",
            [run_id, evaluated_at.date(), evaluated_at, "0" * 64],
        )
    yield connection
    connection.close()


def _fired(con: duckdb.DuckDBPyConnection, *, run_id: str, recorded_at: datetime) -> None:
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, 'r-drift', 'FIRED', 'HIGH', 3.0, '{}', ?)",
        [f"alert-{run_id}", run_id, recorded_at],
    )
    con.execute(
        "INSERT INTO recommendation (id, alert_id, run_id, strategy_version_id, rule_id, "
        "finding_key, observation, rationale, suggestion_class, input_refs, recorded_at) "
        "VALUES (?, ?, ?, 'sv1', 'r-drift', 'fk-drift', 'o', 'r', NULL, '[]', ?)",
        [f"rec-{run_id}", f"alert-{run_id}", run_id, recorded_at],
    )


def _not_fired(con: duckdb.DuckDBPyConnection, *, run_id: str, recorded_at: datetime) -> None:
    """No `recommendation` row: `NOT_FIRED` never materializes one (RFC-0008 §3)."""
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, 'r-drift', 'NOT_FIRED', 'HIGH', NULL, '{}', ?)",
        [f"alert-{run_id}", run_id, recorded_at],
    )


def _skipped(con: duckdb.DuckDBPyConnection, *, run_id: str, recorded_at: datetime) -> None:
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, 'r-drift', 'SKIPPED', 'HIGH', NULL, '{}', ?)",
        [f"alert-{run_id}", run_id, recorded_at],
    )


def test_a_cleared_drift_stops_showing_as_an_open_finding(
    con: duckdb.DuckDBPyConnection,
) -> None:
    """The reproduced bug: FIRED then NOT_FIRED must clear the finding, not leave a false alarm."""
    _fired(con, run_id="run1", recorded_at=T1)
    _not_fired(con, run_id="run2", recorded_at=T2)
    assert list_findings(con) == []


def test_a_still_firing_finding_stays_open(con: duckdb.DuckDBPyConnection) -> None:
    """The finding must not vanish just because a later run exists — it must still be firing."""
    _fired(con, run_id="run1", recorded_at=T1)
    _fired(con, run_id="run2", recorded_at=T2)
    findings = list_findings(con)
    assert [f.finding_key for f in findings] == ["fk-drift"]


def test_a_skipped_reevaluation_is_not_resolution(con: duckdb.DuckDBPyConnection) -> None:
    """ADR-0016: absence because the rule was SKIPPED must not read as resolved."""
    _fired(con, run_id="run1", recorded_at=T1)
    _skipped(con, run_id="run2", recorded_at=T2)
    findings = list_findings(con)
    assert [f.finding_key for f in findings] == ["fk-drift"]
