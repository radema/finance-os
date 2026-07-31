"""Read-side query: `mv_finding`, grouped and ordered (RFC-0008 §3/§4).

Only `financeos.web` may import this module (contract C4). Findings are grouped on
`finding_key` — never raw `recommendation` rows — and the order is literal and
non-negotiable: ``ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC``.
`mv_finding` already embeds this order; the `ORDER BY` here is restated so the contract holds
regardless of what the caller does with the connection between the view's definition and this
query.

**Resolution (RFC-0008 §4).** "A finding is resolved when its key is absent from the most
recent `ACTUAL` run in which its rule was evaluated with outcome `NOT_FIRED`." `mv_finding`
groups `recommendation` rows only — a rule that stops firing writes no new recommendation, so
the view alone cannot tell "still open" apart from "resolved". `list_findings` closes that gap
by checking the latest `alert` for the finding's (`rule_id`, `scope_id`) pair, where "latest"
is ordered by `as_of DESC` first — the same "operative run" ordering the rest of the read
model uses (e.g. `severity_history`), not `evaluated_at`, which can disagree with it under a
correction-model `evaluate --as-of <earlier-date>` run (ADR-0012) — and restricted to
`outcome IN ('FIRED', 'NOT_FIRED')`: a `SKIPPED` run is deliberately excluded from the
candidate set entirely, so it can never count as "the most recent run's outcome" and resurface
a finding a prior `NOT_FIRED` run already resolved (ADR-0016).

A `(rule_id, scope_id)` match alone is not enough to say "same finding": editing a Rule's
`condition.params` keeps `rule_id` and `scope_id` unchanged but changes `finding_key`
(`sha256(rule_id ‖ scope_id ‖ canonical(params))`, RFC-0008 §4), so the latest alert only
resolves *this* finding if its own recomputed key — from its trace's frozen
`condition.params`, hashed the same way the write side computes it — equals the finding's own
`finding_key`. When it does not match, there is no evidence either way and the finding stays
open.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import duckdb

from financeos.adapters.duckdb.queries.it_locale import format_number_it
from financeos.adapters.duckdb.queries.traces import observation_it, signed_severity
from financeos.core.shared import canonical_json, sha256_hex


@dataclass(frozen=True)
class FindingRow:
    """One grouped row of the ordered findings list."""

    finding_key: str
    rule_id: str
    first_recommendation_id: str
    latest_recommendation_id: str
    first_seen: date
    last_seen: date
    occurrences: int
    current_severity: Decimal | None
    current_priority: str
    priority_rank: int
    observation: str
    rationale: str
    suggestion_class: str | None


def list_findings(con: duckdb.DuckDBPyConnection) -> list[FindingRow]:
    """Every *open* finding, joined to its latest `Recommendation` text, in display order.

    A resolved finding (RFC-0008 §4) is excluded: see the module docstring.
    """
    rows = con.execute(
        """
        WITH latest_alert AS (
            SELECT
                a.rule_id,
                run.scope_id,
                a.outcome,
                a.trace,
                ROW_NUMBER() OVER (
                    PARTITION BY a.rule_id, run.scope_id
                    ORDER BY run.as_of DESC, run.evaluated_at DESC, a.recorded_at DESC
                ) AS rn
            FROM alert a
            JOIN evaluation_run run ON run.id = a.run_id
            WHERE run.mode = 'ACTUAL' AND a.outcome IN ('FIRED', 'NOT_FIRED')
        )
        SELECT
            f.finding_key, f.rule_id, f.first_recommendation_id, f.latest_recommendation_id,
            f.first_seen, f.last_seen, f.occurrences, f.current_severity, f.current_priority,
            f.priority_rank, r.observation, r.rationale, r.suggestion_class,
            fr.scope_id, la.outcome, la.trace
        FROM mv_finding f
        JOIN recommendation r  ON r.id = f.latest_recommendation_id
        JOIN evaluation_run fr ON fr.id = r.run_id
        LEFT JOIN latest_alert la
            ON la.rule_id = f.rule_id AND la.scope_id = fr.scope_id AND la.rn = 1
        ORDER BY f.priority_rank DESC, f.current_severity DESC NULLS LAST, f.rule_id ASC
        """
    ).fetchall()
    return [
        FindingRow(
            finding_key=row[0],
            rule_id=row[1],
            first_recommendation_id=row[2],
            latest_recommendation_id=row[3],
            first_seen=row[4],
            last_seen=row[5],
            occurrences=row[6],
            current_severity=row[7],
            current_priority=row[8],
            priority_rank=row[9],
            observation=row[10],
            rationale=row[11],
            suggestion_class=row[12],
        )
        for row in rows
        if not _resolved(
            finding_key=row[0],
            rule_id=row[1],
            scope_id=row[13],
            latest_alert_outcome=row[14],
            latest_alert_trace=row[15],
        )
    ]


def _resolved(
    *,
    finding_key: str,
    rule_id: str,
    scope_id: str,
    latest_alert_outcome: str | None,
    latest_alert_trace: str | None,
) -> bool:
    """Whether `finding_key` is resolved by the latest determining alert (RFC-0008 §4).

    Only a `NOT_FIRED` latest alert can resolve anything, and only if it is evaluating *this*
    finding: its own `condition.params`, hashed the same way the write side computes
    `finding_key`, must reproduce `finding_key` exactly. See the module docstring.
    """
    if latest_alert_outcome != "NOT_FIRED" or latest_alert_trace is None:
        return False
    trace: dict[str, Any] = json.loads(str(latest_alert_trace))
    params = (trace.get("condition") or {}).get("params") or {}
    candidate_key = sha256_hex(rule_id, scope_id, canonical_json(dict(params)))
    return candidate_key == finding_key


@dataclass(frozen=True)
class FindingDisplayRow:
    """One finding with everything the findings list renders, and nothing more.

    `observation_it` is the frozen observation re-rendered with it-IT punctuation (L05 §7.3).
    `rationale` is **not** re-rendered: it was assembled by concatenation at write time
    (ADR-0023) rather than frozen as a template plus bindings, so the read side has no
    mechanism to localise it and the honest thing to show is the string that was frozen. See
    the module docstring of `financeos.web.routes.findings` for what that costs.
    """

    finding: FindingRow
    asset_class: str
    observation_it: str
    signed_severity: Decimal | None
    outcome: str
    scope_kind: str
    rule_name: str
    #: The declared target as it-IT percentage points (``"40,00%"``), for the rail's centre
    #: tick, or `None` for a kind whose bindings carry no target. Taken from the trace's frozen
    #: `target_pct` binding, which is already in percentage points — never re-derived.
    target_pct_it: str | None


def list_findings_for_display(con: duckdb.DuckDBPyConnection) -> list[FindingDisplayRow]:
    """Every finding, display-ready, in `mv_finding`'s order — **never re-sorted here**.

    The order is `list_findings`'s, consumed as it arrives: this function decorates rows and
    does not touch their sequence, so RFC-0008 §3's contract holds in exactly one place. A
    `sorted()` anywhere below would silently move the ordering decision out of the view that
    owns it.

    One extra query per finding resolves the trace and the rule. At n=1 this is irrelevant and
    at V1.0 scale it stays small; the day it does not, this becomes one join, not a cache.
    """
    findings = list_findings(con)
    return [_decorate(con, finding) for finding in findings]


def _decorate(con: duckdb.DuckDBPyConnection, finding: FindingRow) -> FindingDisplayRow:
    row = con.execute(
        """
        SELECT a.trace, a.outcome, run.scope_kind, sv.definition
        FROM recommendation r
        JOIN alert a              ON a.id  = r.alert_id
        JOIN evaluation_run run   ON run.id = r.run_id
        JOIN strategy_version sv  ON sv.id = r.strategy_version_id
        WHERE r.id = ?
        """,
        [finding.latest_recommendation_id],
    ).fetchone()
    if row is None:  # pragma: no cover - mv_finding cannot name a missing recommendation
        raise LookupError(f"recommendation {finding.latest_recommendation_id} is missing")

    trace: dict[str, Any] = json.loads(str(row[0]))
    definition: dict[str, Any] = json.loads(str(row[3]))
    rule = _rule_of(definition, finding.rule_id)
    condition = trace.get("condition") or {}
    params = condition.get("params") or {}
    message_bindings = trace.get("message_bindings") or {}

    return FindingDisplayRow(
        finding=finding,
        target_pct_it=_target_pct_it(message_bindings),
        asset_class=str(params.get("asset_class", "")),
        observation_it=observation_it(
            str(rule.get("message", finding.observation)),
            trace.get("message_bindings") or {},
            str(condition.get("kind", "")),
            int(condition.get("kind_version", 0)),
        ),
        signed_severity=signed_severity(finding.current_severity, trace.get("steps") or ()),
        outcome=str(row[1]),
        scope_kind=str(row[2]),
        rule_name=str(rule.get("name", "")),
    )


def _target_pct_it(message_bindings: Mapping[str, str]) -> str | None:
    """The frozen `target_pct` binding as it-IT percentage points, or `None` when absent.

    `target_pct` is already in percentage points (`Percentage.from_ratio(...).canonical()` at
    write time), so only its punctuation changes — `format_number_it` never rounds and never
    rescales. A kind that binds no target simply has no centre-tick label.
    """
    raw = message_bindings.get("target_pct")
    return None if raw is None else f"{format_number_it(Decimal(raw))}%"


def _rule_of(definition: dict[str, Any], rule_id: str) -> dict[str, Any]:
    """The rule as frozen in `strategy_version.definition` (ADR-0027: there is no `rule` table).

    Returns an empty mapping rather than raising when the id is absent: `rule_id` carries no FK
    by design, and a read path is the wrong place to discover that the repository's
    property-tested invariant has been violated.
    """
    for rule in definition.get("rules") or ():
        if str(rule.get("id")) == rule_id:
            return dict(rule)
    return {}
