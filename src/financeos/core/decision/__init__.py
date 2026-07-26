"""Decision bounded context (E1, ratified).

`Alert`, `Recommendation`, `EvaluationRun`, `Provenance` and the `EvaluationTrace` schema.
No context depends on this one: the dependency edges are inbound only, which is what makes
the Recommendation pipeline testable in isolation (RFC-0004 §4).
"""

from financeos.core.decision.artifacts import (
    Alert,
    EvaluationRun,
    Provenance,
    Recommendation,
)
from financeos.core.decision.firing import RuleFiring
from financeos.core.decision.trace import (
    TRACE_VERSION,
    Binding,
    ConditionRef,
    EvaluationTrace,
    FactUnavailable,
    StaleFactNote,
    Step,
    StepOp,
    TraceValue,
)

__all__ = [
    "TRACE_VERSION",
    "Alert",
    "Binding",
    "ConditionRef",
    "EvaluationRun",
    "EvaluationTrace",
    "FactUnavailable",
    "Provenance",
    "Recommendation",
    "RuleFiring",
    "StaleFactNote",
    "Step",
    "StepOp",
    "TraceValue",
]
