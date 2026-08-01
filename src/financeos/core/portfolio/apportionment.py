"""`ApportionmentRecord` — one raw `bucket_apportionment` row (RFC-0009 §7.1).

Unlike `VirtualHolding` (the derived, latest-applicable-per-asset projection folded over a
supersession chain, ADR-0025), this is the authored fact itself: every row ever written,
current or superseded. Re-apportioning is a change of mind, not a mistake, so a superseded
row is not noise to discard — it is exactly what a supersession chain is reconstructed from,
and dropping it on export would silently lose history that `virtual_holdings` never carried
in the first place.
"""

from datetime import date
from uuid import UUID

from pydantic import model_validator

from financeos.core.shared import AssetId, BucketId, DomainModel, Instant, Quantity, QuantityAmount
from financeos.core.shared.errors import InvariantViolationError


class ApportionmentRecord(DomainModel):
    """One `bucket_apportionment` row, superseded or current, verbatim."""

    id: UUID
    bucket_id: BucketId
    asset_id: AssetId
    quantity: Quantity
    effective_from: date
    supersedes_id: UUID | None = None
    recorded_at: Instant


class ApportionmentLine(DomainModel):
    """One Asset's resolved Σ apportionment against its Holding, at `as_of` (ADR-0025,
    ADR-L04 §4.4 D5).

    A derived read model, distinct from `ApportionmentRecord`: this is one asset's *fold* of
    the supersession chain across every Bucket, paired against the Portfolio-wide Holding —
    exactly the two operands `over_apportioned`'s I-9 predicate compares.

    `portfolio_engine.compute_apportionment` emits one line per asset carrying committed
    units at `as_of` — never a line where `apportioned_quantity == 0` — which is the
    fact-construction guarantee that keeps `over_apportioned`'s severity denominator safe.
    """

    asset_id: AssetId
    apportioned_quantity: QuantityAmount
    holding_quantity: QuantityAmount

    @model_validator(mode="after")
    def _apportioned_quantity_is_positive(self) -> "ApportionmentLine":
        """The model states the invariant itself (review MAJOR 5), not only the producer:
        `over_apportioned`'s severity denominator (`Σ apportioned_quantity`) is only provably
        non-zero on the firing set if no line is ever constructed at `apportioned_quantity <= 0`
        (ADR-L04 §4.4 D5)."""
        if self.apportioned_quantity <= 0:
            raise InvariantViolationError(
                "ApportionmentLine.apportioned_quantity must be > 0; "
                f"got {self.apportioned_quantity}"
            )
        return self
