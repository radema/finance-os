"""Derived read models of the Portfolio context (RFC-0004 §2.3).

`Holding` is computed, never authored (ADR-0003): a stored mutable quantity would permit a
position to change with no corresponding `Operation`, which is unauditable and the most
likely source of silent divergence in the system.

`VirtualHolding` is likewise derived (ADR-0025): the authored fact is the
`bucket_apportionment` row, and the entity is the projection of its supersession chain at
`as_of` — exactly the `Operation`/`Holding` relationship one level down.
"""

from collections.abc import Mapping
from datetime import date

from financeos.core.shared import (
    AssetClass,
    AssetId,
    BucketId,
    DomainModel,
    Money,
    Quantity,
    Scope,
    Weight,
)


class Holding(DomainModel):
    """A folded position: how much of one `Asset` a scope holds.

    Attributes:
        input_refs: References to the rows the fold consumed, so a value derived from this
            holding can carry resolvable provenance (Stage B, ADR-0004).
    """

    asset_id: AssetId
    quantity: Quantity
    input_refs: tuple[str, ...] = ()


class VirtualHolding(DomainModel):
    """A `Bucket`'s apportioned share of one `Asset` at a point in time (ADR-0025)."""

    bucket_id: BucketId
    asset_id: AssetId
    quantity: Quantity
    input_refs: tuple[str, ...] = ()

    def as_holding(self) -> Holding:
        """Read this apportioned quantity as a holding, for Bucket-scoped valuation."""
        return Holding(asset_id=self.asset_id, quantity=self.quantity, input_refs=self.input_refs)


class AllocationLine(DomainModel):
    """One `AssetClass`'s value and share of a scope (RFC-0004 §2.1)."""

    asset_class: AssetClass
    value: Money
    weight: Weight
    input_refs: tuple[str, ...] = ()


class AllocationBreakdown(DomainModel):
    """What a scope holds, valued and grouped by `AssetClass` — the Portfolio Engine output.

    Attributes:
        unpriced_assets: Held `Asset`s for which no price was supplied. A breakdown carrying
            any of these is *incomplete*: consuming it would produce a partial denominator,
            which RFC-0007 §4.1 forbids, so the Strategy Engine skips instead.
    """

    scope: Scope
    as_of: date
    total_value: Money
    lines: Mapping[AssetClass, AllocationLine]
    unpriced_assets: tuple[AssetId, ...] = ()

    @property
    def is_complete(self) -> bool:
        """Whether every held `Asset` could be valued."""
        return not self.unpriced_assets
