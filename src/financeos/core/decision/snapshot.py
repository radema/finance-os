"""`Snapshot` — an immutable Portfolio-wide checkpoint (I-16, RFC-0009 §5.1).

Written on every `evaluate` run (RFC-0010 V1.0), sharing `run_id` with the `Alert`s produced
in the same run so "what did the Portfolio look like when this Recommendation appeared" is a
single join rather than a reconstruction. A checkpoint and a series source, never a source of
truth: it is rebuildable from facts and may be dropped and regenerated.

Only `core.shared` vocabulary is used here (never `AllocationLine`/`Money` from
`core.portfolio`), because `core.decision` may not import another bounded context (C3).
"""

from collections.abc import Mapping
from datetime import date

from financeos.core.shared import (
    AssetClass,
    Currency,
    DomainModel,
    EvaluationRunId,
    Instant,
    MoneyAmount,
    PortfolioId,
    SnapshotId,
    WeightAmount,
)

#: The `by_bucket` key for capital assigned to no Bucket (ADR-0025/ADR-0029). Its value may
#: legitimately be negative — a deficit, not a defect.
UNASSIGNED = "UNASSIGNED"


class SnapshotClassLine(DomainModel):
    """One `AssetClass`'s value and share of `Snapshot.total_value`."""

    value: MoneyAmount
    weight: WeightAmount


class SnapshotBucketLine(DomainModel):
    """One `Bucket`'s value and share of `Snapshot.total_value`, or the `UNASSIGNED` residual.

    `weight` may be negative for `UNASSIGNED` — the same signed reading `over_apportioned`
    and `unassigned_residual_above` give it (RFC-0010:123).
    """

    value: MoneyAmount
    weight: WeightAmount


class Snapshot(DomainModel):
    """A Portfolio-wide checkpoint at `as_of` (RFC-0004 §2.3, I-16).

    Attributes:
        run_id: The `EvaluationRun` this checkpoint was taken alongside, when written by
            `evaluate` — `None` only for a checkpoint taken on explicit demand.
        allocation: One line per held `AssetClass`, keyed by its code.
        by_bucket: One line per `Bucket` plus `UNASSIGNED`, keyed by the Bucket's id (as a
            string) or the `UNASSIGNED` constant.
    """

    id: SnapshotId
    portfolio_id: PortfolioId
    as_of: date
    run_id: EvaluationRunId | None = None
    total_value: MoneyAmount
    currency: Currency
    allocation: Mapping[AssetClass, SnapshotClassLine]
    by_bucket: Mapping[str, SnapshotBucketLine]
    recorded_at: Instant
