"""Decision Engine: materialization, ordering, provenance, and the assembled rationale
(RFC-0008 §9)."""

import itertools
from collections.abc import Callable
from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from hypothesis import given
from hypothesis import strategies as st

from financeos.adapters.duckdb.queries.it_locale import format_number_it
from financeos.core.engines.decision_engine import (
    MaterializationResult,
    assemble_rationale,
    finding_key,
    materialize,
    render_observation,
)
from financeos.core.engines.rule_engine import FactSet, evaluate
from financeos.core.shared import (
    BucketId,
    Outcome,
    Priority,
    RunMode,
    Scope,
    SkipReason,
    StrategyVersionId,
    SuggestionClass,
)
from financeos.core.shared.errors import RuleNotInVersionError, TemplateRenderError
from financeos.core.strategy import Horizon, LeafCondition, Rule
from tests import factories as f
from tests.test_rule_engine import BREACHED, WITHIN, facts_for


def ids() -> Callable[[], UUID]:
    """A deterministic id factory, standing in for the application's `IdGen` port."""
    counter = itertools.count(9000)
    return lambda: UUID(int=next(counter))


def run_pipeline(
    rules: tuple[Rule, ...],
    facts: FactSet | None = None,
    *,
    mode: RunMode = RunMode.ACTUAL,
) -> MaterializationResult:
    """Evaluate `rules` against `facts` and materialize the result."""
    firings = evaluate(rules, facts if facts is not None else facts_for(*BREACHED))
    return materialize(
        firings,
        f.strategy_version(rules=rules),
        f.evaluation_run(mode=mode),
        next_id=ids(),
        recorded_at=f.NOW,
    )


class TestMaterialization:
    def test_every_outcome_yields_exactly_one_alert(self) -> None:
        rules = (
            f.drift_rule(1),
            f.drift_rule(2, enabled=False),
            f.drift_rule(3, asset_class="EQUITY_EMERGING"),
        )
        result = run_pipeline(rules)
        assert len(result.alerts) == 3
        assert {alert.outcome for alert in result.alerts} == {
            Outcome.FIRED,
            Outcome.SKIPPED,
        }

    def test_only_a_fired_alert_becomes_a_recommendation(self) -> None:
        rules = (f.drift_rule(1), f.drift_rule(2, enabled=False))
        result = run_pipeline(rules)
        assert len(result.recommendations) == 1
        recommendation = result.recommendations[0]
        fired = next(a for a in result.alerts if a.outcome is Outcome.FIRED)
        assert recommendation.alert_id == fired.id

    def test_not_fired_yields_an_alert_and_no_recommendation(self) -> None:
        result = run_pipeline((f.drift_rule(1),), facts_for(*WITHIN))
        assert [alert.outcome for alert in result.alerts] == [Outcome.NOT_FIRED]
        assert result.recommendations == ()

    def test_a_hypothetical_run_writes_no_recommendation(self) -> None:
        result = run_pipeline((f.drift_rule(1),), mode=RunMode.HYPOTHETICAL)
        assert [alert.outcome for alert in result.alerts] == [Outcome.FIRED]
        assert result.recommendations == ()

    def test_severity_is_null_on_skipped_alerts(self) -> None:
        result = run_pipeline((f.drift_rule(1, enabled=False),))
        assert result.alerts[0].severity is None

    def test_severity_is_promoted_onto_the_alert(self) -> None:
        result = run_pipeline((f.drift_rule(1),))
        assert result.alerts[0].severity == Decimal("3.00000000")

    def test_a_rule_absent_from_the_pinned_version_is_rejected(self) -> None:
        """ADR-0027: with no foreign key, this boundary check is the integrity guarantee."""
        version = f.strategy_version(rules=(f.drift_rule(1),))
        firings = evaluate((f.drift_rule(7),), facts_for(*BREACHED))
        with pytest.raises(RuleNotInVersionError):
            materialize(firings, version, f.evaluation_run(), next_id=ids(), recorded_at=f.NOW)

    def test_artifacts_are_immutable_and_carry_the_run(self) -> None:
        result = run_pipeline((f.drift_rule(1),))
        alert = result.alerts[0]
        assert alert.run_id == f.RUN
        assert alert.trace.outcome is Outcome.FIRED
        recommendation = result.recommendations[0]
        assert recommendation.provenance.run_id == f.RUN
        assert recommendation.provenance.strategy_version_id == f.VERSION
        assert recommendation.provenance.rule_id == f.rule_id(1)


class TestOrdering:
    def test_priority_band_then_severity_then_rule_id(self) -> None:
        rules = (
            f.drift_rule(3, asset_class="BONDS_GOV_EUR", priority=Priority.HIGH),
            f.drift_rule(1, asset_class="EQUITY_DEVELOPED", priority=Priority.HIGH),
            f.drift_rule(2, asset_class="EQUITY_EMERGING", priority=Priority.CRITICAL),
        )
        result = run_pipeline(rules)
        # CRITICAL first (a SKIPPED rule, severity NULL, still outranks by band); then HIGH
        # ordered by severity: EQUITY_DEVELOPED 3.00 before BONDS_GOV_EUR 1.20.
        assert [alert.rule_id for alert in result.alerts] == [
            f.rule_id(2),
            f.rule_id(1),
            f.rule_id(3),
        ]

    def test_null_severity_sorts_last_within_its_band(self) -> None:
        rules = (
            f.drift_rule(1, asset_class="EQUITY_EMERGING"),  # SKIPPED → severity NULL
            f.drift_rule(2, asset_class="BONDS_GOV_EUR"),  # FIRED, severity 1.20
        )
        result = run_pipeline(rules)
        assert [alert.rule_id for alert in result.alerts] == [
            f.rule_id(2),
            f.rule_id(1),
        ]

    def test_rule_id_breaks_ties_so_a_rerun_is_identical(self) -> None:
        rules = (f.drift_rule(2), f.drift_rule(1))
        first = materialize(
            evaluate(rules, facts_for(*BREACHED)),
            f.strategy_version(rules=rules),
            f.evaluation_run(),
            next_id=ids(),
            recorded_at=f.NOW,
        )
        second = materialize(
            evaluate(rules, facts_for(*BREACHED)),
            f.strategy_version(rules=rules),
            f.evaluation_run(),
            next_id=ids(),
            recorded_at=f.NOW,
        )
        assert [a.model_dump_json() for a in first.alerts] == [
            a.model_dump_json() for a in second.alerts
        ]


class TestFindingKey:
    def test_is_stable_across_strategy_version_changes(self) -> None:
        """RFC-0008 §4: editing an unrelated rule must not reset a finding's history."""
        rule = f.drift_rule(1)
        first = finding_key(rule, f.evaluation_run())
        other_version = f.evaluation_run(version_id=StrategyVersionId(UUID(int=999)))
        assert finding_key(rule, other_version) == first

    def test_varies_with_the_rule(self) -> None:
        run = f.evaluation_run()
        assert finding_key(f.drift_rule(1), run) != finding_key(f.drift_rule(2), run)

    def test_varies_with_the_scope(self) -> None:
        """R-2: scope is a guaranteed hash component, whatever a kind's params contain."""
        rule = f.drift_rule(1)
        other = f.evaluation_run(scope=Scope.for_bucket(BucketId(UUID(int=42))))
        assert finding_key(rule, other) != finding_key(rule, f.evaluation_run())

    def test_varies_with_the_params(self) -> None:
        run = f.evaluation_run()
        first = finding_key(f.drift_rule(1, asset_class="EQUITY_DEVELOPED"), run)
        second = finding_key(f.drift_rule(1, asset_class="BONDS_GOV_EUR"), run)
        assert first != second

    @given(st.sampled_from(["EQUITY_DEVELOPED", "BONDS_GOV_EUR"]))
    def test_is_a_stable_sha256(self, asset_class: str) -> None:
        rule = f.drift_rule(1, asset_class=asset_class)
        key = finding_key(rule, f.evaluation_run())
        assert len(key) == 64
        assert key == finding_key(rule, f.evaluation_run())


class TestObservation:
    def test_renders_from_the_captured_message_bindings(self) -> None:
        result = run_pipeline((f.drift_rule(1),))
        assert result.recommendations[0].observation == (
            "Azioni dei paesi sviluppati è al 34.00% contro un target del 40.00% "
            "(tolleranza ±2.00pp). Scostamento: -6.00pp."
        )

    def test_reads_only_the_trace(self) -> None:
        """A March observation re-rendered in October reads the March trace and nothing else."""
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        rendered = render_observation(f.drift_rule(1), firing.trace.message_bindings)
        assert "34.00" in rendered

    def test_a_template_referencing_an_absent_binding_is_an_authoring_error(self) -> None:
        rule = f.drift_rule(1, message="Comprare {instrument} entro {quando}.")
        (firing,) = evaluate((f.drift_rule(1),), facts_for(*BREACHED))
        with pytest.raises(TemplateRenderError) as caught:
            render_observation(rule, firing.trace.message_bindings)
        assert "instrument" in str(caught.value)


class TestRationale:
    def test_is_assembled_from_the_frozen_version_only(self) -> None:
        """ADR-0023 golden test: every clause traces to a field of the StrategyVersion."""
        version = f.strategy_version(rules=(f.drift_rule(1),))
        rationale = assemble_rationale(version, f.drift_rule(1))
        assert rationale == (
            "La tua strategia «Crescita di lungo periodo» (congelata il 01/03/2026) "
            "prevede un target del 40.00% per le Azioni dei paesi sviluppati con una banda "
            "di ±2.00pp, su un orizzonte di 20 anni. "
            "Principio dichiarato: «preservare il potere d'acquisto senza fare market timing»."
        )

    def test_cites_the_tolerance_semantics_that_applied(self) -> None:
        version = f.strategy_version(
            rules=(f.drift_rule(1),),
            targets=f.flat_targets(
                ("EQUITY_DEVELOPED", "0.4", f.relative("0.25")),
                ("BONDS_GOV_EUR", "0.6", f.absolute("0.05")),
            ),
        )
        rationale = assemble_rationale(version, f.drift_rule(1))
        assert "banda relativa del 25.00% del target (±10.00pp)" in rationale

    def test_a_weakly_articulated_strategy_produces_a_visibly_weak_rationale(self) -> None:
        """RFC-0008 §5.2: that is a feature — the fix is upstream in the Strategy."""
        version = f.strategy_version(rules=(f.drift_rule(1),), principles=())
        rationale = assemble_rationale(version, f.drift_rule(1))
        assert "Principio dichiarato" not in rationale
        assert rationale.endswith("su un orizzonte di 20 anni.")

    def test_a_date_horizon_is_cited_as_a_date(self) -> None:
        version = f.strategy_version(rules=(f.drift_rule(1),))
        dated = version.model_copy(
            update={
                "definition": version.definition.model_copy(
                    update={"horizon": Horizon(target_date=date(2032, 12, 31))}
                )
            }
        )
        assert "con scadenza 31/12/2032" in assemble_rationale(dated, f.drift_rule(1))

    def test_a_rule_whose_params_name_no_class_still_gets_a_rationale(self) -> None:
        rule = f.drift_rule(1).model_copy(
            update={
                "condition": LeafCondition(
                    kind="unassigned_residual_above",
                    kind_version=1,
                    params={"threshold_weight": "0.10"},
                )
            }
        )
        rationale = assemble_rationale(f.strategy_version(rules=(rule,)), rule)
        assert "governa questo scopo di valutazione" in rationale

    def test_never_mentions_an_instrument(self) -> None:
        version = f.strategy_version(rules=(f.drift_rule(1),))
        rationale = assemble_rationale(version, f.drift_rule(1))
        assert f.asset().name not in rationale
        assert str(f.EQUITY) not in rationale

    def test_an_injected_number_renderer_is_used_for_every_percentage(self) -> None:
        """L05 §7.3: the write path passes canonical (the default); a read path re-assembling
        the same frozen version for display passes an it-IT renderer instead."""
        version = f.strategy_version(rules=(f.drift_rule(1),))
        rationale = assemble_rationale(version, f.drift_rule(1), render_number=format_number_it)
        assert (
            "prevede un target del 40,00% per le Azioni dei paesi sviluppati con una banda "
            "di ±2,00pp" in rationale
        )
        assert "40.00%" not in rationale


class TestProvenance:
    def test_input_refs_collect_every_reference_the_bindings_resolve_to(self) -> None:
        result = run_pipeline((f.drift_rule(1),))
        refs = result.recommendations[0].provenance.input_refs
        assert refs[0] == f"sv:{f.VERSION}"
        assert any(ref.startswith("op:") for ref in refs)
        assert any(ref.startswith("price:") for ref in refs)
        assert len(refs) == len(set(refs))

    def test_the_suggestion_class_comes_from_the_rule(self) -> None:
        rule = f.drift_rule(1, suggestion_class=SuggestionClass.REVIEW_ALLOCATION)
        result = run_pipeline((rule,))
        assert result.recommendations[0].suggestion_class is SuggestionClass.REVIEW_ALLOCATION

    def test_a_skipped_finding_leaves_no_recommendation_to_resolve_against(self) -> None:
        """A finding resolves only on NOT_FIRED, never on SKIPPED (ADR-0021)."""
        result = run_pipeline((f.drift_rule(1, asset_class="EQUITY_EMERGING"),))
        assert result.recommendations == ()
        assert result.alerts[0].trace.skip_reason is SkipReason.MISSING_FACT
