"""The immutable artifacts of the Decision context: `EvaluationRun`, `Alert`, `Recommendation`.

Every one of them is an audit artifact, so the whole context has no mutable link:

* `EvaluationRun` (E4) groups the Alerts of one evaluation and pins the frozen
  `StrategyVersion` — one join away from every Alert, so the I-11 pin can never dangle
  (ERR-6).
* `Alert` is a *rule evaluation record* (E5, ratified): all four outcomes are persisted,
  because "nothing fired" is as much an explanation as a firing. Only `FIRED` reaches the
  recommendations list; `SKIPPED`/`ERROR` reach the run health panel.
* `Recommendation` is 1:1 with a `FIRED` Alert and never prescriptive. **I-12 is structural:
  there is no instrument, action, direction or quantity field to populate**, which is also
  the MiFID suitability firewall expressed as a schema rather than as a policy.
"""

from collections.abc import Mapping
from datetime import date

from pydantic import Field, model_validator

from financeos.core.decision.trace import EvaluationTrace
from financeos.core.shared import (
    AlertId,
    DomainModel,
    EvaluationRunId,
    Instant,
    Outcome,
    PortfolioId,
    Priority,
    RecommendationId,
    RuleId,
    RunMode,
    Scope,
    SeverityAmount,
    StrategyId,
    StrategyVersionId,
    SuggestionClass,
)
from financeos.core.shared.errors import InvariantViolationError


class EvaluationRun(DomainModel):
    """One evaluation of one scope against one frozen `StrategyVersion` (E4, ERR-2).

    Attributes:
        scope: What was evaluated — a `Bucket` normally (ADR-0020).
        as_of: The domain date evaluated against.
        evaluated_at: Wall clock, supplied by the application's `Clock` port.
        mode: `HYPOTHETICAL` runs persist Alerts and traces but produce no Recommendations
            (RFC-0008 §8), so a speculative firing cannot leak into the findings list.
        input_digest: SHA-256 over the canonical bound inputs — answers "would this evaluate
            identically today?" without recomputing anything.
    """

    id: EvaluationRunId
    portfolio_id: PortfolioId
    strategy_id: StrategyId
    strategy_version_id: StrategyVersionId
    scope: Scope
    as_of: date
    evaluated_at: Instant
    mode: RunMode
    engine_versions: Mapping[str, str]
    input_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class Alert(DomainModel):
    """One rule evaluation record, immutable, carrying its trace (I-6, I-11).

    Attributes:
        rule_id: A logical identifier with no foreign key (ADR-0027). It is resolved through
            `run_id → strategy_version.definition.rules`, and the Decision Engine rejects a
            firing whose rule is absent from the pinned version.
        severity: `None` for kinds declaring no severity formula and for `SKIPPED`/`ERROR`
            outcomes (ERR-1).
    """

    id: AlertId
    run_id: EvaluationRunId
    rule_id: RuleId
    outcome: Outcome
    priority: Priority
    severity: SeverityAmount | None = None
    trace: EvaluationTrace
    recorded_at: Instant

    @model_validator(mode="after")
    def _is_explainable(self) -> "Alert":
        if self.trace.outcome is not self.outcome:
            raise InvariantViolationError(
                f"trace records {self.trace.outcome} but the Alert claims {self.outcome}"
            )
        if self.outcome in (Outcome.FIRED, Outcome.NOT_FIRED) and not (
            self.trace.bindings and self.trace.steps
        ):
            raise InvariantViolationError("I-6: an evaluated Alert requires a bound, stepped trace")
        if self.severity is not None and self.outcome in (Outcome.SKIPPED, Outcome.ERROR):
            raise InvariantViolationError("ERR-1: severity is NULL for SKIPPED and ERROR")
        return self


class Provenance(DomainModel):
    """The P7 carrier: what a `Recommendation` was produced from (RFC-0004 §2.1).

    `rule_id` and `run_id` are non-nullable, so no construction path exists for a
    Recommendation that does not derive from a Rule (I-5).
    """

    run_id: EvaluationRunId
    strategy_id: StrategyId
    strategy_version_id: StrategyVersionId
    rule_id: RuleId
    input_refs: tuple[str, ...] = ()
    evaluated_at: Instant


class Recommendation(DomainModel):
    """A motivated, never prescriptive finding (I-12, I-17; RFC-0008 §5).

    Attributes:
        observation: What is true, rendered from the trace's `message_bindings`.
        rationale: Why it matters, assembled from the frozen `StrategyVersion` (ADR-0023) —
            the system restates the user's own declaration and never asserts suitability.
        suggestion_class: A category of deliberation, from a closed enum (E7).
        finding_key: `sha256(rule_id ‖ scope_id ‖ canonical(condition.params))`, deliberately
            excluding `strategy_version_id` so editing an unrelated rule does not reset a
            finding's history (RFC-0008 §4).
    """

    id: RecommendationId
    alert_id: AlertId
    provenance: Provenance
    finding_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    observation: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    suggestion_class: SuggestionClass
    recorded_at: Instant
