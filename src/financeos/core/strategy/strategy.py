"""`Strategy` and `StrategyVersion` — the P7 anchor (RFC-0004 §2.2, E2; RFC-0007 §7).

`StrategyVersion` is immutable and written on every change to the Strategy aggregate —
targets, tolerances, rules, horizon, risk, principles, objective, name or description, with
no materiality judgment (RFC-0007 §7, as restated by ADR-0030, which puts `Goal` links
outside the freeze boundary). `Strategy` rows therefore carry identity and name only; every
frozen copy lives in `StrategyVersion.definition` (ERR-8, ADR-0027).
"""

from datetime import date
from enum import StrEnum

from pydantic import Field, model_validator

from financeos.core.shared import (
    DomainModel,
    Instant,
    RuleId,
    StrategyId,
    StrategyVersionId,
)
from financeos.core.shared.errors import InvariantViolationError, RuleNotInVersionError
from financeos.core.strategy.rule import Rule
from financeos.core.strategy.targets import TargetAllocation


class Horizon(DomainModel):
    """A Strategy's time horizon: a number of years, or a target date. Exactly one."""

    years: int | None = Field(default=None, ge=1)
    target_date: date | None = None

    @model_validator(mode="after")
    def _exactly_one_form(self) -> "Horizon":
        if (self.years is None) == (self.target_date is None):
            raise InvariantViolationError("a Horizon carries either years or a target_date")
        return self


class RiskLevel(StrEnum):
    """Ordinal risk appetite (RFC-0004 §2.1: an ordinal enum plus free-text principles)."""

    CONSERVATIVE = "CONSERVATIVE"
    MODERATE = "MODERATE"
    BALANCED = "BALANCED"
    GROWTH = "GROWTH"
    AGGRESSIVE = "AGGRESSIVE"


class RiskProfile(DomainModel):
    """The `principi` attribute of a Strategy: a level plus the principles declared with it."""

    level: RiskLevel
    principles: tuple[str, ...] = ()


class StrategyDefinition(DomainModel):
    """The frozen document: everything an evaluation is allowed to cite (ADR-0023).

    This is the sole input to a `Recommendation`'s assembled `rationale`, which is what makes
    Manifest P3 literal: the system restates the user's own prior declaration and reports
    arithmetic against it.
    """

    name: str = Field(min_length=1)
    description: str | None = None
    objective: str | None = None
    horizon: Horizon
    risk: RiskProfile
    targets: TargetAllocation
    rules: tuple[Rule, ...]

    @model_validator(mode="after")
    def _at_least_one_rule(self) -> "StrategyDefinition":
        if not self.rules:
            raise InvariantViolationError("I-4: a Strategy contains at least one Rule")
        if len({rule.id for rule in self.rules}) != len(self.rules):
            raise InvariantViolationError("rule ids must be distinct within a version")
        return self

    def rule(self, rule_id: RuleId) -> Rule:
        """Resolve a `rule_id` against this frozen definition.

        Raises:
            RuleNotInVersionError: If the id is absent. `alert.rule_id` carries no foreign
                key (ADR-0027), so this boundary check is the integrity guarantee.
        """
        for rule in self.rules:
            if rule.id == rule_id:
                return rule
        raise RuleNotInVersionError(f"rule {rule_id} is not part of this StrategyVersion")


class StrategyVersion(DomainModel):
    """Aggregate root, immutable: one frozen definition of a Strategy.

    Attributes:
        parent_version_id: Lineage, so the history of the author's thinking is walkable.
        change_note: Required on freeze — the only place the *why* of a change lives, and
            unrecoverable later (RFC-0007 §7).
    """

    id: StrategyVersionId
    strategy_id: StrategyId
    parent_version_id: StrategyVersionId | None = None
    definition: StrategyDefinition
    change_note: str = Field(min_length=1)
    frozen_at: Instant

    @property
    def targets(self) -> TargetAllocation:
        """The frozen target tree."""
        return self.definition.targets

    @property
    def rules(self) -> tuple[Rule, ...]:
        """The frozen rule set."""
        return self.definition.rules

    def rule(self, rule_id: RuleId) -> Rule:
        """Resolve a `rule_id` against this version (ADR-0027)."""
        return self.definition.rule(rule_id)


class Strategy(DomainModel):
    """Aggregate root: identity, name, and a pointer to the current frozen version."""

    id: StrategyId
    name: str = Field(min_length=1)
    description: str | None = None
    current_version_id: StrategyVersionId | None = None
