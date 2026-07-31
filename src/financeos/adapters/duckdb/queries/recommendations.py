"""Read-side query: the explanation surface, `/recommendations/{id}` (RFC-0008 §6).

Only `financeos.web` may import this module (contract C4).

RFC-0008 §6 fixes nine blocks and their order, and UX-0001 §5.1 lists that order as
corpus-specified — "block order taken literally". This module supplies the data for all nine;
what is *absent* is as carefully reported as what is present, because three of the nine have no
source in the skeleton's schema and a silently missing block is indistinguishable from a
reassuring one (ADR-0016):

* **Reconcile** — shown only when a recomputation diverges from `input_digest` (RFC-0009 §2.2).
  Nothing in the skeleton recomputes, so `reconcile_available` is `False` and the block says so
  in words. Omitting it would read as "reconciled, no divergence", which is not known.
* **Portfolio state** — a join on `snapshot.run_id`. `snapshot` is specified as written on every
  `evaluate` run (RFC-0009 §5.1) but `app/evaluate_strategy.py` writes none, so the table is
  empty and `snapshot` is `None`.
* **Decision** — there is no `decision` table in migration 001; capture is V1.1 (ADR-0002,
  UX-0001 §2.2 draws the control disabled).

`severity_history` is the series behind the History block (RFC-0008 §12.3): one point per
`ACTUAL` run in which this `finding_key` fired. It reads the as-recorded severity from `alert`
(RFC-0009 §6) and never recomputes it under current classifications.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.adapters.duckdb.queries.it_locale import format_number_it
from financeos.adapters.duckdb.queries.traces import (
    ladder_bindings,
    ladder_steps,
    observation_it,
    signed_severity,
)


@dataclass(frozen=True)
class SnapshotRow:
    """"What you held when this fired" — the derived checkpoint sharing the run's id."""

    as_of: date
    total_value: Decimal
    currency: str
    allocation: Mapping[str, Mapping[str, str]]
    by_bucket: Mapping[str, str]


@dataclass(frozen=True)
class SeverityPoint:
    """One as-recorded severity reading of one finding."""

    as_of: date
    severity: Decimal | None


@dataclass(frozen=True)
class RecommendationDetail:
    """Everything the nine blocks of one explanation surface read."""

    # -- block 1, Finding
    id: str
    rule_id: str
    rule_name: str
    finding_key: str
    observation: str
    observation_it: str
    suggestion_class: str | None
    severity: Decimal | None
    signed_severity: Decimal | None
    priority: str
    outcome: str
    asset_class: str
    scope_kind: str
    scope_id: str
    # -- block 2, Motivation
    rationale: str
    strategy_name: str
    strategy_version_id: str
    change_note: str
    frozen_at: datetime
    # -- blocks 3 and 4, Bindings and Computation (the lazy fragment)
    trace: Mapping[str, Any]
    condition_kind: str
    condition_kind_version: int
    tolerance_kind: str | None
    #: The stored ratio strings, exactly as the trace holds them — for the ladder.
    effective_target: str | None
    effective_band: str | None
    #: The same two values as it-IT percentage points, for prose and for the rail's centre
    #: tick. Both forms are carried deliberately: the ladder must show what was stored, and a
    #: sentence must not read "0.40000000".
    target_pct_it: str | None
    band_pct_it: str | None
    # -- block 5, Provenance
    run_id: str
    portfolio_name: str
    as_of: date
    evaluated_at: datetime
    mode: str
    engine_versions: Mapping[str, str]
    input_digest: str
    input_refs: tuple[str, ...]
    recorded_at: datetime
    # -- block 6, History
    first_seen: date
    last_seen: date
    occurrences: int
    # -- block 7, Reconcile
    reconcile_available: bool
    # -- block 8, Portfolio state
    snapshot: SnapshotRow | None
    # -- block 9, Decision
    decisions: tuple[str, ...]

    @property
    def bindings(self) -> list[dict[str, Any]]:
        """The trace's bindings, shaped for the ladder, values exactly as stored."""
        return ladder_bindings(self.trace)

    @property
    def steps(self) -> list[dict[str, Any]]:
        """The trace's steps, shaped for the ladder, values exactly as stored."""
        return ladder_steps(self.trace)


def get_recommendation(
    con: duckdb.DuckDBPyConnection, recommendation_id: str
) -> RecommendationDetail | None:
    """One Recommendation with every block's data, or `None` when the id does not resolve.

    One statement, joining the five tables RFC-0008 §6 names as the block sources, plus
    `mv_finding` for the History block. No aggregate is loaded (UX-0001 §2.1) — the row is flat
    and the trace arrives as the JSON document it is stored as (ADR-0013).
    """
    row = con.execute(
        """
        SELECT
            r.id, r.rule_id, r.finding_key, r.observation, r.rationale, r.suggestion_class,
            r.input_refs, CAST(r.recorded_at AS VARCHAR),
            a.outcome, a.priority, a.severity, a.trace,
            run.id, run.as_of, CAST(run.evaluated_at AS VARCHAR), run.mode, run.engine_versions,
            run.input_digest, run.scope_kind, run.scope_id,
            p.name,
            sv.id, sv.definition, sv.change_note, CAST(sv.frozen_at AS VARCHAR),
            s.name,
            f.first_seen, f.last_seen, f.occurrences,
            snap.as_of, snap.total_value, snap.currency, snap.allocation, snap.by_bucket
        FROM recommendation r
        JOIN alert a              ON a.id  = r.alert_id
        JOIN evaluation_run run   ON run.id = r.run_id
        JOIN portfolio p          ON p.id  = run.portfolio_id
        JOIN strategy_version sv  ON sv.id = r.strategy_version_id
        JOIN strategy s           ON s.id  = sv.strategy_id
        JOIN mv_finding f         ON f.finding_key = r.finding_key
        LEFT JOIN snapshot snap   ON snap.run_id = r.run_id
        WHERE r.id = ?
        """,
        [recommendation_id],
    ).fetchone()
    if row is None:
        return None

    trace: dict[str, Any] = json.loads(str(row[11]))
    definition: dict[str, Any] = json.loads(str(row[22]))
    rule = _rule_of(definition, str(row[1]))
    condition = trace.get("condition") or {}
    params = condition.get("params") or {}
    bound = _bound_values(trace)
    message_bindings: Mapping[str, str] = trace.get("message_bindings") or {}
    severity: Decimal | None = row[10]

    return RecommendationDetail(
        id=str(row[0]),
        rule_id=str(row[1]),
        rule_name=str(rule.get("name", "")),
        finding_key=str(row[2]),
        observation=str(row[3]),
        observation_it=observation_it(
            str(rule.get("message", row[3])),
            message_bindings,
            str(condition.get("kind", "")),
            int(condition.get("kind_version", 0)),
        ),
        suggestion_class=str(row[5]) if row[5] is not None else None,
        severity=severity,
        signed_severity=signed_severity(severity, trace.get("steps") or ()),
        priority=str(row[9]),
        outcome=str(row[8]),
        asset_class=str(params.get("asset_class", "")),
        scope_kind=str(row[18]),
        scope_id=str(row[19]),
        rationale=str(row[4]),
        strategy_name=str(row[25]),
        strategy_version_id=str(row[21]),
        change_note=str(row[23]),
        frozen_at=parse_instant(str(row[24])),
        trace=trace,
        condition_kind=str(condition.get("kind", "")),
        condition_kind_version=int(condition.get("kind_version", 0)),
        tolerance_kind=_tolerance_kind(trace),
        effective_target=bound.get("effective_target"),
        effective_band=bound.get("effective_band"),
        target_pct_it=_pct_it(message_bindings.get("target_pct")),
        band_pct_it=_pct_it(message_bindings.get("tolerance_pct")),
        run_id=str(row[12]),
        portfolio_name=str(row[20]),
        as_of=row[13],
        evaluated_at=parse_instant(str(row[14])),
        mode=str(row[15]),
        engine_versions=json.loads(str(row[16])),
        input_digest=str(row[17]),
        input_refs=tuple(json.loads(str(row[6]))),
        recorded_at=parse_instant(str(row[7])),
        first_seen=row[26],
        last_seen=row[27],
        occurrences=int(row[28]),
        # No code path in the skeleton recomputes an evaluation, so divergence from
        # `input_digest` is not merely absent — it is unknown. The template says which.
        reconcile_available=False,
        snapshot=(
            SnapshotRow(
                as_of=row[29],
                total_value=row[30],
                currency=str(row[31]),
                allocation=json.loads(str(row[32])),
                by_bucket=json.loads(str(row[33])),
            )
            if row[29] is not None
            else None
        ),
        # There is no `decision` table in migration 001; capture is V1.1 (ADR-0002).
        decisions=(),
    )


def severity_history(
    con: duckdb.DuckDBPyConnection, finding_key: str
) -> tuple[SeverityPoint, ...]:
    """The as-recorded severity of one finding, one point per `ACTUAL` run, oldest first.

    RFC-0009 §6: the series renders as-recorded and is never recomputed under today's
    classifications, which is why this reads `alert.severity` rather than re-deriving it.
    """
    rows = con.execute(
        """
        SELECT run.as_of, a.severity
        FROM recommendation r
        JOIN alert a            ON a.id  = r.alert_id
        JOIN evaluation_run run ON run.id = r.run_id
        WHERE r.finding_key = ? AND run.mode = 'ACTUAL'
        ORDER BY run.as_of ASC, r.recorded_at ASC
        """,
        [finding_key],
    ).fetchall()
    return tuple(SeverityPoint(as_of=row[0], severity=row[1]) for row in rows)


def _pct_it(raw: str | None) -> str | None:
    """A frozen percentage-point binding as it-IT, or `None` when the kind binds none.

    The binding is already in percentage points, so only its punctuation changes:
    `format_number_it` neither rounds nor rescales, which is what keeps this display consistent
    with the ladder above it.
    """
    return None if raw is None else f"{format_number_it(Decimal(raw))}%"


def _rule_of(definition: dict[str, Any], rule_id: str) -> dict[str, Any]:
    """The rule as frozen in `strategy_version.definition` (ADR-0027: no `rule` table)."""
    for rule in definition.get("rules") or ():
        if str(rule.get("id")) == rule_id:
            return dict(rule)
    return {}


def _bound_values(trace: Mapping[str, Any]) -> dict[str, str]:
    """Scalar binding values by name, as the stored strings — never reformatted."""
    return {
        str(b.get("name")): str(b.get("value"))
        for b in trace.get("bindings") or ()
        if not isinstance(b.get("value"), Mapping)
    }


def _tolerance_kind(trace: Mapping[str, Any]) -> str | None:
    """`ABSOLUTE` or `RELATIVE` out of the structured `tolerance` binding, when present."""
    for b in trace.get("bindings") or ():
        value = b.get("value")
        if b.get("name") == "tolerance" and isinstance(value, Mapping):
            kind = value.get("kind")
            return str(kind) if kind is not None else None
    return None
