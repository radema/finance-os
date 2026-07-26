"""The base model every value object and aggregate in the core derives from (ADR-0006)."""

from pydantic import BaseModel, ConfigDict


class DomainModel(BaseModel):
    """Frozen, strict-shaped Pydantic model.

    Immutability is the default posture of the domain core: value objects are compared by
    value and aggregates are either immutable by decree (`Operation`, `StrategyVersion`,
    `Alert`, `Recommendation`, `EvaluationRun`) or thin enough that in-place mutation buys
    nothing. `extra="forbid"` makes an unrecognised field a construction failure rather
    than a silently ignored one.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")
