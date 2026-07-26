"""`RuleFiring` — the Strategy → Decision contract (RFC-0004 §4.1).

Owned by the consuming context: Strategy evaluates rules and hands over outcomes plus their
traces; it never constructs a `Recommendation`.
"""

from financeos.core.decision.trace import EvaluationTrace
from financeos.core.shared import DomainModel, Outcome, Priority, RuleId, SeverityAmount, SkipReason


class RuleFiring(DomainModel):
    """The result of evaluating one `Rule`, whatever the outcome (E5).

    All four outcomes travel: `SKIPPED` and `ERROR` are as much a part of the audit record as
    a firing, and treating an unevaluable rule as `NOT_FIRED` would report compliance exactly
    when the system knows least (ADR-0016).

    Attributes:
        severity: The dimensionless breach ratio, or `None` for kinds declaring no formula
            and for outcomes that never carry one (ERR-1).
        error: The exception message for an `ERROR` outcome. The run continues.
    """

    rule_id: RuleId
    priority: Priority
    outcome: Outcome
    skip_reason: SkipReason | None = None
    severity: SeverityAmount | None = None
    error: str | None = None
    trace: EvaluationTrace
