"""Enumerations of the shared kernel.

Each of these crosses a bounded-context boundary — `Priority` is authored on a `Rule`
(Strategy) and promoted to a column on `Alert` (Decision); `Outcome` and `SkipReason` are
produced by the Rule Engine, carried in the trace and consumed by the run health surface.
Contract C3 forbids context-to-context imports, so they live in the shared kernel.
"""

from enum import StrEnum
from typing import Final


class ScopeKind(StrEnum):
    """What an evaluation is scoped to (ERR-2)."""

    PORTFOLIO = "PORTFOLIO"
    BUCKET = "BUCKET"


class Priority(StrEnum):
    """Author-declared importance of a `Rule`. Never overridden by computation (RFC-0008 §3)."""

    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


_PRIORITY_RANK: Final[dict[Priority, int]] = {
    Priority.CRITICAL: 4,
    Priority.HIGH: 3,
    Priority.MEDIUM: 2,
    Priority.LOW: 1,
    Priority.INFO: 0,
}


def priority_rank(priority: Priority) -> int:
    """Ordinal rank of a `Priority`, higher meaning more important (RFC-0008 §3)."""
    return _PRIORITY_RANK[priority]


class SuggestionClass(StrEnum):
    """A category of deliberation — never a transaction (E7, ratified; I-12).

    No member can carry an instrument, a direction or a size, which is what makes a
    prescriptive `Recommendation` unrepresentable rather than merely discouraged.
    """

    REVIEW_ALLOCATION = "REVIEW_ALLOCATION"
    CONSIDER_REBALANCE = "CONSIDER_REBALANCE"
    REVIEW_BUCKET_ASSIGNMENT = "REVIEW_BUCKET_ASSIGNMENT"
    REVIEW_STRATEGY = "REVIEW_STRATEGY"
    REVIEW_LIQUIDITY = "REVIEW_LIQUIDITY"
    NO_ACTION = "NO_ACTION"


class Outcome(StrEnum):
    """The four outcomes of evaluating one `Rule` (ADR-0016).

    `SKIPPED` must never read as `NOT_FIRED`: a rule that could not be evaluated is not a
    rule that found nothing. Conflating them reports compliance exactly when the system
    knows least about the portfolio.
    """

    FIRED = "FIRED"
    NOT_FIRED = "NOT_FIRED"
    SKIPPED = "SKIPPED"
    ERROR = "ERROR"


class SkipReason(StrEnum):
    """Why a `Rule` could not be evaluated (RFC-0006 §5, RFC-0007 §4.1)."""

    DISABLED = "disabled"
    MISSING_FACT = "missing_fact"
    STALE_FACT = "stale_fact"
    ZERO_DENOMINATOR = "zero_denominator"
    ZERO_PORTFOLIO_VALUE = "zero_portfolio_value"


class RunMode(StrEnum):
    """Whether an `EvaluationRun` evaluated reality or a scenario (RFC-0009 §3.2)."""

    ACTUAL = "ACTUAL"
    HYPOTHETICAL = "HYPOTHETICAL"
