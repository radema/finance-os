"""`Drift` — the derived read model the Rule Engine consumes as a fact (RFC-0007 §4).

One `DriftLine` per targeted leaf carries every binding RFC-0007 §4 names, so the Rule Engine
performs no financial computation of its own (RFC-0006 §3.1) and `severity` arrives
pre-computed together with `effective_band`.
"""

from collections.abc import Mapping
from datetime import date

from financeos.core.shared import (
    AssetClass,
    Bound,
    DomainModel,
    Money,
    Scope,
    SeverityAmount,
    SkipReason,
    WeightAmount,
)
from financeos.core.strategy.targets import Tolerance


class DriftLine(DomainModel):
    """One targeted `AssetClass`'s position against its target.

    Attributes:
        current_weight: `value(class) / total_value(scope)`.
        effective_target: Product of the relative weights along the root→leaf path.
        drift: `current_weight − effective_target`. Negative means under target.
        drift_value: `drift × total_value` — the number a `Decision` actually acts on.
        effective_band: `band` for `ABSOLUTE`, `band × effective_target` for `RELATIVE`.
        severity: `|drift| / effective_band`, dimensionless: 1.0 is exactly at the band.
            `None` when the band is zero, in which case severity is undefined rather than
            infinite (ERR-1 permits a null `alert.severity`).
    """

    asset_class: AssetClass
    current_value: Money
    current_weight: WeightAmount
    effective_target: WeightAmount
    target_value: Money
    drift: WeightAmount
    drift_value: Money
    tolerance: Tolerance
    effective_band: WeightAmount
    severity: SeverityAmount | None = None


class DriftComputation(DomainModel):
    """The Strategy Engine's output for one scope.

    Either `lines` is populated, or `unavailable` says why drift could not be computed at
    all — a zero-value portfolio (a legitimate onboarding state) or an incomplete valuation.
    The reason travels to the Rule Engine so the resulting `Alert` reads `SKIPPED(<reason>)`
    rather than the inverted `NOT_FIRED` (ADR-0016).
    """

    scope: Scope
    as_of: date
    total_value: Money
    lines: Mapping[AssetClass, Bound[DriftLine]]
    unavailable: SkipReason | None = None

    @property
    def is_available(self) -> bool:
        """Whether drift facts could be computed for this scope."""
        return self.unavailable is None
