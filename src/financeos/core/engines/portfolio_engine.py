"""Portfolio Engine — the fold and the valuation (RFC-0007 §6.1).

Two pure functions, no repository (I-7), no clock:

* `compute_holdings` folds `Operation`s into `Holding`s (ADR-0003).
* `compute_allocation` values holdings against prices and groups them by `AssetClass` into
  the `AllocationBreakdown` the Strategy Engine consumes.

Valuation is sited here rather than in the Strategy Engine so that Strategy sees only
`AssetClass` keys and monetary totals, never instruments — which is what keeps I-14
enforceable (RFC-0007 §6.1).
"""

from collections.abc import Collection, Mapping, Sequence
from datetime import date
from decimal import Decimal
from typing import Final

from financeos.core.market import PriceView
from financeos.core.portfolio import (
    AllocationBreakdown,
    AllocationLine,
    Asset,
    Holding,
    Operation,
)
from financeos.core.shared import (
    REF_OPERATION,
    REF_PRICE,
    AccountId,
    AssetClass,
    AssetId,
    Currency,
    Money,
    Quantity,
    Scope,
    Weight,
    entity_ref,
)
from financeos.core.shared.errors import CurrencyMismatchError
from financeos.core.shared.numbers import WEIGHT_PRECISION, WEIGHT_SCALE, quantize

#: Recorded in `evaluation_run.engine_versions`, so a replay discrepancy caused by an
#: evaluator fix is distinguishable from one caused by a data change (RFC-0006 §8).
ENGINE_VERSION: Final = "1.0.0"
ENGINE_NAME: Final = "portfolio"


def compute_holdings(
    operations: Sequence[Operation],
    *,
    as_of: date,
    accounts: Collection[AccountId] | None = None,
) -> tuple[Holding, ...]:
    """Fold `Operation`s into `Holding`s (ADR-0003).

    Every row's `quantity` is already a signed change in the units of its own `asset_id` —
    securities for a primary row, currency units for a cash leg — so the fold applies no
    type filter, exactly as `mv_holding` does not (ADR-L01 §4.8).

    Args:
        operations: The operations to fold. Rows after `as_of` are ignored.
        as_of: The domain date to fold up to, inclusive.
        accounts: Restrict the fold to these accounts. `None` folds every row given.

    Returns:
        One `Holding` per `Asset` with a non-zero net quantity, ordered by `asset_id`, each
        carrying the references of the operations it folded.
    """
    quantities: dict[AssetId, Quantity] = {}
    refs: dict[AssetId, list[str]] = {}
    for operation in operations:
        if operation.trade_date > as_of:
            continue
        if accounts is not None and operation.account_id not in accounts:
            continue
        asset_id = operation.asset_id
        quantities[asset_id] = quantities.get(asset_id, Quantity.zero()) + operation.quantity
        refs.setdefault(asset_id, []).append(entity_ref(REF_OPERATION, operation.id))
    return tuple(
        Holding(asset_id=asset_id, quantity=quantity, input_refs=tuple(refs[asset_id]))
        for asset_id, quantity in sorted(quantities.items(), key=lambda item: str(item[0]))
        if not quantity.is_zero
    )


def compute_allocation(
    holdings: Sequence[Holding],
    assets: Mapping[AssetId, Asset],
    prices: Mapping[AssetId, PriceView],
    *,
    scope: Scope,
    as_of: date,
    currency: Currency,
) -> AllocationBreakdown:
    """Value `holdings` and group them by `AssetClass`.

    A held `Asset` with no price is recorded in `unpriced_assets` and contributes nothing:
    the breakdown is then *incomplete* and the Strategy Engine skips rather than dividing by
    a partial denominator (RFC-0007 §4.1). Untargeted classes are included, so capital that
    exists never vanishes from the denominator (RFC-0007 §4.1, ADR-0029).

    Args:
        holdings: Positions in scope — the fold's output for a Portfolio, or the resolved
            `VirtualHolding`s read as holdings for a Bucket (ADR-0025).
        assets: The `Asset` definition of every held id, for its `AssetClass`.
        prices: One `PriceView` per priced `Asset`.
        scope: What this breakdown describes.
        as_of: The domain date valued against.
        currency: The reporting currency. V1 assumes a single one (RFC-0004 §10.5).

    Returns:
        The `AllocationBreakdown` for `scope`.

    Raises:
        CurrencyMismatchError: If an asset's price is quoted in another currency (I-15 —
            there is no implicit conversion in the core).
        KeyError: If a held `asset_id` has no `Asset` definition, which is a fact-loading
            defect rather than a domain state.
    """
    values: dict[AssetClass, Money] = {}
    refs: dict[AssetClass, list[str]] = {}
    unpriced: list[AssetId] = []
    total = Money.zero(currency)

    for holding in holdings:
        asset = assets[holding.asset_id]
        price = prices.get(holding.asset_id)
        if price is None:
            unpriced.append(holding.asset_id)
            continue
        if price.currency != currency:
            raise CurrencyMismatchError(
                f"price for {asset.name} is quoted in {price.currency}, not {currency}"
            )
        value = Money(amount=holding.quantity.amount * price.close, currency=currency)
        asset_class = asset.asset_class
        values[asset_class] = values.get(asset_class, Money.zero(currency)) + value
        refs.setdefault(asset_class, []).extend(
            (*holding.input_refs, entity_ref(REF_PRICE, price.price_id))
        )
        total = total + value

    lines = {
        asset_class: AllocationLine(
            asset_class=asset_class,
            value=value,
            weight=_share(value, total),
            input_refs=tuple(refs[asset_class]),
        )
        for asset_class, value in sorted(values.items())
    }
    return AllocationBreakdown(
        scope=scope,
        as_of=as_of,
        total_value=total,
        lines=lines,
        unpriced_assets=tuple(unpriced),
    )


def _share(value: Money, total: Money) -> Weight:
    """`value / total` at weight scale, or zero when the scope has no value."""
    if total.is_zero:
        return Weight(value=Decimal(0))
    return Weight(
        value=quantize(value.amount / total.amount, precision=WEIGHT_PRECISION, scale=WEIGHT_SCALE)
    )
