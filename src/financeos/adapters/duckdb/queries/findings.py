"""Read-side query: `mv_finding`, grouped and ordered (RFC-0008 §3/§4).

Only `financeos.web` may import this module (contract C4). Findings are grouped on
`finding_key` — never raw `recommendation` rows — and the order is literal and
non-negotiable: ``ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC``.
`mv_finding` already embeds this order; the `ORDER BY` here is restated so the contract holds
regardless of what the caller does with the connection between the view's definition and this
query.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import duckdb


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
    """Every finding, joined to its latest `Recommendation` text, in display order."""
    rows = con.execute(
        """
        SELECT
            f.finding_key, f.rule_id, f.first_recommendation_id, f.latest_recommendation_id,
            f.first_seen, f.last_seen, f.occurrences, f.current_severity, f.current_priority,
            f.priority_rank, r.observation, r.rationale, r.suggestion_class
        FROM mv_finding f
        JOIN recommendation r ON r.id = f.latest_recommendation_id
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
    ]
