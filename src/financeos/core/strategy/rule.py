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

from pydantic import Field, model_validator

from financeos.core.shared import (
    BucketId,
    DomainModel,
    Priority,
    RuleId,
    Scope,
    ScopeKind,
    SuggestionClass,
)
from financeos.core.shared.errors import InvariantViolationError


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


class RuleScopeGate(DomainModel):
    """Which evaluation call(s) a `Rule` applies to (ADR-L06).

    Nothing about a `LeafCondition`'s own params says whether a Rule is meant to run once per
    governed Bucket, only at the whole-Portfolio call, or only for one named Bucket — `scope`
    on the three kinds that carry it is a message binding, never compared against the facts'
    actual scope (W2-rule-scope-partition.md §2). This is the field that carries that intent,
    read by the application layer (`evaluate_strategy`) to subset `sv.rules` before calling
    `RuleEngine.evaluate` — never by the engine itself (C2, RFC-0006 §3.1).

    Attributes:
        kind: `BUCKET` (the rule applies at Bucket-scope calls) or `PORTFOLIO` (only at the
            Portfolio-scope call).
        bucket_id: Only meaningful when `kind` is `BUCKET`. `None` means "any governed Bucket"
            — the generic case, evaluated once per Bucket call. Set, it narrows the rule to
            that one named Bucket's call only.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    kind: ScopeKind
    bucket_id: BucketId | None = None

    @model_validator(mode="after")
    def _bucket_id_only_with_bucket_kind(self) -> "RuleScopeGate":
        if self.kind is ScopeKind.PORTFOLIO and self.bucket_id is not None:
            raise InvariantViolationError(
                "RuleScopeGate: bucket_id is only meaningful when kind is BUCKET"
            )
        return self

    def applies_to(self, scope: Scope) -> bool:
        """Whether a Rule gated this way should evaluate in `scope`'s call."""
        if self.kind is not scope.kind:
            return False
        return (
            self.kind is ScopeKind.PORTFOLIO
            or self.bucket_id is None
            or self.bucket_id == BucketId(scope.id)
        )


class Rule(DomainModel):
    """A child entity of `StrategyVersion`: condition, priority, message, suggestion class.

    `rule_id` is stable across versions, which is what makes "how has this rule's firing
    history evolved?" answerable; the definition is frozen per version (ADR-0027).

    Attributes:
        scope_gate: `None` means unconstrained — the rule evaluates in whichever scope call
            the application service passes it (ADR-L06 §4.1's compatibility default; today's
            implicit behaviour, unchanged for every rule that does not declare one). A
            declared gate narrows that per `RuleScopeGate.applies_to`.
    """

    id: RuleId
    name: str = Field(min_length=1)
    enabled: bool = True
    priority: Priority
    suggestion_class: SuggestionClass
    message: str = Field(min_length=1)
    condition: LeafCondition
    scope_gate: RuleScopeGate | None = None
