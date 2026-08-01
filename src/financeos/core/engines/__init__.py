"""The engines: pure functions `(inputs) -> outputs`, with no repository injected (I-7).

No engine writes to storage and no engine calls another engine — the application service is
the composition point (RFC-0005 §3). Contract C2 fails the build if `financeos.ports` is ever
imported from here, which is what makes I-7 structural rather than aspirational.
"""

from financeos.core.engines.decision_engine import MaterializationResult, materialize
from financeos.core.engines.portfolio_engine import (
    compute_allocation,
    compute_apportionment,
    compute_holdings,
    compute_residual,
)
from financeos.core.engines.rule_engine import (
    REGISTRY,
    ConditionKindSpec,
    ConditionRegistry,
    ConditionResult,
    FactSet,
    ReplayResult,
    SeverityDeclaration,
    TraceRecorder,
    evaluate,
    replay_trace,
)
from financeos.core.engines.strategy_engine import compute_drift, compute_targets

__all__ = [
    "REGISTRY",
    "ConditionKindSpec",
    "ConditionRegistry",
    "ConditionResult",
    "FactSet",
    "MaterializationResult",
    "ReplayResult",
    "SeverityDeclaration",
    "TraceRecorder",
    "compute_allocation",
    "compute_apportionment",
    "compute_drift",
    "compute_holdings",
    "compute_residual",
    "compute_targets",
    "evaluate",
    "materialize",
    "replay_trace",
]
