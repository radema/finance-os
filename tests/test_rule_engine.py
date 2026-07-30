"""Rule Engine: the four outcomes, the step algebra, and deterministic order (RFC-0006)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from financeos.core.decision import ConditionRef, StepOp
from financeos.core.engines.rule_engine import (
    FactSet,
    TraceRecorder,
    apply_op,
    evaluate,
    resolve,
)
from financeos.core.engines.strategy_engine import compute_drift
from financeos.core.shared import (
    Bound,
    Outcome,
    Priority,
    SkipReason,
    SourceRef,
    priority_rank,
)
from financeos.core.shared.errors import ReplayMismatchError
from financeos.core.strategy import DriftLine, LeafCondition, Rule
from tests import factories as f
from tests.test_strategy_engine import allocation_of


def facts_for(*positions: tuple[object, str], **overrides: object) -> FactSet:
    """A `FactSet` whose drift facts come from a real Strategy Engine computation."""
    computation = compute_drift(
        allocation_of(*positions),  # type: ignore[arg-type]
        f.DEMO_TARGETS,
        strategy_version_id=f.VERSION,
    )
    payload: dict[str, object] = {
        "as_of": f.AS_OF,
        "scope": f.BUCKET_SCOPE,
        "drift": computation.lines,
    }
    payload.update(overrides)
    return FactSet.model_validate(payload)


BREACHED = ((f.EQUITY, "34"), (f.BOND, "66"))
WITHIN = ((f.EQUITY, "39"), (f.BOND, "61"))


class TestOutcomes:
    def test_a_breach_fires_and_carries_severity(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        assert firing.outcome is Outcome.FIRED
        assert firing.severity == Decimal("3.00000000")
        assert firing.skip_reason is None

    def test_within_the_band_does_not_fire_but_is_still_recorded(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*WITHIN))
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.trace.steps
        assert firing.severity == Decimal("0.50000000")

    def test_exactly_at_the_band_does_not_fire(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for((f.EQUITY, "38"), (f.BOND, "62")))
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("1.00000000")

    def test_a_disabled_rule_is_skipped_never_not_fired(self) -> None:
        (firing,) = evaluate((f.drift_rule(1, enabled=False),), facts_for(*BREACHED))
        assert firing.outcome is Outcome.SKIPPED
        assert firing.skip_reason is SkipReason.DISABLED
        assert firing.trace.steps == ()

    def test_an_untargeted_class_is_skipped_with_missing_fact(self) -> None:
        rule = f.drift_rule(1, asset_class="EQUITY_EMERGING")
        (firing,) = evaluate((rule,), facts_for(*BREACHED))
        assert firing.outcome is Outcome.SKIPPED
        assert firing.skip_reason is SkipReason.MISSING_FACT
        assert firing.trace.unavailable_facts[0].name == "drift:EQUITY_EMERGING"
        assert firing.trace.unavailable_facts[0].reason is SkipReason.MISSING_FACT

    def test_a_zero_value_scope_is_skipped_with_its_own_reason(self) -> None:
        computation = compute_drift(allocation_of(), f.DEMO_TARGETS, strategy_version_id=f.VERSION)
        facts = FactSet(
            as_of=f.AS_OF,
            scope=f.BUCKET_SCOPE,
            drift={},
            unavailable={"drift": computation.unavailable} if computation.unavailable else {},
        )
        (firing,) = evaluate((f.drift_rule(1),), facts)
        assert firing.outcome is Outcome.SKIPPED
        assert firing.skip_reason is SkipReason.ZERO_PORTFOLIO_VALUE

    def test_a_stale_fact_is_skipped_and_the_trace_records_the_age(self) -> None:
        computation = compute_drift(
            allocation_of(*BREACHED), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        aged = {
            asset_class: bound.model_copy(update={"observed_at": datetime(2026, 1, 1, tzinfo=UTC)})
            for asset_class, bound in computation.lines.items()
        }
        facts = FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, drift=aged)
        (firing,) = evaluate((f.drift_rule(1),), facts)
        assert firing.outcome is Outcome.SKIPPED
        assert firing.skip_reason is SkipReason.STALE_FACT
        note = firing.trace.stale_facts[0]
        assert note.age_days == 70
        assert note.max_staleness_days == 7

    def test_a_fresh_enough_fact_is_evaluated(self) -> None:
        computation = compute_drift(
            allocation_of(*BREACHED), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        fresh = {
            asset_class: bound.model_copy(update={"observed_at": datetime(2026, 3, 10, tzinfo=UTC)})
            for asset_class, bound in computation.lines.items()
        }
        (firing,) = evaluate(
            (f.drift_rule(1),), FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, drift=fresh)
        )
        assert firing.outcome is Outcome.FIRED

    def test_a_per_leaf_max_staleness_overrides_the_kind_default(self) -> None:
        computation = compute_drift(
            allocation_of(*BREACHED), f.DEMO_TARGETS, strategy_version_id=f.VERSION
        )
        four_days_old = {
            asset_class: bound.model_copy(update={"observed_at": datetime(2026, 3, 8, tzinfo=UTC)})
            for asset_class, bound in computation.lines.items()
        }
        facts = FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, drift=four_days_old)
        strict = f.drift_rule(1).model_copy(
            update={
                "condition": LeafCondition(
                    kind="drift_outside_tolerance",
                    kind_version=1,
                    params={"asset_class": "EQUITY_DEVELOPED", "scope": f.BUCKET_SCOPE.ref},
                    max_staleness=timedelta(days=2),
                )
            }
        )
        assert evaluate((strict,), facts)[0].skip_reason is SkipReason.STALE_FACT
        assert evaluate((f.drift_rule(1),), facts)[0].outcome is Outcome.FIRED

    def test_an_unknown_kind_errors_without_aborting_the_run(self) -> None:
        unknown = Rule(
            id=f.rule_id(2),
            name="Regola futura",
            priority=Priority.LOW,
            suggestion_class=f.drift_rule().suggestion_class,
            message="nulla",
            condition=LeafCondition(kind="not_yet_built", kind_version=1),
        )
        firings = evaluate((f.drift_rule(1), unknown), facts_for(*BREACHED))
        outcomes = {firing.rule_id: firing.outcome for firing in firings}
        assert outcomes[f.rule_id(1)] is Outcome.FIRED
        assert outcomes[f.rule_id(2)] is Outcome.ERROR
        errored = next(firing for firing in firings if firing.outcome is Outcome.ERROR)
        assert "not_yet_built" in (errored.error or "")

    def test_invalid_params_error_rather_than_silently_not_firing(self) -> None:
        broken = f.drift_rule(1).model_copy(
            update={
                "condition": LeafCondition(
                    kind="drift_outside_tolerance", kind_version=1, params={"asset_class": "EQ"}
                )
            }
        )
        (firing,) = evaluate((broken,), facts_for(*BREACHED))
        assert firing.outcome is Outcome.ERROR
        assert "invalid params" in (firing.error or "")

    def test_an_evaluator_defect_is_recorded_as_error_with_a_trace(self) -> None:
        from financeos.core.engines import rule_engine

        def explode(params: object, facts: FactSet, recorder: TraceRecorder) -> None:
            raise ZeroDivisionError("boom")

        registry = rule_engine.ConditionRegistry()
        registry.register(
            rule_engine.ConditionKindSpec(
                kind="always_explodes",
                kind_version=1,
                params_model=rule_engine.DriftOutsideToleranceParams,
                required_facts=frozenset({"drift"}),
                default_max_staleness=None,
                severity=rule_engine.SeverityDeclaration(formula=None),
                explanation_template="esplode",
                numeric_bindings=frozenset(),
                evaluate=explode,  # type: ignore[arg-type]
            )
        )
        rule = f.drift_rule(1).model_copy(
            update={
                "condition": LeafCondition(
                    kind="always_explodes",
                    kind_version=1,
                    params={"asset_class": "EQUITY_DEVELOPED", "scope": f.BUCKET_SCOPE.ref},
                )
            }
        )
        (firing,) = evaluate((rule,), facts_for(*BREACHED), registry=registry)
        assert firing.outcome is Outcome.ERROR
        assert firing.error == "ZeroDivisionError: boom"
        assert firing.trace.error == "ZeroDivisionError: boom"

    def test_every_outcome_carries_a_trace_of_its_own_condition(self) -> None:
        rules = (
            f.drift_rule(1),
            f.drift_rule(2, asset_class="EQUITY_EMERGING"),
            f.drift_rule(3, enabled=False),
        )
        for firing in evaluate(rules, facts_for(*BREACHED)):
            assert firing.trace.condition.kind == "drift_outside_tolerance"
            assert firing.trace.outcome is firing.outcome


class TestOrdering:
    def test_rules_are_evaluated_by_priority_then_id(self) -> None:
        rules = (
            f.drift_rule(3, priority=Priority.LOW),
            f.drift_rule(1, priority=Priority.CRITICAL),
            f.drift_rule(2, priority=Priority.CRITICAL),
        )
        firings = evaluate(rules, facts_for(*BREACHED))
        assert [firing.rule_id for firing in firings] == [
            f.rule_id(1),
            f.rule_id(2),
            f.rule_id(3),
        ]
        assert priority_rank(Priority.CRITICAL) > priority_rank(Priority.LOW)

    def test_evaluation_is_byte_reproducible(self) -> None:
        rules = (f.drift_rule(1), f.drift_rule(2, asset_class="BONDS_GOV_EUR"))
        first = evaluate(rules, facts_for(*BREACHED))
        second = evaluate(rules, facts_for(*BREACHED))
        assert [firing.model_dump_json() for firing in first] == [
            firing.model_dump_json() for firing in second
        ]


class TestTraceShape:
    def test_the_trace_records_the_bindings_and_the_drift_computation(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        trace = firing.trace
        assert [binding.name for binding in trace.bindings] == [
            "current_weight",
            "effective_target",
            "tolerance",
            "effective_band",
            "severity",
        ]
        assert [(step.op, step.out, step.value) for step in trace.steps] == [
            (StepOp.SUBTRACT, "drift", "-0.06000000"),
            (StepOp.ABS_GT, "breached", True),
        ]

    def test_every_binding_carries_a_resolvable_source(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        for binding in firing.trace.bindings:
            assert binding.source.kind == "derived"
            assert binding.source.path == binding.name
            assert any(ref.startswith("sv:") for ref in binding.source.inputs)

    def test_message_bindings_are_captured_for_later_rendering(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        bindings = firing.trace.message_bindings
        assert bindings["asset_class_label"] == "Equity/Developed"
        assert bindings["current_pct"] == "34.00"
        assert bindings["target_pct"] == "40.00"
        assert bindings["drift_pct"] == "-6.00"
        assert bindings["tolerance_pct"] == "2.00"
        assert bindings["drift_value"] == "-600.0000"

    def test_a_caller_supplied_label_is_used(self) -> None:
        facts = facts_for(*BREACHED, labels={"EQUITY_DEVELOPED": "Azioni/Sviluppati"})
        (firing,) = evaluate((f.drift_rule(1),), facts)
        assert firing.trace.message_bindings["asset_class_label"] == "Azioni/Sviluppati"

    def test_the_condition_reference_pins_the_kind_version(self) -> None:
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        assert firing.trace.condition.kind_version == 1
        assert firing.trace.condition.params["asset_class"] == "EQUITY_DEVELOPED"


class TestStepAlgebra:
    def test_a_zero_denominator_skips_instead_of_raising(self) -> None:
        recorder = TraceRecorder(condition=ConditionRef(kind="k", kind_version=1), as_of=f.AS_OF)
        source = SourceRef.derived(engine="test")
        recorder.bind("numerator", Decimal(1), source=source)
        recorder.bind("denominator", Decimal(0), source=source)
        with pytest.raises(Exception) as caught:  # noqa: PT011 - control-flow signal
            recorder.divide_safe("ratio", "numerator", "denominator")
        assert getattr(caught.value, "reason", None) is SkipReason.ZERO_DENOMINATOR
        trace = recorder.trace(Outcome.SKIPPED, skip_reason=SkipReason.ZERO_DENOMINATOR)
        assert trace.steps[0].value is None

    def test_every_declared_operation_is_implemented(self) -> None:
        one, two = "1", "2"
        assert apply_op(StepOp.SUBTRACT, [two, one]) == "1"
        assert apply_op(StepOp.ADD, [one, two]) == "3"
        assert apply_op(StepOp.MULTIPLY, [two, two]) == "4"
        assert apply_op(StepOp.ABS, ["-2"]) == "2"
        assert apply_op(StepOp.DIVIDE_SAFE, [one, two]) == "0.5"
        assert apply_op(StepOp.RATIO_TO, [one, two]) == "0.5"
        assert apply_op(StepOp.DIVIDE_SAFE, [one, "0"]) is None
        assert apply_op(StepOp.GT, [two, one]) is True
        assert apply_op(StepOp.GTE, [two, two]) is True
        assert apply_op(StepOp.LT, [one, two]) is True
        assert apply_op(StepOp.LTE, [two, two]) is True
        assert apply_op(StepOp.EQ, [two, two]) is True
        assert apply_op(StepOp.ABS_GT, ["-3", two]) is True
        assert apply_op(StepOp.ALL, [True, False]) is False
        assert apply_op(StepOp.ANY, [True, False]) is True
        assert apply_op(StepOp.NOT, [False]) is True

    def test_a_dotted_name_addresses_a_structured_binding(self) -> None:
        environment = {"tolerance": {"kind": "ABSOLUTE", "band": "0.02000000"}}
        assert resolve(environment, "tolerance.band") == "0.02000000"

    def test_an_unbound_name_is_a_broken_trace(self) -> None:
        with pytest.raises(ReplayMismatchError):
            resolve({}, "missing")

    def test_operands_must_be_of_the_expected_kind(self) -> None:
        with pytest.raises(ReplayMismatchError):
            apply_op(StepOp.SUBTRACT, [True, "1"])
        with pytest.raises(ReplayMismatchError):
            apply_op(StepOp.NOT, ["1"])

    def test_the_recorder_returns_exactly_what_it_recorded(self) -> None:
        """An evaluator can never compute on more precision than the trace carries."""
        recorder = TraceRecorder(condition=ConditionRef(kind="k", kind_version=1), as_of=f.AS_OF)
        source = SourceRef.derived(engine="test")
        recorded = recorder.bind("value", Decimal("1.100"), source=source)
        assert recorded == "1.100"


class TestFactSet:
    def test_a_missing_class_has_no_fact(self) -> None:
        facts = facts_for(*BREACHED)
        assert facts.drift_for("EQUITY_EMERGING") is None
        assert facts.unavailable_reason("drift") is None

    def test_the_default_label_is_derived_from_the_code(self) -> None:
        assert facts_for(*BREACHED).label_for("EQUITY_DEVELOPED") == "Equity/Developed"

    def test_facts_are_bound_values_with_provenance(self) -> None:
        fact = facts_for(*BREACHED).drift_for("EQUITY_DEVELOPED")
        assert isinstance(fact, Bound)
        assert isinstance(fact.value, DriftLine)
        assert fact.source.inputs
