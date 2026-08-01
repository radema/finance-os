"""Registry completeness (RFC-0006 §11–§12, RFC-0007 §3.1, ERR-10).

> A kind cannot be registered without params model, evaluator, explanation template,
> `required_facts`, and a `severity` declaration (a formula or an explicit `null`). Fails the
> build otherwise.

This is the mechanical guard that stops the catalog from decaying. It is the only thing
preventing a kind from shipping with a working evaluator and no explanation — which is
precisely how a P3 system quietly stops being explainable.
"""

from datetime import timedelta
from decimal import Decimal
from string import Formatter
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from financeos.core.decision import ConditionRef
from financeos.core.engines.rule_engine import (
    REGISTRY,
    ConditionKindSpec,
    ConditionRegistry,
    ConditionResult,
    DriftOutsideToleranceParams,
    FactSet,
    SeverityDeclaration,
    TraceRecorder,
    evaluate,
    evaluate_drift_outside_tolerance,
)
from financeos.core.shared import Outcome
from financeos.core.shared.errors import RegistryError, UnknownConditionKindError
from tests import factories as f
from tests.test_rule_engine import BREACHED, facts_for
from tests.test_rule_engine_v1_kinds import ANCHOR_FIXTURES, FIRING_FIXTURES

#: Kinds whose declared formula's own firing predicate makes `severity == 1.00000000` a limit
#: approached from above, never attained on a `FIRED` row (review MAJOR 7): the boundary case
#: drops the sole/worst candidate out of the affected set instead of firing at exactly 1.00.
#: `over_apportioned` (ADR-L04 §4.5) is bounded above at 2.00; `untargeted_allocation`
#: (ADR-L05 §3) is unbounded above. Both are tested for their own open-interval boundary
#: elsewhere (`TestOverApportioned`, `TestUntargetedAllocation`), not against the exact-1.0
#: anchor assertion below.
OPEN_INTERVAL_KINDS: frozenset[str] = frozenset({"over_apportioned", "untargeted_allocation"})

#: The complete registration of a well-formed kind, used as the baseline every "missing
#: component" case is derived from.
COMPLETE: dict[str, Any] = {
    "kind": "drift_outside_tolerance",
    "kind_version": 1,
    "params_model": DriftOutsideToleranceParams,
    "required_facts": frozenset({"drift"}),
    "default_max_staleness": timedelta(days=7),
    "severity": SeverityDeclaration(formula="|drift| / effective_band"),
    "explanation_template": "{asset_class_label} è fuori target.",
    "numeric_bindings": frozenset(),
    "evaluate": evaluate_drift_outside_tolerance,
}

#: Every component whose omission must fail the build.
MANDATORY = (
    "kind",
    "kind_version",
    "params_model",
    "required_facts",
    "default_max_staleness",
    "severity",
    "explanation_template",
    "numeric_bindings",
    "evaluate",
)


def test_the_baseline_registration_is_accepted() -> None:
    spec = ConditionKindSpec(**COMPLETE)
    assert spec.kind == "drift_outside_tolerance"


@pytest.mark.parametrize("omitted", MANDATORY)
def test_omitting_any_mandatory_component_fails_the_build(omitted: str) -> None:
    partial = {name: value for name, value in COMPLETE.items() if name != omitted}
    with pytest.raises(ValidationError):
        ConditionKindSpec(**partial)


def test_an_empty_explanation_template_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ConditionKindSpec(**{**COMPLETE, "explanation_template": ""})


def test_a_kind_must_declare_the_facts_it_consumes() -> None:
    with pytest.raises(ValidationError):
        ConditionKindSpec(**{**COMPLETE, "required_facts": frozenset()})


def test_a_severity_declaration_must_be_explicit() -> None:
    with pytest.raises(ValidationError):
        SeverityDeclaration()  # type: ignore[call-arg]
    assert SeverityDeclaration(formula=None).formula is None


def test_a_kind_may_not_be_registered_twice() -> None:
    registry = ConditionRegistry()
    registry.register(ConditionKindSpec(**COMPLETE))
    with pytest.raises(RegistryError):
        registry.register(ConditionKindSpec(**COMPLETE))


def test_an_unregistered_kind_cannot_be_looked_up() -> None:
    with pytest.raises(UnknownConditionKindError):
        ConditionRegistry().get("drift_outside_tolerance", 1)


def test_a_new_kind_version_is_a_new_registration() -> None:
    """A kind's semantics never change; a new meaning is a new version (RFC-0006 §8)."""
    registry = ConditionRegistry()
    registry.register(ConditionKindSpec(**COMPLETE))
    registry.register(ConditionKindSpec(**{**COMPLETE, "kind_version": 2}))
    assert [spec.kind_version for spec in registry.all_kinds()] == [1, 2]


class TestTheShippedCatalog:
    """Every kind actually in the catalog is complete and coherent."""

    def test_the_v1_0_catalog_ships_exactly_these_six_kinds(self) -> None:
        assert [(spec.kind, spec.kind_version) for spec in REGISTRY.all_kinds()] == [
            ("allocation_absent", 1),
            ("bucket_below_target_value", 1),
            ("drift_outside_tolerance", 1),
            ("over_apportioned", 1),
            ("unassigned_residual_above", 1),
            ("untargeted_allocation", 1),
        ]

    @pytest.mark.parametrize("spec", REGISTRY.all_kinds(), ids=lambda spec: spec.kind)
    def test_every_registered_kind_declares_all_components(
        self, spec: ConditionKindSpec[Any]
    ) -> None:
        assert spec.kind
        assert spec.kind_version >= 1
        assert issubclass(spec.params_model, BaseModel)
        assert spec.required_facts
        assert isinstance(spec.severity, SeverityDeclaration)
        assert spec.explanation_template.strip()
        assert callable(spec.evaluate)

    @pytest.mark.parametrize("spec", REGISTRY.all_kinds(), ids=lambda spec: spec.kind)
    def test_every_explanation_renders_from_the_bindings_the_kind_emits(
        self, spec: ConditionKindSpec[Any]
    ) -> None:
        """A template referencing a binding the evaluator never captures is not an
        explanation — it is a runtime error waiting for its first firing.

        Each kind is exercised against a fixture that actually reaches `FIRED` for that
        kind — `FIRING_FIXTURES` (`tests/test_rule_engine_v1_kinds.py`) for the five V1.0
        kinds beyond the skeleton, the drift fixture for `drift_outside_tolerance` itself.
        """
        if spec.kind == "drift_outside_tolerance":
            (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        else:
            rule, facts = FIRING_FIXTURES[spec.kind]
            (firing,) = evaluate((rule,), facts)
        assert firing.outcome is Outcome.FIRED
        referenced = {
            name for _, name, _, _ in Formatter().parse(spec.explanation_template) if name
        }
        assert referenced <= set(firing.trace.message_bindings)
        assert spec.render_explanation(firing.trace.message_bindings)

    def test_the_drift_kind_declares_the_rfc0007_severity_formula(self) -> None:
        spec = REGISTRY.get("drift_outside_tolerance", 1)
        assert spec.severity.formula == "|drift| / effective_band"

    @pytest.mark.parametrize("spec", REGISTRY.all_kinds(), ids=lambda spec: spec.kind)
    def test_every_formula_kind_has_an_anchor_fixture_or_a_documented_exemption(
        self, spec: ConditionKindSpec[Any]
    ) -> None:
        """ADR-L04 §6.1: 'the suite fails if a kind is registered with a formula and no
        anchor case.' Registry-driven (`REGISTRY.all_kinds()`), not the hand-maintained kind
        list the boundary test below used to parametrize over — that list silently skipped a
        kind with a formula and no anchor fixture (review MAJOR 7)."""
        if spec.severity.formula is None:
            return  # a legitimate `null` declaration (ADR-L02 §4.3) has no anchor to check
        if spec.kind == "drift_outside_tolerance":
            return  # tested directly below, against its own `facts_for` fixture
        assert spec.kind in ANCHOR_FIXTURES or spec.kind in OPEN_INTERVAL_KINDS, (
            f"{spec.kind}: declares a severity formula but has neither an ANCHOR_FIXTURES "
            "entry nor an OPEN_INTERVAL_KINDS exemption"
        )

    @pytest.mark.parametrize("kind", sorted(ANCHOR_FIXTURES) + ["drift_outside_tolerance"])
    def test_severity_equals_one_exactly_at_the_kind_s_own_firing_threshold(
        self, kind: str
    ) -> None:
        """The generalized registry property (ADR-L02 §4.6, ADR-L04 §4.5/§4.7): for every
        kind declaring a `severity` formula and not in `OPEN_INTERVAL_KINDS`, `1.00000000`
        sits exactly on the boundary — the last `NOT_FIRED` state before the predicate flips.
        `over_apportioned` and `untargeted_allocation` are excluded here (open-interval
        formulas, tested for their own boundary in `TestOverApportioned`/
        `TestUntargetedAllocation`) but still covered by the completeness test above."""
        if kind == "drift_outside_tolerance":
            (firing,) = evaluate(
                (f.drift_rule(1),), facts_for((f.EQUITY, "38"), (f.BOND, "62"))
            )
        else:
            rule, facts = ANCHOR_FIXTURES[kind]
            (firing,) = evaluate((rule,), facts)
        assert firing.outcome is Outcome.NOT_FIRED
        assert firing.severity == Decimal("1.00000000")

    def test_an_evaluator_is_a_pure_function_of_params_facts_and_recorder(self) -> None:
        facts: FactSet = facts_for(*BREACHED)
        recorder = TraceRecorder(
            condition=ConditionRef(kind="drift_outside_tolerance", kind_version=1),
            as_of=f.AS_OF,
        )
        result = evaluate_drift_outside_tolerance(
            DriftOutsideToleranceParams(asset_class="EQUITY_DEVELOPED", scope=f.BUCKET_SCOPE.ref),
            facts,
            recorder,
        )
        assert isinstance(result, ConditionResult)
        assert result.fired is True
        assert recorder.trace(Outcome.FIRED).steps
