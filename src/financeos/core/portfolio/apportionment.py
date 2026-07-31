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

from financeos.core.shared import AssetId, BucketId, DomainModel, Instant, Quantity


class ApportionmentRecord(DomainModel):
    """One `bucket_apportionment` row, superseded or current, verbatim."""

    id: UUID
    bucket_id: BucketId
    asset_id: AssetId
    quantity: Quantity
    effective_from: date
    supersedes_id: UUID | None = None
    recorded_at: Instant
