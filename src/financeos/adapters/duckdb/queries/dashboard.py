"""Read-side query: `/dashboard` — per-Bucket findings/coverage state (task #12, ADR-L06).

Only `financeos.web` may import this module (contract C4).

**Net worth and composition are not recomputed here.** `/dashboard` reads
`queries/allocation.py::portfolio_allocation` exactly as `/allocation` does: the segments
reconciling to the net-worth tick (ADR-0029) is already that module's own contract, and a second
place computing the same reconciliation is a second place for it to drift.

**Why a Bucket's own latest run, never the Portfolio's globally-latest one.**
`evaluate_strategy` is called once per Bucket and once more for the Portfolio scope in the same
`financeos evaluate` invocation (RFC-0007 §5, ADR-L06); the Portfolio-scope call runs last, so
`queries/runs.py::latest_actual_run` — which picks the single most recent run over every scope —
usually returns *that* run, not any one Bucket's own. Each card therefore reads its own
`latest_actual_run_for_scope('BUCKET', bucket_id)`.

**Never a card's own latest run, unless it shares the page's `as_of`.** A Bucket evaluated at an
earlier `as_of` than the page's own run (e.g. re-evaluated with `--bucket-id`, at a later date,
after the page's other Buckets already moved on) would otherwise report stale counts beside a
provenance bar naming a newer date. `as_of` is the caller's own run's date (task #12 review
SHOULD-FIX 2): a Bucket run whose `as_of` disagrees is treated exactly like no run at all, rather
than a silently mismatched one.

**The two-counts guard (W2 plan doc, variation C — "Il patrimonio annotato").**
`BucketFindingsState` always carries `open_findings` and `rules_unevaluated` together, and both
are `None` together when the Bucket has never been evaluated at all — distinct from an evaluated
Bucket whose rules all reached a verdict (`rules_unevaluated == 0`). Reporting a zero where no
measurement ever happened would be exactly the silent false reassurance ADR-0016 forbids.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import duckdb

from financeos.adapters.duckdb.queries.findings import FindingRow, list_findings
from financeos.adapters.duckdb.queries.runs import (
    OutcomeCounts,
    SkipReasonCount,
    latest_actual_run_for_scope,
    run_outcome_counts,
)


@dataclass(frozen=True)
class BucketFindingsState:
    """One Bucket's own findings/coverage state, from its own latest `ACTUAL` run.

    Every field is `None` together when `run_id` is `None`: the Bucket was never evaluated in
    its own right, which is a different state from "evaluated, and every rule reached a verdict".
    """

    run_id: str | None
    open_findings: int | None
    rules_measured: int | None
    rules_unevaluated: int | None
    worst_severity: Decimal | None


def bucket_findings_states(
    con: duckdb.DuckDBPyConnection, bucket_ids: Sequence[str], *, as_of: date
) -> dict[str, BucketFindingsState]:
    """Every id in `bucket_ids`, mapped to its own findings/coverage state as of `as_of`.

    `open_findings` groups the same open-findings set `/` reads (`list_findings`, RFC-0008 §4's
    resolution rule already applied there) by each finding's own `scope_id` — never a second
    resolution check reimplemented here.

    `as_of` is the page's own run's date: a Bucket run at a different `as_of` is treated as no
    run at all (module docstring, task #12 review SHOULD-FIX 2).
    """
    # `list_findings` also runs once more inside `list_findings_for_display` for this same
    # request (the ledger below the cards) — fine at V1.0 scale (task #12 review NIT); a shared
    # cache would be a second thing to keep in sync, not a saving, at today's row counts.
    by_scope: dict[str, list[FindingRow]] = defaultdict(list)
    for finding in list_findings(con):
        by_scope[finding.scope_id].append(finding)

    states: dict[str, BucketFindingsState] = {}
    for bucket_id in bucket_ids:
        run = latest_actual_run_for_scope(con, "BUCKET", bucket_id)
        if run is None or run.as_of != as_of:
            states[bucket_id] = BucketFindingsState(
                run_id=None,
                open_findings=None,
                rules_measured=None,
                rules_unevaluated=None,
                worst_severity=None,
            )
            continue
        counts = run_outcome_counts(con, run.id)
        findings = by_scope.get(bucket_id, [])
        severities = [f.current_severity for f in findings if f.current_severity is not None]
        states[bucket_id] = BucketFindingsState(
            run_id=run.id,
            open_findings=len(findings),
            rules_measured=counts.fired + counts.not_fired,
            rules_unevaluated=counts.skipped + counts.error,
            worst_severity=max(severities) if severities else None,
        )
    return states


def aggregate_outcome_counts(
    con: duckdb.DuckDBPyConnection, run_ids: Sequence[str]
) -> OutcomeCounts:
    """The union of every run in `run_ids`, for the skip notice above the cards (ADR-0016).

    No single `evaluation_run` row covers what `/dashboard` claims: every Bucket card and the
    Portfolio-scope pass each write their own run (RFC-0007 §5), so the notice above the cards
    has to sum `run_outcome_counts` over the runs actually feeding this page rather than read one
    run picked arbitrarily.
    """
    per_run = [run_outcome_counts(con, run_id) for run_id in run_ids]
    reasons: dict[str, int] = {}
    for counts in per_run:
        for reason in counts.reasons:
            reasons[reason.reason] = reasons.get(reason.reason, 0) + reason.count
    return OutcomeCounts(
        total=sum(c.total for c in per_run),
        fired=sum(c.fired for c in per_run),
        not_fired=sum(c.not_fired for c in per_run),
        skipped=sum(c.skipped for c in per_run),
        error=sum(c.error for c in per_run),
        reasons=tuple(
            SkipReasonCount(reason=reason, count=count)
            for reason, count in sorted(reasons.items(), key=lambda kv: (-kv[1], kv[0]))
        ),
    )
