"""Read-side query: `evaluation_run`, and the outcome counts the skip notice needs.

Only `financeos.web` may import this module (contract C4).

This is the provenance source for *every* screen. Under the correction model (ADR-0012) the
same question has different true answers depending on which run is being read, so
`partials/provenance_bar.html` is on every page and needs a run behind it — or an explicit
`None`, which the partial renders as "nessuna valutazione" rather than as silence.

`latest_actual_run` filters `mode = 'ACTUAL'`. A HYPOTHETICAL run produces zero
Recommendations (RFC-0008 §8) and must never become the run a page reports itself as reading.

`run_outcome_counts` exists because of ADR-0016: a findings list that renders "nessun rilievo"
over a run that skipped twenty rules re-introduces silent false reassurance at the
presentation layer, after the domain went to trouble to prevent it. The counts come from
`alert`, where all four outcomes persist (E5) — not from `recommendation`, which only ever
holds firings.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import duckdb

from financeos.adapters.duckdb._time import parse_instant


@dataclass(frozen=True)
class RunRow:
    """One `evaluation_run`, joined to the names a provenance bar shows."""

    id: str
    portfolio_id: str
    portfolio_name: str
    strategy_id: str
    strategy_name: str
    strategy_version_id: str
    change_note: str
    frozen_at: datetime
    scope_kind: str
    scope_id: str
    as_of: date
    evaluated_at: datetime
    mode: str
    engine_versions: Mapping[str, str]
    input_digest: str


@dataclass(frozen=True)
class SkipReasonCount:
    """How many evaluations in one run carried one skip reason, and which."""

    reason: str
    count: int


@dataclass(frozen=True)
class OutcomeCounts:
    """The four outcomes of one run, with the reasons behind the unevaluated ones."""

    total: int
    fired: int
    not_fired: int
    skipped: int
    error: int
    reasons: tuple[SkipReasonCount, ...]


#: `TIMESTAMPTZ` columns are cast to VARCHAR and parsed by `_time.parse_instant`: DuckDB's
#: Python client needs `pytz` to fetch one natively, a dependency this project does not carry
#: (see `adapters/duckdb/_time.py`). `DATE` columns fetch natively and need no cast.
_RUN_COLUMNS = """
    run.id, run.portfolio_id, p.name, run.strategy_id, s.name,
    run.strategy_version_id, sv.change_note, CAST(sv.frozen_at AS VARCHAR),
    run.scope_kind, run.scope_id, run.as_of, CAST(run.evaluated_at AS VARCHAR), run.mode,
    run.engine_versions, run.input_digest
"""

_RUN_JOINS = """
    FROM evaluation_run run
    JOIN portfolio p          ON p.id  = run.portfolio_id
    JOIN strategy s           ON s.id  = run.strategy_id
    JOIN strategy_version sv  ON sv.id = run.strategy_version_id
"""


def _to_run(row: tuple[object, ...]) -> RunRow:
    return RunRow(
        id=str(row[0]),
        portfolio_id=str(row[1]),
        portfolio_name=str(row[2]),
        strategy_id=str(row[3]),
        strategy_name=str(row[4]),
        strategy_version_id=str(row[5]),
        change_note=str(row[6]),
        frozen_at=parse_instant(str(row[7])),
        scope_kind=str(row[8]),
        scope_id=str(row[9]),
        as_of=row[10],  # type: ignore[arg-type]
        evaluated_at=parse_instant(str(row[11])),
        mode=str(row[12]),
        engine_versions=json.loads(str(row[13])),
        input_digest=str(row[14]),
    )


def latest_actual_run(con: duckdb.DuckDBPyConnection) -> RunRow | None:
    """The most recent `ACTUAL` run, or `None` when nothing has been evaluated yet.

    `None` is a real state, not an error: a freshly seeded store has facts and no evaluation,
    and every page has to say so rather than render an empty provenance bar.
    """
    row = con.execute(
        f"SELECT {_RUN_COLUMNS} {_RUN_JOINS} "
        "WHERE run.mode = 'ACTUAL' "
        "ORDER BY run.as_of DESC, run.evaluated_at DESC LIMIT 1"
    ).fetchone()
    return _to_run(row) if row is not None else None


def get_run(con: duckdb.DuckDBPyConnection, run_id: str) -> RunRow | None:
    """One run by id — the run a Recommendation pins, which may not be the latest."""
    row = con.execute(f"SELECT {_RUN_COLUMNS} {_RUN_JOINS} WHERE run.id = ?", [run_id]).fetchone()
    return _to_run(row) if row is not None else None


def list_runs(con: duckdb.DuckDBPyConnection) -> tuple[RunRow, ...]:
    """Every `evaluation_run`, most recent first — screen 7 (RFC-0006 §5, UX-0001 §2).

    Both `ACTUAL` and `HYPOTHETICAL` runs are listed: a hypothetical run persists alerts and
    traces (RFC-0008 §8) and its own broken configuration is exactly what this screen exists to
    surface, so filtering it out would hide the one place it is visible. `mode` renders as its
    own chip on each row so the two are never confused.
    """
    rows = con.execute(
        f"SELECT {_RUN_COLUMNS} {_RUN_JOINS} ORDER BY run.evaluated_at DESC"
    ).fetchall()
    return tuple(_to_run(row) for row in rows)


@dataclass(frozen=True)
class AlertRow:
    """One `alert` — a single rule's evaluation within one run, all four outcomes alike (E5)."""

    id: str
    rule_id: str
    outcome: str
    priority: str
    severity: Decimal | None
    reason: str | None  # skip_reason / error kind from the trace; SKIPPED and ERROR only


def list_alerts(con: duckdb.DuckDBPyConnection, run_id: str) -> tuple[AlertRow, ...]:
    """Every Alert of `run_id`, in the same order the findings list uses (RFC-0008 §3).

    `NOT_FIRED` and `FIRED` alerts carry no `skip_reason`/`error_kind` — `reason` is `None` for
    those, and the outcome chip partial requires one only for `SKIPPED`/`ERROR` (ADR-0016).
    """
    rows = con.execute(
        """
        SELECT id, rule_id, outcome, priority, severity,
               coalesce(trace ->> 'skip_reason', trace ->> 'error_kind')
        FROM alert
        WHERE run_id = ?
        ORDER BY
            CASE priority
                WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4
                WHEN 'MEDIUM'   THEN 3 WHEN 'LOW'  THEN 2
                ELSE 1
            END DESC,
            severity DESC NULLS LAST,
            rule_id ASC
        """,
        [run_id],
    ).fetchall()
    return tuple(
        AlertRow(
            id=str(row[0]),
            rule_id=str(row[1]),
            outcome=str(row[2]),
            priority=str(row[3]),
            severity=row[4],
            reason=str(row[5]) if row[5] is not None else None,
        )
        for row in rows
    )


def run_outcome_counts(con: duckdb.DuckDBPyConnection, run_id: str) -> OutcomeCounts:
    """The four outcome counts of `run_id`, plus per-reason counts for the unevaluated ones.

    The skip reason is read out of `alert.trace ->> 'skip_reason'` rather than from a column:
    the trace is the record of *why* (RFC-0009 §4.1), and ADR-0016 makes "not evaluated, cause
    unknown" the one thing a skip notice may never say.
    """
    row = con.execute(
        """
        SELECT count(*),
               count_if(outcome = 'FIRED'),
               count_if(outcome = 'NOT_FIRED'),
               count_if(outcome = 'SKIPPED'),
               count_if(outcome = 'ERROR')
        FROM alert WHERE run_id = ?
        """,
        [run_id],
    ).fetchone()
    total, fired, not_fired, skipped, error = (int(v) for v in row) if row else (0, 0, 0, 0, 0)

    reason_rows = con.execute(
        """
        SELECT coalesce(trace ->> 'skip_reason', 'unknown') AS reason, count(*)
        FROM alert
        WHERE run_id = ? AND outcome IN ('SKIPPED', 'ERROR')
        GROUP BY reason
        ORDER BY count(*) DESC, reason ASC
        """,
        [run_id],
    ).fetchall()
    return OutcomeCounts(
        total=total,
        fired=fired,
        not_fired=not_fired,
        skipped=skipped,
        error=error,
        reasons=tuple(SkipReasonCount(reason=str(r[0]), count=int(r[1])) for r in reason_rows),
    )
