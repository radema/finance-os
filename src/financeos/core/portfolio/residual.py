"""`ResidualComputation` — the `UNASSIGNED` pseudo-bucket, valued Portfolio-wide (ADR-0029).

`unassigned_residual_above` reads only `residual_weight` as a fact; the valuation itself is
the Portfolio Engine's job, so the Rule Engine still performs no financial computation of its
own (RFC-0006 §3.1).
"""

from datetime import date

from financeos.core.shared import DomainModel, Money, SkipReason, WeightAmount


class ResidualComputation(DomainModel):
    """The `UNASSIGNED` residual, folded across every `Bucket` of a `Portfolio` (ADR-0029).

    Attributes:
        total_value: The Portfolio's total valued holdings.
        unassigned_value: `total_value` minus every Bucket's apportioned share, signed — it
            may be negative when Σ apportioned exceeds a Holding (I-9, `over_apportioned`'s
            territory, RFC-0011 §12.4 item 3).
        residual_weight: `unassigned_value / total_value`, the fact `unassigned_residual_above`
            consumes. `None` when `unavailable` is set.
        unavailable: Why the residual could not be computed — an unpriced holding or a
            zero-value Portfolio (RFC-0007 §4.1's honesty argument applies here too).
    """

    as_of: date
    total_value: Money
    unassigned_value: Money
    residual_weight: WeightAmount | None = None
    unavailable: SkipReason | None = None
    input_refs: tuple[str, ...] = ()

    @property
    def is_available(self) -> bool:
        """Whether the residual fact could be computed at all."""
        return self.unavailable is None
