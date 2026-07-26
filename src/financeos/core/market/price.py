"""`PriceView` — the Market → Portfolio contract (ADR-0031).

Market owns every external observation, prices included, so that egress lives behind one
context (Privacy First, RFC-0005 §5.7). Portfolio never queries the `price` table; it
consumes this flat DTO, which pins `price_id` exactly as `IndicatorView` pins `reading_id`
so an evaluation stays resolvable after a restatement.
"""

from datetime import date

from financeos.core.shared import AssetId, Currency, DomainModel, Instant, PriceAmount, PriceId


class PriceView(DomainModel):
    """One asset's close price on one valid date, as recorded.

    Attributes:
        valid_date: The date the close refers to.
        recorded_at: When that close was recorded — the second half of the bitemporal pair,
            which is what lets a later discrepancy be explained as a restatement rather
            than a bug (RFC-0009 §3.1).
    """

    asset_id: AssetId
    price_id: PriceId
    valid_date: date
    close: PriceAmount
    currency: Currency
    recorded_at: Instant
