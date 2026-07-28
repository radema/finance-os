"""`mv_finding` ordering contract (RFC-0008 §3, ADR-L02 §4.5): synthetic rows only.

``ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC`` is literal and
non-negotiable. The demo fixture cannot exercise all three clauses at once without disturbing
the canonical 40/34/-6pp example (ADR-L02 §4.5), so this dedicated test exercises them with
synthetic `alert`/`recommendation` rows — the fixture UX-0001 §8.5 itself warns is mandatory,
not optional: *"a fixture that does not exercise all three of these is not testing the
ordering contract."*
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)
NOW = datetime(2026, 1, 1, tzinfo=UTC)


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
        [NOW],
    )
    connection.execute(
        "INSERT INTO evaluation_run (id, portfolio_id, strategy_id, strategy_version_id, "
        "scope_kind, scope_id, as_of, evaluated_at, mode, engine_versions, input_digest) "
        "VALUES ('run1', 'p1', 's1', 'sv1', 'PORTFOLIO', 'p1', ?, ?, 'ACTUAL', '{}', ?)",
        [NOW.date(), NOW, "0" * 64],
    )
    yield connection
    connection.close()


def _finding(
    con: duckdb.DuckDBPyConnection,
    *,
    alert_id: str,
    rule_id: str,
    priority: str,
    severity: float | None,
    finding_key: str,
) -> None:
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, 'run1', ?, 'FIRED', ?, ?, '{}', ?)",
        [alert_id, rule_id, priority, severity, NOW],
    )
    con.execute(
        "INSERT INTO recommendation (id, alert_id, run_id, strategy_version_id, rule_id, "
        "finding_key, observation, rationale, suggestion_class, input_refs, recorded_at) "
        "VALUES (?, ?, 'run1', 'sv1', ?, ?, 'o', 'r', NULL, '[]', ?)",
        [f"rec-{alert_id}", alert_id, rule_id, finding_key, NOW],
    )


def test_priority_dominates_severity(con: duckdb.DuckDBPyConnection) -> None:
    """Row 10 outranks nothing by severity alone: CRITICAL with low severity beats HIGH with
    high severity, because `priority_rank` sorts first (RFC-0008 §3)."""
    _finding(con, alert_id="a1", rule_id="r-critical", priority="CRITICAL", severity=0.10,
              finding_key="fk-critical")
    _finding(con, alert_id="a2", rule_id="r-high", priority="HIGH", severity=9.99,
              finding_key="fk-high")
    rows = con.execute("SELECT rule_id FROM mv_finding").fetchall()
    assert [r[0] for r in rows] == ["r-critical", "r-high"]


def test_null_severity_sorts_last_within_its_priority_band(con: duckdb.DuckDBPyConnection) -> None:
    """`NULLS LAST`: a kind that cannot express urgency (e.g. `allocation_absent`, ADR-L02)
    must not outrank one that can, within the same `priority` band."""
    _finding(con, alert_id="a1", rule_id="r-quantified", priority="HIGH", severity=1.50,
              finding_key="fk-quantified")
    _finding(con, alert_id="a2", rule_id="r-null", priority="HIGH", severity=None,
              finding_key="fk-null")
    rows = con.execute("SELECT rule_id, current_severity FROM mv_finding").fetchall()
    assert [r[0] for r in rows] == ["r-quantified", "r-null"]
    assert rows[1][1] is None


def test_severity_tie_breaks_on_rule_id_ascending(con: duckdb.DuckDBPyConnection) -> None:
    """A severity tie is broken by `rule_id ASC` (UX-0001 §8.5's rows 4/5)."""
    _finding(con, alert_id="a1", rule_id="rule:b", priority="HIGH", severity=1.79,
              finding_key="fk-b")
    _finding(con, alert_id="a2", rule_id="rule:a", priority="HIGH", severity=1.79,
              finding_key="fk-a")
    rows = con.execute("SELECT rule_id FROM mv_finding").fetchall()
    assert [r[0] for r in rows] == ["rule:a", "rule:b"]


def test_all_three_clauses_together(con: duckdb.DuckDBPyConnection) -> None:
    """One query exercising all three ORDER BY clauses at once, exactly as UX-0001 §8.5 says
    a fixture must."""
    _finding(con, alert_id="a1", rule_id="rule:critical", priority="CRITICAL", severity=None,
              finding_key="fk-1")
    _finding(con, alert_id="a2", rule_id="rule:tie-b", priority="HIGH", severity=2.00,
              finding_key="fk-2")
    _finding(con, alert_id="a3", rule_id="rule:tie-a", priority="HIGH", severity=2.00,
              finding_key="fk-3")
    _finding(con, alert_id="a4", rule_id="rule:low-null", priority="HIGH", severity=None,
              finding_key="fk-4")
    _finding(con, alert_id="a5", rule_id="rule:medium", priority="MEDIUM", severity=99.0,
              finding_key="fk-5")
    rows = con.execute("SELECT rule_id FROM mv_finding").fetchall()
    assert [r[0] for r in rows] == [
        "rule:critical",  # CRITICAL band first, despite null severity
        "rule:tie-a",  # HIGH band, severity tie broken by rule_id ASC
        "rule:tie-b",
        "rule:low-null",  # HIGH band, NULLS LAST
        "rule:medium",  # MEDIUM band sorts last regardless of its high severity
    ]
