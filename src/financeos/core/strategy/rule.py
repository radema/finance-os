"""`Rule` and `Condition` — declarative data, frozen inside a `StrategyVersion` (ADR-0027).

A `Condition` is a leaf of the closed typed catalog (ADR-0014), stored as `kind`,
`kind_version` and a flat mapping of canonical string params. Params are validated against
the catalog's Pydantic model at *authoring* time (the application layer, on freeze); the
engine parses them at evaluation time, so `core.strategy` never imports the engine registry
and the frozen document stays self-describing.

Combinators (`all_of`/`any_of`/`not`, depth 1 only) are out of skeleton scope (RFC-0006 §12).
"""

from collections.abc import Mapping
from datetime import timedelta

from pydantic import Field

from financeos.core.shared import DomainModel, Priority, RuleId, SuggestionClass


class LeafCondition(DomainModel):
    """A predicate drawn from the condition catalog.

    Attributes:
        kind: The catalog kind, e.g. ``"drift_outside_tolerance"``.
        kind_version: Recorded in every trace. A kind's semantics never change — a new
            meaning is a new kind (RFC-0006 §8).
        params: Canonical string form of the kind's params, e.g.
            ``{"asset_class": "EQUITY_DEVELOPED", "scope": "bucket:8f3a..."}``.
        max_staleness: Per-leaf override of the kind's declared default. `None` means the
            kind's default applies.
    """

    kind: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    kind_version: int = Field(ge=1)
    params: Mapping[str, str] = Field(default_factory=dict)
    max_staleness: timedelta | None = None


class Rule(DomainModel):
    """A child entity of `StrategyVersion`: condition, priority, message, suggestion class.

    `rule_id` is stable across versions, which is what makes "how has this rule's firing
    history evolved?" answerable; the definition is frozen per version (ADR-0027).
    """

    id: RuleId
    name: str = Field(min_length=1)
    enabled: bool = True
    priority: Priority
    suggestion_class: SuggestionClass
    message: str = Field(min_length=1)
    condition: LeafCondition
