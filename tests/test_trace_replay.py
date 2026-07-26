"""THE replay property test (RFC-0005 §8 task 8, RFC-0009 §4.1, RFC-0010 §6.2).

The contract:

> Given `condition` plus the `value` of every binding, and **ignoring all `source` fields**,
> re-executing `steps` must reproduce `outcome` exactly.

This is the project's non-negotiable check. If it cannot be maintained, P3 is false and the
product's core promise is gone — so this file is written to *fail* when the mechanism weakens,
not to decorate it. It therefore does four things:

1. Generates whole evaluations with Hypothesis — random target trees, allocations, tolerance
   kinds, priorities, missing prices, absent classes, stale facts, empty portfolios, unknown
   kinds — and asserts every resulting trace replays to its recorded outcome.
2. **Blinds every source** before replaying: each `SourceRef` is overwritten with a poison
   value and every `observed_at` is dropped, so a replay that secretly depended on provenance
   or on wall-clock data fails here.
3. Proves the test has teeth: tampering with a recorded step value, or removing a binding a
   step consumes, must raise rather than pass quietly.
4. Exercises the whole step algebra with generated programs, so the ops the skeleton's single
   kind does not use are replay-safe before a V1.0 kind reaches for them.
"""

from decimal import Decimal
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from financeos.core.decision import (
    Binding,
    ConditionRef,
    EvaluationTrace,
    RuleFiring,
    Step,
    StepOp,
)
from financeos.core.engines.portfolio_engine import compute_allocation
from financeos.core.engines.rule_engine import (
    ConditionKindSpec,
    ConditionRegistry,
    ConditionResult,
    DriftOutsideToleranceParams,
    FactSet,
    SeverityDeclaration,
    SkipSignal,
    TraceRecorder,
    evaluate,
    replay_trace,
)
from financeos.core.engines.strategy_engine import compute_drift
from financeos.core.portfolio import Holding
from financeos.core.shared import (
    AssetId,
    Outcome,
    Priority,
    SkipReason,
    SourceRef,
    canonical_json,
)
from financeos.core.shared.errors import ReplayMismatchError
from financeos.core.strategy import LeafCondition, Rule, TargetAllocation, TargetNode
from tests import factories as f

#: A source that resolves to nothing. Replay must not read any of this.
POISON = SourceRef(
    kind="poison", ref="poison:0", engine="poison", path="poison", inputs=("poison:0",)
)

CLASSES = ("EQUITY_DEVELOPED", "BONDS_GOV_EUR", "CASH_EUR")
BANDS = ("0.01", "0.02", "0.05", "0.25")
PRIORITIES = tuple(Priority)


def blind(trace: EvaluationTrace) -> EvaluationTrace:
    """Strip every trace of provenance: same values, no resolvable source, no timestamps."""
    return trace.model_copy(
        update={
            "bindings": tuple(
                Binding(name=binding.name, value=binding.value, source=POISON)
                for binding in trace.bindings
            )
        }
    )


def replay_of(firing: RuleFiring) -> tuple[Outcome, SkipReason | None] | None:
    """Replay a firing's trace with every source blinded."""
    result = replay_trace(blind(firing.trace))
    return None if result is None else (result.outcome, result.skip_reason)


# --------------------------------------------------------------------------------------
# Generated evaluations
# --------------------------------------------------------------------------------------


@st.composite
def target_trees(draw: st.DrawFn) -> TargetAllocation:
    """A depth-1 or depth-2 tree whose children sum to exactly 1 (I-13)."""
    count = draw(st.integers(min_value=1, max_value=len(CLASSES)))
    cuts = sorted(draw(st.lists(st.integers(0, 100), min_size=count - 1, max_size=count - 1)))
    edges = [0, *cuts, 100]
    parts = [Decimal(edges[i + 1] - edges[i]) / Decimal(100) for i in range(count)]
    nodes = [
        TargetNode(
            key=CLASSES[index],
            weight=f.weight(str(part)),
            tolerance=(
                f.absolute(draw(st.sampled_from(BANDS)))
                if draw(st.booleans())
                else f.relative(draw(st.sampled_from(BANDS)))
            ),
        )
        for index, part in enumerate(parts)
    ]
    if len(nodes) > 1 and draw(st.booleans()):
        # Wrap the tail in an interior node, renormalizing its children to sum to 1.
        head, *tail = nodes
        share = sum(node.weight.value for node in tail)
        if share > 0:
            rescaled = tuple(
                node.model_copy(update={"weight": f.weight(str(node.weight.value / share))})
                for node in tail
            )
            if abs(sum(node.weight.value for node in rescaled) - Decimal(1)) <= Decimal(
                "0.00000001"
            ):
                return TargetAllocation(
                    children=(
                        head.model_copy(update={"weight": f.weight(str(Decimal(1) - share))}),
                        TargetNode(key="GROUPED", weight=f.weight(str(share)), children=rescaled),
                    )
                )
    return TargetAllocation(children=tuple(nodes))


@st.composite
def evaluations(draw: st.DrawFn) -> tuple[tuple[Rule, ...], FactSet]:
    """A whole evaluation: a target tree, an allocation, and a set of rules."""
    targets = draw(target_trees())
    targeted = tuple(targets.leaves())

    if draw(st.booleans()):
        # On-target holdings, so `NOT_FIRED` is reached as often as a breach is.
        leaves = targets.leaves()
        quantities = [
            int(leaves[asset_class].effective_target * 100) if asset_class in leaves else 0
            for asset_class in CLASSES
        ]
    else:
        quantities = draw(
            st.lists(
                st.integers(min_value=0, max_value=100),
                min_size=len(CLASSES),
                max_size=len(CLASSES),
            )
        )
    unpriced = draw(st.booleans())
    assets = {
        AssetId(f.UUID(int=100 + index)): f.asset(
            AssetId(f.UUID(int=100 + index)), asset_class=asset_class
        )
        for index, asset_class in enumerate(CLASSES)
    }
    holdings = [
        Holding(
            asset_id=asset_id, quantity=f.quantity(str(quantity)), input_refs=(f"op:{asset_id}",)
        )
        for (asset_id, _), quantity in zip(assets.items(), quantities, strict=True)
    ]
    prices = {
        asset_id: f.price(asset_id, "100", n=index)
        for index, asset_id in enumerate(assets)
        if not (unpriced and index == 0)
    }
    allocation = compute_allocation(
        holdings,
        assets,
        prices,
        scope=f.BUCKET_SCOPE,
        as_of=f.AS_OF,
        currency="EUR",
    )
    computation = compute_drift(allocation, targets, strategy_version_id=f.VERSION)

    observed_at = draw(
        st.sampled_from([None, f.NOW, f.NOW.replace(day=8), f.NOW.replace(month=1, day=1)])
    )
    lines = {
        asset_class: bound.model_copy(update={"observed_at": observed_at})
        for asset_class, bound in computation.lines.items()
    }
    facts = FactSet(
        as_of=f.AS_OF,
        scope=f.BUCKET_SCOPE,
        drift=lines,
        unavailable=(
            {"drift": computation.unavailable} if computation.unavailable is not None else {}
        ),
    )

    rules: list[Rule] = []
    for index, asset_class in enumerate(draw(st.permutations([*CLASSES, "GOLD"]))):
        if not draw(st.booleans()):
            continue
        rules.append(
            f.drift_rule(
                index + 1,
                asset_class=asset_class,
                priority=draw(st.sampled_from(PRIORITIES)),
                enabled=draw(st.booleans()),
            )
        )
    if draw(st.booleans()):
        rules.append(
            Rule(
                id=f.rule_id(90),
                name="Regola con kind sconosciuto",
                priority=Priority.INFO,
                suggestion_class=f.drift_rule().suggestion_class,
                message="nulla",
                condition=LeafCondition(kind="not_yet_built", kind_version=1),
            )
        )
    if not rules:
        rules.append(f.drift_rule(1, asset_class=targeted[0]))
    return tuple(rules), facts


@settings(max_examples=250, suppress_health_check=[HealthCheck.too_slow], deadline=None)
@given(evaluations())
def test_replaying_a_trace_reproduces_its_outcome(
    evaluation: tuple[tuple[Rule, ...], FactSet],
) -> None:
    """The contract itself, over arbitrary evaluations, with every source blinded."""
    rules, facts = evaluation
    firings = evaluate(rules, facts)
    assert firings

    for firing in firings:
        replayed = replay_of(firing)
        if replayed is None:
            # Only a rule that was never evaluated may be unreplayable.
            assert firing.outcome is Outcome.ERROR or firing.skip_reason is SkipReason.DISABLED
            assert firing.trace.steps == ()
            continue
        assert replayed == (firing.outcome, firing.skip_reason)
        if firing.outcome in (Outcome.FIRED, Outcome.NOT_FIRED):
            assert firing.trace.bindings and firing.trace.steps


@settings(max_examples=100, deadline=None)
@given(evaluations())
def test_replay_ignores_sources_entirely(
    evaluation: tuple[tuple[Rule, ...], FactSet],
) -> None:
    """Blinding every source and dropping every timestamp changes no outcome."""
    rules, facts = evaluation
    for firing in evaluate(rules, facts):
        assert replay_trace(firing.trace) == replay_trace(blind(firing.trace))


def test_the_property_covers_every_outcome_the_engine_can_produce() -> None:
    """Non-vacuity guard: enumerate the outcomes explicitly and replay each one.

    A property test over a generator is only as strong as what the generator reaches, so the
    seven reachable (outcome, reason) states are also exercised deterministically here.
    """
    from tests.test_rule_engine import BREACHED, WITHIN, facts_for

    stale = {
        asset_class: bound.model_copy(update={"observed_at": f.NOW.replace(month=1, day=1)})
        for asset_class, bound in facts_for(*BREACHED).drift.items()
    }
    unknown = Rule(
        id=f.rule_id(90),
        name="Kind sconosciuto",
        priority=Priority.INFO,
        suggestion_class=f.drift_rule().suggestion_class,
        message="nulla",
        condition=LeafCondition(kind="not_yet_built", kind_version=1),
    )
    cases: dict[tuple[Outcome, SkipReason | None], tuple[Rule, FactSet]] = {
        (Outcome.FIRED, None): (f.drift_rule(1), facts_for(*BREACHED)),
        (Outcome.NOT_FIRED, None): (f.drift_rule(1), facts_for(*WITHIN)),
        (Outcome.SKIPPED, SkipReason.DISABLED): (
            f.drift_rule(1, enabled=False),
            facts_for(*BREACHED),
        ),
        (Outcome.SKIPPED, SkipReason.MISSING_FACT): (
            f.drift_rule(1, asset_class="EQUITY_EMERGING"),
            facts_for(*BREACHED),
        ),
        (Outcome.SKIPPED, SkipReason.STALE_FACT): (
            f.drift_rule(1),
            FactSet(as_of=f.AS_OF, scope=f.BUCKET_SCOPE, drift=stale),
        ),
        (Outcome.SKIPPED, SkipReason.ZERO_PORTFOLIO_VALUE): (
            f.drift_rule(1),
            FactSet(
                as_of=f.AS_OF,
                scope=f.BUCKET_SCOPE,
                unavailable={"drift": SkipReason.ZERO_PORTFOLIO_VALUE},
            ),
        ),
        (Outcome.ERROR, None): (unknown, facts_for(*BREACHED)),
    }
    # SKIPPED(zero_denominator) is the seventh state and is exercised by
    # `test_a_zero_denominator_skip_replays_as_skipped`, since its evidence is a null step.
    for expected, (rule, facts) in cases.items():
        (firing,) = evaluate((rule,), facts)
        assert (firing.outcome, firing.skip_reason) == expected
        replayed = replay_of(firing)
        if expected in {(Outcome.ERROR, None), (Outcome.SKIPPED, SkipReason.DISABLED)}:
            assert replayed is None
        else:
            assert replayed == expected


@settings(max_examples=100, deadline=None)
@given(evaluations())
def test_evaluation_is_deterministic_to_the_byte(
    evaluation: tuple[tuple[Rule, ...], FactSet],
) -> None:
    """Same `FactSet` twice → byte-identical traces (RFC-0006 §11)."""
    rules, facts = evaluation
    first = [canonical_json(firing.trace) for firing in evaluate(rules, facts)]
    second = [canonical_json(firing.trace) for firing in evaluate(rules, facts)]
    assert first == second


# --------------------------------------------------------------------------------------
# The test's own teeth
# --------------------------------------------------------------------------------------


def _fired_trace() -> EvaluationTrace:
    from tests.test_rule_engine import BREACHED, facts_for

    (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
    assert firing.outcome is Outcome.FIRED
    return firing.trace


class TestReplayHasTeeth:
    def test_a_tampered_step_value_is_caught(self) -> None:
        trace = _fired_trace()
        tampered = trace.model_copy(
            update={
                "steps": (
                    trace.steps[0].model_copy(update={"value": "-0.05000000"}),
                    *trace.steps[1:],
                )
            }
        )
        with pytest.raises(ReplayMismatchError):
            replay_trace(tampered)

    def test_a_tampered_binding_flips_the_replayed_outcome(self) -> None:
        """A value cannot be edited without the replay disagreeing with the outcome."""
        trace = _fired_trace()
        tampered = trace.model_copy(
            update={
                "bindings": tuple(
                    binding.model_copy(update={"value": "0.40000000"})
                    if binding.name == "current_weight"
                    else binding
                    for binding in trace.bindings
                )
            }
        )
        with pytest.raises(ReplayMismatchError):
            replay_trace(tampered)

    def test_a_step_over_an_unbound_name_is_caught(self) -> None:
        trace = _fired_trace()
        stripped = trace.model_copy(
            update={
                "bindings": tuple(
                    binding for binding in trace.bindings if binding.name != "current_weight"
                )
            }
        )
        with pytest.raises(ReplayMismatchError):
            replay_trace(stripped)

    def test_a_fired_trace_with_no_steps_cannot_masquerade(self) -> None:
        """An untraced firing is not replayable, so it can never pass the property test."""
        empty = EvaluationTrace(
            condition=ConditionRef(kind="drift_outside_tolerance", kind_version=1),
            outcome=Outcome.FIRED,
        )
        assert replay_trace(empty) is None

    def test_a_non_boolean_final_step_is_caught(self) -> None:
        broken = EvaluationTrace(
            condition=ConditionRef(kind="k", kind_version=1),
            bindings=(Binding(name="a", value="1", source=POISON),),
            steps=(Step(op=StepOp.ABS, inputs=("a",), out="b", value="1"),),
            outcome=Outcome.FIRED,
        )
        with pytest.raises(ReplayMismatchError):
            replay_trace(broken)


# --------------------------------------------------------------------------------------
# The zero-denominator skip, whose evidence lives in the steps
# --------------------------------------------------------------------------------------


def test_a_zero_denominator_skip_replays_as_skipped() -> None:
    """`divide_safe` records a null-valued step; replay must read it as SKIPPED, not
    NOT_FIRED (ADR-0016 + RFC-0006 §4.1)."""

    def evaluate_ratio(
        params: DriftOutsideToleranceParams, facts: FactSet, recorder: TraceRecorder
    ) -> ConditionResult:
        fact = recorder.open_fact("drift:x", facts.drift_for(params.asset_class))
        fact.bind("numerator", fact.value.drift)
        fact.bind("denominator", Decimal(0))
        ratio = recorder.ratio_to("ratio", "numerator", "denominator")
        return ConditionResult(fired=ratio > 0)

    registry = ConditionRegistry()
    registry.register(
        ConditionKindSpec(
            kind="ratio_over_zero",
            kind_version=1,
            params_model=DriftOutsideToleranceParams,
            required_facts=frozenset({"drift"}),
            default_max_staleness=None,
            severity=SeverityDeclaration(formula=None),
            explanation_template="rapporto non calcolabile",
            evaluate=evaluate_ratio,
        )
    )
    from tests.test_rule_engine import BREACHED, facts_for

    rule = f.drift_rule(1).model_copy(
        update={
            "condition": LeafCondition(
                kind="ratio_over_zero",
                kind_version=1,
                params={"asset_class": "EQUITY_DEVELOPED", "scope": f.BUCKET_SCOPE.ref},
            )
        }
    )
    (firing,) = evaluate((rule,), facts_for(*BREACHED), registry=registry)
    assert firing.outcome is Outcome.SKIPPED
    assert firing.skip_reason is SkipReason.ZERO_DENOMINATOR
    assert firing.trace.steps[-1].value is None
    assert replay_of(firing) == (Outcome.SKIPPED, SkipReason.ZERO_DENOMINATOR)


# --------------------------------------------------------------------------------------
# The whole algebra, not just the ops one kind happens to use
# --------------------------------------------------------------------------------------

EXACT = st.decimals(
    min_value=Decimal("-1000"), max_value=Decimal("1000"), places=8, allow_nan=False
)
ARITHMETIC = (
    StepOp.SUBTRACT,
    StepOp.ADD,
    StepOp.MULTIPLY,
    StepOp.DIVIDE_SAFE,
    StepOp.RATIO_TO,
    StepOp.ABS,
)
COMPARISONS = (StepOp.GT, StepOp.GTE, StepOp.LT, StepOp.LTE, StepOp.EQ, StepOp.ABS_GT)


@settings(max_examples=300, deadline=None)
@given(
    st.lists(EXACT, min_size=2, max_size=4),
    st.lists(st.sampled_from(ARITHMETIC), min_size=1, max_size=5),
    st.sampled_from(COMPARISONS),
    st.booleans(),
)
def test_arbitrary_step_programs_replay(
    values: list[Decimal], operations: list[StepOp], comparison: StepOp, negated: bool
) -> None:
    """Every operation in the algebra survives a round trip through the trace."""
    recorder = TraceRecorder(
        condition=ConditionRef(kind="synthetic", kind_version=1), as_of=f.AS_OF
    )
    source = SourceRef.derived(engine="test")
    names = [f"v{index}" for index in range(len(values))]
    for name, value in zip(names, values, strict=True):
        recorder.bind(name, value, source=source)

    skipped = False
    try:
        for index, operation in enumerate(operations):
            out = f"s{index}"
            left, right = names[index % len(names)], names[(index + 1) % len(names)]
            _apply_recorded(recorder, operation, out, left, right)
            names.append(out)
        fired = _compare_recorded(recorder, comparison, "verdict", names[-1], names[0])
        if negated:
            fired = recorder.negate("negated", "verdict")
    except SkipSignal as skip:
        assert skip.reason is SkipReason.ZERO_DENOMINATOR
        skipped = True

    if skipped:
        trace = recorder.trace(Outcome.SKIPPED, skip_reason=SkipReason.ZERO_DENOMINATOR)
        assert replay_trace(blind(trace)) is not None
        replayed = replay_trace(blind(trace))
        assert replayed is not None
        assert replayed.outcome is Outcome.SKIPPED
        assert replayed.skip_reason is SkipReason.ZERO_DENOMINATOR
        return

    outcome = Outcome.FIRED if fired else Outcome.NOT_FIRED
    trace = recorder.trace(outcome)
    replayed = replay_trace(blind(trace))
    assert replayed is not None
    assert replayed.outcome is outcome


def _apply_recorded(
    recorder: TraceRecorder, operation: StepOp, out: str, left: str, right: str
) -> Any:
    match operation:
        case StepOp.SUBTRACT:
            return recorder.subtract(out, left, right)
        case StepOp.ADD:
            return recorder.add(out, left, right)
        case StepOp.MULTIPLY:
            return recorder.multiply(out, left, right)
        case StepOp.DIVIDE_SAFE:
            return recorder.divide_safe(out, left, right)
        case StepOp.RATIO_TO:
            return recorder.ratio_to(out, left, right)
        case _:
            return recorder.absolute(out, left)


def _compare_recorded(
    recorder: TraceRecorder, operation: StepOp, out: str, left: str, right: str
) -> bool:
    match operation:
        case StepOp.GT:
            return recorder.gt(out, left, right)
        case StepOp.GTE:
            return recorder.gte(out, left, right)
        case StepOp.LT:
            return recorder.lt(out, left, right)
        case StepOp.LTE:
            return recorder.lte(out, left, right)
        case StepOp.EQ:
            return recorder.eq(out, left, right)
        case _:
            return recorder.abs_gt(out, left, right)


@settings(max_examples=100, deadline=None)
@given(st.lists(st.booleans(), min_size=2, max_size=4), st.sampled_from([StepOp.ALL, StepOp.ANY]))
def test_boolean_combinators_replay(flags: list[bool], operation: StepOp) -> None:
    """`all`/`any`/`not` are in the algebra before any combinator kind uses them."""
    recorder = TraceRecorder(
        condition=ConditionRef(kind="synthetic", kind_version=1), as_of=f.AS_OF
    )
    source = SourceRef.derived(engine="test")
    names = [f"b{index}" for index in range(len(flags))]
    for name, flag in zip(names, flags, strict=True):
        recorder.bind(name, flag, source=source)
    combined = (
        recorder.all_of("verdict", *names)
        if operation is StepOp.ALL
        else recorder.any_of("verdict", *names)
    )
    outcome = Outcome.FIRED if combined else Outcome.NOT_FIRED
    replayed = replay_trace(blind(recorder.trace(outcome)))
    assert replayed is not None
    assert replayed.outcome is outcome
