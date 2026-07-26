"""Strategy Engine — drift against the frozen target tree (RFC-0007).

One pure function. It resolves the target tree to its leaves, compares each leaf against the
`AllocationBreakdown`, and emits the eight bindings RFC-0007 §4 names as `Bound` facts, so
the Rule Engine performs no financial computation of its own (RFC-0006 §3.1).

Drift is computed at **leaves**, because leaves are where `Asset`s map via `AssetClass`.
Interior-node roll-ups are a distinct finding with their own rule (RFC-0007 §2.1) and are
not built in V1.

The skeleton authors a depth-1 tree, which this general implementation treats as the special
case it is — no rewrite when hierarchy arrives (ADR-0017).
"""

from decimal import Decimal
from typing import Final

from financeos.core.portfolio import AllocationBreakdown
from financeos.core.shared import (
    REF_STRATEGY_VERSION,
    AssetClass,
    Bound,
    Money,
    SkipReason,
    SourceRef,
    StrategyVersionId,
    entity_ref,
)
from financeos.core.shared.numbers import (
    SEVERITY_PRECISION,
    SEVERITY_SCALE,
    WEIGHT_PRECISION,
    WEIGHT_SCALE,
    quantize,
)
from financeos.core.strategy import DriftComputation, DriftLine, TargetAllocation

ENGINE_VERSION: Final = "1.0.0"
ENGINE_NAME: Final = "strategy"


def compute_drift(
    allocation: AllocationBreakdown,
    targets: TargetAllocation,
    *,
    strategy_version_id: StrategyVersionId,
) -> DriftComputation:
    """Compute drift for every targeted leaf in `allocation`'s scope.

    Edge cases, each with a defined outcome (RFC-0007 §4.1):

    * `total_value == 0` → no lines, `unavailable = zero_portfolio_value`. A legitimate
      onboarding state, not an error.
    * An incomplete valuation (a held `Asset` with no price) → no lines,
      `unavailable = missing_fact`. Never a partial denominator.
    * A targeted leaf with no holding → `current_weight = 0`, so `drift = −effective_target`
      and the finding fires as ordinary under-allocation.
    * Untargeted holdings stay in `total_value` and therefore dilute every weight. That is
      the honest reading — the capital genuinely is there — and the dilution is what
      `untargeted_allocation` (V1.0) exists to explain.

    Args:
        allocation: The scope's valued holdings, grouped by `AssetClass`.
        targets: The frozen target tree of the governing `StrategyVersion`.
        strategy_version_id: Pinned in every fact's source, so a binding resolves back to
            the exact frozen definition it was measured against (I-11).

    Returns:
        A `DriftComputation`: either one `Bound[DriftLine]` per targeted leaf, or the reason
        drift could not be computed.
    """
    total = allocation.total_value
    unavailable = _unavailable_reason(allocation)
    if unavailable is not None:
        return DriftComputation(
            scope=allocation.scope,
            as_of=allocation.as_of,
            total_value=total,
            lines={},
            unavailable=unavailable,
        )

    version_ref = entity_ref(REF_STRATEGY_VERSION, strategy_version_id)
    lines: dict[AssetClass, Bound[DriftLine]] = {}
    for asset_class, leaf in targets.leaves().items():
        allocated = allocation.lines.get(asset_class)
        current_value = allocated.value if allocated else Money.zero(total.currency)
        current_weight = _weight(current_value.amount / total.amount)
        effective_target = leaf.effective_target
        drift = current_weight - effective_target
        effective_band = leaf.tolerance.effective_band(effective_target)
        line = DriftLine(
            asset_class=asset_class,
            current_value=current_value,
            current_weight=current_weight,
            effective_target=effective_target,
            target_value=Money(amount=effective_target * total.amount, currency=total.currency),
            drift=drift,
            drift_value=Money(amount=drift * total.amount, currency=total.currency),
            tolerance=leaf.tolerance,
            effective_band=effective_band,
            severity=_severity(drift, effective_band),
        )
        lines[asset_class] = Bound(
            value=line,
            source=SourceRef.derived(
                engine=ENGINE_NAME,
                inputs=(version_ref, *(allocated.input_refs if allocated else ())),
            ),
        )
    return DriftComputation(
        scope=allocation.scope, as_of=allocation.as_of, total_value=total, lines=lines
    )


def _unavailable_reason(allocation: AllocationBreakdown) -> SkipReason | None:
    if not allocation.is_complete:
        return SkipReason.MISSING_FACT
    if allocation.total_value.is_zero:
        return SkipReason.ZERO_PORTFOLIO_VALUE
    return None


def _weight(value: Decimal) -> Decimal:
    return quantize(value, precision=WEIGHT_PRECISION, scale=WEIGHT_SCALE)


def _severity(drift: Decimal, effective_band: Decimal) -> Decimal | None:
    """`|drift| / effective_band` — dimensionless, 1.0 exactly at the band (RFC-0007 §3.1).

    `None` when the band is zero, which a `RELATIVE` tolerance on a zero target produces:
    severity is then undefined rather than infinite, and `alert.severity` is nullable
    precisely for that case (ERR-1).
    """
    if effective_band == 0:
        return None
    return quantize(abs(drift) / effective_band, precision=SEVERITY_PRECISION, scale=SEVERITY_SCALE)
