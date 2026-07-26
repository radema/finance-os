"""`Asset` — the instrument definition (RFC-0004 §2.2).

An `Asset` carries no quantity: quantity lives in `Operation` and is folded into `Holding`
(ADR-0003). `asset_class` is mutable in place under the correction model (ADR-0012); the
audit row that must accompany a reclassification is a repository concern (RFC-0009 §3.3).
"""

from enum import StrEnum

from financeos.core.shared import AssetClass, AssetId, Currency, DomainModel


class IdentifierScheme(StrEnum):
    """The schemes under which an `Asset` may be identified (RFC-0004 §2.1)."""

    ISIN = "ISIN"
    TICKER = "TICKER"
    INTERNAL = "INTERNAL"


class AssetIdentifier(DomainModel):
    """One external identifier of an `Asset`. An `Asset` may carry several."""

    scheme: IdentifierScheme
    value: str


class Asset(DomainModel):
    """Aggregate root: what an instrument *is*, independent of how much of it is held."""

    id: AssetId
    name: str
    asset_class: AssetClass
    currency: Currency
    identifiers: tuple[AssetIdentifier, ...] = ()
