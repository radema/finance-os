"""Decision Engine — materialization, ordering, provenance (RFC-0008).

A pure composition function, not a ninth Domain Service. It materializes one `Alert` per
firing whatever the outcome, one `Recommendation` per `FIRED` firing, orders them, and
attaches provenance. It deduplicates nothing: dedup is a derived read model (`mv_finding`,
ADR-0021), because a mutable Recommendation would be a row whose `run_id` no longer
identifies the run that produced its content.

The load-bearing decision here is ADR-0023: **`rationale` is assembled from the frozen
`StrategyVersion`**, never authored per rule and never generated. That is what makes Manifest
P3 literal — *"Secondo la tua strategia…"* — and it closes the MiFID suitability element
structurally: the only inputs to the rationale generator are the user's own frozen
declarations, so no code path can assert that anything is suitable for them.
"""

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from decimal import Decimal
from string import Formatter
from typing import Final, NamedTuple
from uuid import UUID

from financeos.core.decision import (
    Alert,
    EvaluationRun,
    Provenance,
    Recommendation,
    RuleFiring,
)
from financeos.core.shared import (
    AlertId,
    AssetClass,
    Outcome,
    Percentage,
    RecommendationId,
    Role,
    RunMode,
    SourceRef,
    canonical_decimal,
    canonical_json,
    label,
    priority_rank,
    sha256_hex,
)
from financeos.core.shared.errors import TemplateRenderError
from financeos.core.strategy import LeafTarget, Rule, StrategyVersion, ToleranceKind

ENGINE_VERSION: Final = "1.0.0"
ENGINE_NAME: Final = "decision"

#: `severity` sorts descending with nulls last: a kind that cannot express its own urgency
#: must not outrank one that can (RFC-0008 §3).
_SEVERITY_NULL_SENTINEL: Final = Decimal("-1")


class MaterializationResult(NamedTuple):
    """What one evaluation produced, in persistence and display order."""

    alerts: tuple[Alert, ...]
    recommendations: tuple[Recommendation, ...]


def materialize(
    firings: Sequence[RuleFiring],
    strategy_version: StrategyVersion,
    run: EvaluationRun,
    *,
    next_id: Callable[[], UUID],
    recorded_at: datetime,
) -> MaterializationResult:
    """Turn rule firings into the run's immutable audit artifacts.

    Args:
        firings: Every firing of the run, in any order.
        strategy_version: The frozen version the run pinned. Every rule is resolved against
            it, which is the integrity guarantee that replaced the dropped foreign key
            (ADR-0027), and it is the sole source of every assembled `rationale` (ADR-0023).
        run: The `EvaluationRun` the artifacts belong to.
        next_id: Identifier factory, supplied by the application's `IdGen` port. Passed as a
            value so the engine holds no port (I-7).
        recorded_at: The `recorded_at` stamp for every artifact of this run.

    Returns:
        `MaterializationResult`, ordered by `priority_rank DESC, severity DESC NULLS LAST,
        rule_id ASC` — a total order, so a re-run is byte-identical.

    Raises:
        RuleNotInVersionError: If a firing names a rule absent from the pinned version.
        TemplateRenderError: If a rule's `MessageTemplate` references a binding the trace does
            not carry. The binding namespace of each kind is closed and known, so this is an
            authoring defect that the application validates on freeze.
    """
    resolved = [(firing, strategy_version.rule(firing.rule_id)) for firing in firings]
    resolved.sort(key=lambda pair: _order_key(*pair))

    alerts: list[Alert] = []
    recommendations: list[Recommendation] = []
    for firing, rule in resolved:
        alert = Alert(
            id=AlertId(next_id()),
            run_id=run.id,
            rule_id=rule.id,
            outcome=firing.outcome,
            priority=rule.priority,
            severity=_persisted_severity(firing),
            trace=firing.trace,
            recorded_at=recorded_at,
        )
        alerts.append(alert)
        if firing.outcome is not Outcome.FIRED or run.mode is RunMode.HYPOTHETICAL:
            continue
        recommendations.append(
            _recommend(firing, rule, alert, strategy_version, run, next_id, recorded_at)
        )
    return MaterializationResult(tuple(alerts), tuple(recommendations))


def _order_key(firing: RuleFiring, rule: Rule) -> tuple[int, Decimal, str]:
    severity = firing.severity if firing.severity is not None else _SEVERITY_NULL_SENTINEL
    return (-priority_rank(rule.priority), -severity, str(rule.id))


def _persisted_severity(firing: RuleFiring) -> Decimal | None:
    """`severity` is NULL for `SKIPPED` and `ERROR` outcomes regardless of the kind (ERR-1)."""
    if firing.outcome in (Outcome.SKIPPED, Outcome.ERROR):
        return None
    return firing.severity


def _recommend(
    firing: RuleFiring,
    rule: Rule,
    alert: Alert,
    version: StrategyVersion,
    run: EvaluationRun,
    next_id: Callable[[], UUID],
    recorded_at: datetime,
) -> Recommendation:
    return Recommendation(
        id=RecommendationId(next_id()),
        alert_id=alert.id,
        provenance=Provenance(
            run_id=run.id,
            strategy_id=run.strategy_id,
            strategy_version_id=run.strategy_version_id,
            rule_id=rule.id,
            input_refs=_input_refs(firing),
            evaluated_at=run.evaluated_at,
        ),
        finding_key=finding_key(rule, run),
        observation=render_observation(rule, firing.trace.message_bindings),
        rationale=assemble_rationale(version, rule),
        suggestion_class=rule.suggestion_class,
        recorded_at=recorded_at,
    )


def finding_key(rule: Rule, run: EvaluationRun) -> str:
    """`sha256(rule_id ‖ scope_id ‖ canonical(condition.params))` (RFC-0008 §4).

    `strategy_version_id` is deliberately excluded: editing an unrelated rule freezes a new
    version and would otherwise reset the finding's history, making "this has been drifting
    for five months" unanswerable. The evaluation scope is a guaranteed hash component even
    though most kinds also carry it in `params` — the redundancy is kept on purpose, so a
    future kind whose params omit scope cannot silently merge findings across Buckets (R-2).
    """
    return sha256_hex(str(rule.id), str(run.scope.id), canonical_json(dict(rule.condition.params)))


def render_observation(rule: Rule, message_bindings: Mapping[str, str]) -> str:
    """Render what is true, from the trace's captured bindings (RFC-0008 §5.1).

    Rendering reads only the trace, so a March observation re-rendered in October reads the
    March trace and nothing else.
    """
    required = {name for _, name, _, _ in Formatter().parse(rule.message) if name}
    missing = sorted(required - set(message_bindings))
    if missing:
        raise TemplateRenderError(
            f"rule {rule.id}: message references bindings the trace does not carry: {missing}"
        )
    return rule.message.format(**message_bindings)


def assemble_rationale(
    version: StrategyVersion,
    rule: Rule,
    *,
    render_number: Callable[[Decimal], str] = canonical_decimal,
) -> str:
    """Assemble why a finding matters by citing the frozen `StrategyVersion` (ADR-0023).

    The only inputs are the user's own declarations: the strategy's name and freeze date, the
    target and tolerance the rule was written against, the horizon, and the first declared
    principle. Nothing from live state, nothing generated, nothing authored per rule — which
    is why a weakly-articulated Strategy produces a visibly weak rationale, and why that is a
    feature rather than a defect.

    Italian is the user-facing language (ADR-L03), while the Ubiquitous Language terms and
    every identifier stay as they are.

    Args:
        render_number: How a percentage-point `Decimal` is rendered to text. Defaults to the
            canonical dot-decimal form, which is what the write path must use — `rationale` is
            frozen at creation (RFC-0008 §5.1), so the stored string is this default's output.
            An it-IT `render_number` is for a *new* row's write path only: re-invoking this
            function against an old row's `(version, rule)` would re-derive the sentence under
            today's code rather than replay what was actually frozen, which is exactly the
            rewritten-history failure the freeze exists to prevent — see
            `docs/features-candidates/rationale-locale-freeze.md`.
    """
    definition = version.definition
    leaf = _targeted_leaf(version, rule)
    if leaf is not None:
        provision = (
            f"prevede un target del "
            f"{render_number(Percentage.from_ratio(leaf.effective_target).value)}% per "
            f"{label(leaf.asset_class, role=Role.THE)} con {_band_phrase(leaf, render_number)}"
        )
    else:
        provision = "governa questo scopo di valutazione"

    rationale = (
        f"La strategia «{definition.name}» "
        f"(congelata il {version.frozen_at:%d/%m/%Y}) {provision}, "
        f"su un orizzonte {_horizon_phrase(version)}."
    )
    principle = next(iter(definition.risk.principles), None)
    if principle:
        rationale = f"{rationale} Principio dichiarato: «{principle}»."
    return rationale


def _targeted_leaf(version: StrategyVersion, rule: Rule) -> LeafTarget | None:
    """The frozen leaf target a rule's params point at, if the kind names one."""
    asset_class: AssetClass | None = rule.condition.params.get("asset_class")
    if asset_class is None:
        return None
    return version.targets.leaves().get(asset_class)


def _band_phrase(leaf: LeafTarget, render_number: Callable[[Decimal], str]) -> str:
    band = Percentage.from_ratio(leaf.tolerance.effective_band(leaf.effective_target))
    if leaf.tolerance.kind is ToleranceKind.ABSOLUTE:
        return f"una banda di ±{render_number(band.value)}pp"
    relative = Percentage.from_ratio(leaf.tolerance.band)
    return (
        f"una banda relativa del {render_number(relative.value)}% del target "
        f"(±{render_number(band.value)}pp)"
    )


def _horizon_phrase(version: StrategyVersion) -> str:
    horizon = version.definition.horizon
    if horizon.years is not None:
        return f"di {horizon.years} anni"
    return f"con scadenza {horizon.target_date:%d/%m/%Y}"


def _input_refs(firing: RuleFiring) -> tuple[str, ...]:
    """Every reference the trace's bindings resolve to, in binding order, deduplicated."""
    seen: dict[str, None] = {}
    for binding in firing.trace.bindings:
        for reference in _refs_of(binding.source):
            seen.setdefault(reference, None)
    return tuple(seen)


def _refs_of(source: SourceRef) -> tuple[str, ...]:
    own = (source.ref,) if source.ref else ()
    return (*own, *source.inputs)
