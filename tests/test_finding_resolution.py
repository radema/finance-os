"""Resolution (RFC-0008 §4): synthetic rows only.

"A finding is resolved when its key is absent from the most recent `ACTUAL` run in which its
rule was evaluated with outcome `NOT_FIRED`." Reproduces the false-alarm bug the Wave-1 gate
review found: clearing a drift condition and re-evaluating must stop the old finding from
showing as open, but a `SKIPPED` re-evaluation must not be mistaken for resolution
(ADR-0016 — silence is not reassurance).

`finding_key` is computed for real here (`sha256(rule_id ‖ scope_id ‖ canonical(params))`,
same as the write side), not a stand-in string: the resolution predicate recomputes it from
each candidate alert's trace, so a test that hardcoded an arbitrary key would not exercise the
match/mismatch it is meant to prove.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pytest

from financeos.adapters.duckdb.queries.findings import list_findings
from financeos.core.shared import canonical_json, sha256_hex

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)
RULE_ID = "r-drift"
SCOPE_ID = "p1"
T1 = datetime(2026, 1, 1, tzinfo=UTC)
T2 = T1 + timedelta(days=7)
T3 = T1 + timedelta(days=14)


def _finding_key(params: dict[str, str]) -> str:
    """The same hash the write side computes (RFC-0008 §4), over `RULE_ID`/`SCOPE_ID`."""
    return sha256_hex(RULE_ID, SCOPE_ID, canonical_json(params))


def _trace(params: dict[str, str]) -> str:
    return json.dumps({"condition": {"params": params}})


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
    for run_id, evaluated_at in (("run1", T1), ("run2", T2), ("run3", T3)):
        connection.execute(
            "INSERT INTO evaluation_run (id, portfolio_id, strategy_id, strategy_version_id, "
            "scope_kind, scope_id, as_of, evaluated_at, mode, engine_versions, input_digest) "
            "VALUES (?, 'p1', 's1', 'sv1', 'PORTFOLIO', ?, ?, ?, 'ACTUAL', '{}', ?)",
            [run_id, SCOPE_ID, evaluated_at.date(), evaluated_at, "0" * 64],
        )
    yield connection
    connection.close()


def _fired(
    con: duckdb.DuckDBPyConnection,
    *,
    run_id: str,
    recorded_at: datetime,
    params: dict[str, str] | None = None,
) -> str:
    """Records a FIRED alert plus its 1:1 recommendation, and returns the finding_key."""
    key = _finding_key(params or {})
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, ?, 'FIRED', 'HIGH', 3.0, ?, ?)",
        [f"alert-{run_id}", run_id, RULE_ID, _trace(params or {}), recorded_at],
    )
    con.execute(
        "INSERT INTO recommendation (id, alert_id, run_id, strategy_version_id, rule_id, "
        "finding_key, observation, rationale, suggestion_class, input_refs, recorded_at) "
        "VALUES (?, ?, ?, 'sv1', ?, ?, 'o', 'r', NULL, '[]', ?)",
        [f"rec-{run_id}", f"alert-{run_id}", run_id, RULE_ID, key, recorded_at],
    )
    return key


def _not_fired(
    con: duckdb.DuckDBPyConnection,
    *,
    run_id: str,
    recorded_at: datetime,
    params: dict[str, str] | None = None,
) -> None:
    """No `recommendation` row: `NOT_FIRED` never materializes one (RFC-0008 §3)."""
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, ?, 'NOT_FIRED', 'HIGH', NULL, ?, ?)",
        [f"alert-{run_id}", run_id, RULE_ID, _trace(params or {}), recorded_at],
    )


def _skipped(con: duckdb.DuckDBPyConnection, *, run_id: str, recorded_at: datetime) -> None:
    con.execute(
        "INSERT INTO alert (id, run_id, rule_id, outcome, priority, severity, trace, "
        "recorded_at) VALUES (?, ?, ?, 'SKIPPED', 'HIGH', NULL, '{}', ?)",
        [f"alert-{run_id}", run_id, RULE_ID, recorded_at],
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
    key = _fired(con, run_id="run1", recorded_at=T1)
    _fired(con, run_id="run2", recorded_at=T2)
    findings = list_findings(con)
    assert [f.finding_key for f in findings] == [key]


def test_a_skipped_reevaluation_is_not_resolution(con: duckdb.DuckDBPyConnection) -> None:
    """ADR-0016: absence because the rule was SKIPPED must not read as resolved."""
    key = _fired(con, run_id="run1", recorded_at=T1)
    _skipped(con, run_id="run2", recorded_at=T2)
    findings = list_findings(con)
    assert [f.finding_key for f in findings] == [key]


def test_editing_rule_params_does_not_resolve_an_unrelated_finding(
    con: duckdb.DuckDBPyConnection,
) -> None:
    """Two findings, same rule_id+scope_id, different `condition.params`: distinct finding_keys.

    Resolving one (a `NOT_FIRED` at the same params) must not resolve the other, even though a
    `(rule_id, scope_id)`-only match would treat them as the same finding. This reproduces the
    regression: editing `params.asset_class` on a live rule must not make an unrelated,
    still-live finding vanish.
    """
    key_a = _fired(con, run_id="run1", recorded_at=T1, params={"asset_class": "EQUITY"})
    key_b = _fired(con, run_id="run2", recorded_at=T2, params={"asset_class": "BOND"})
    _not_fired(con, run_id="run3", recorded_at=T3, params={"asset_class": "BOND"})
    findings = {f.finding_key for f in list_findings(con)}
    assert findings == {key_a}
    assert key_b not in findings
