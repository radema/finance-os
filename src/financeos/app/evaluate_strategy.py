"""`evaluate_strategy` — the composition point of RFC-0005 §3's sequence diagram.

Wiring order (HANDOFF-2026-07-26 §4.3, from the core implementer): load `sv` **once** ->
`compute_holdings` (for Bucket scope, resolve `VirtualHolding`s and call `.as_holding()`; the
engine takes `Sequence[Holding]` and does not branch on scope) -> `compute_allocation` ->
`compute_drift(allocation, sv.targets, strategy_version_id=sv.id)` -> build `FactSet` ->
compute `input_digest` -> construct `EvaluationRun` -> subset `sv.rules` to this call's scope
(ADR-L06) -> `evaluate(rules, facts)` -> `materialize(...)`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from decimal import Decimal
from typing import Final
from uuid import UUID

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.decision import (
    UNASSIGNED,
    ConditionRef,
    EvaluationRun,
    EvaluationTrace,
    RuleFiring,
    Snapshot,
    SnapshotBucketLine,
    SnapshotClassLine,
)
from financeos.core.engines import (
    FactSet,
    MaterializationResult,
    compute_allocation,
    compute_apportionment,
    compute_drift,
    compute_holdings,
    compute_residual,
    compute_targets,
    decision_engine,
    evaluate,
    materialize,
    portfolio_engine,
    rule_engine,
    strategy_engine,
)
from financeos.core.market import PriceView
from financeos.core.portfolio import Asset, Holding, ResidualComputation
from financeos.core.shared import (
    AssetClass,
    AssetId,
    Bound,
    BucketId,
    Currency,
    EvaluationRunId,
    Instant,
    Outcome,
    PortfolioId,
    RunMode,
    Scope,
    ScopeKind,
    SkipReason,
    SnapshotId,
    SourceRef,
    StrategyId,
    canonical_json,
    sha256_hex,
)
from financeos.core.shared.errors import UnknownConditionKindError
from financeos.core.strategy import DriftLine, LeafTarget, Rule, RuleScopeGate
from financeos.ports import Clock, IdGen

#: The two fact families whose value is a function of the governing `StrategyVersion`'s own
#: target tree (`strategy_engine.compute_drift`/`compute_targets`, both take `sv.targets`).
#: Under mixed governance (RFC-0007 §5) neither may carry one arbitrarily-chosen candidate
#: Strategy's numbers — referenced from `rule_engine`'s own constants, not re-typed literals,
#: so the two lists cannot silently drift apart.
_TARGET_TREE_FACT_FAMILIES: Final = (rule_engine.FACT_DRIFT, rule_engine.FACT_TARGETS)

#: Fact families RFC-0006 §4 itself documents as "portfolio-scoped by nature" — today only
#: `residual` (ADR-0029: `unassigned_residual_above` carries no `scope` param because the
#: question was never meaningful per-Bucket). A rule whose *only* required facts fall in this
#: set, and which names no scope any other way, defaults to the Portfolio-scope call rather
#: than every call — the corpus's own reason for removing the param in the first place.
_PORTFOLIO_SCOPED_FACT_FAMILIES: Final = frozenset({rule_engine.FACT_RESIDUAL})


def evaluate_strategy(
    uow: UnitOfWork,
    id_gen: IdGen,
    clock: Clock,
    *,
    scope: Scope,
    as_of: date,
    currency: Currency,
    strategy_id: StrategyId | None = None,
) -> MaterializationResult:
    """Run one evaluation of `scope` at `as_of` and persist its artifacts.

    Args:
        scope: A Bucket (the normal case, ADR-0020) or a Portfolio.
        strategy_id: Required only for `Scope.for_portfolio` — a Portfolio has no single
            governing Strategy the way a Bucket does (`Bucket.strategy_id`).
    """
    now = clock.now()

    # RFC-0007 §5: `scope: portfolio` compares against one target tree, which is only
    # meaningful when every governed Bucket of this Portfolio follows the *same* Strategy
    # (and therefore, since a Strategy has exactly one current version at a time, the same
    # StrategyVersion). Set below, in the Portfolio branch only; `drift` is marked
    # `unavailable` under it rather than averaged (see the `unavailable` assembly below).
    heterogeneous_governance = False

    if scope.kind is ScopeKind.BUCKET:
        bucket = uow.buckets.get(BucketId(scope.id))
        portfolio_id, resolved_strategy_id = bucket.portfolio_id, bucket.strategy_id
        holdings = tuple(
            vh.as_holding()
            for vh in uow.apportionments.virtual_holdings(bucket.id, as_of=as_of)
        )
        # I-9 is a Portfolio-wide invariant (ADR-L04 §4.4): `over_apportioned`'s holdings
        # operand is always the Portfolio-wide fold, never this Bucket's own narrower one
        # (review BLOCKER 2 — a Bucket-scoped run used to skip apportionment entirely).
        portfolio_holdings = compute_holdings(
            uow.operations.for_accounts(uow.portfolios.accounts_of(portfolio_id), as_of=as_of),
            as_of=as_of,
        )
    else:
        if strategy_id is None:
            raise ValueError("evaluate_strategy: strategy_id is required for Portfolio scope")
        portfolio = uow.portfolios.get(PortfolioId(scope.id))
        portfolio_id, resolved_strategy_id = portfolio.id, strategy_id
        account_ids = uow.portfolios.accounts_of(portfolio_id)
        operations = uow.operations.for_accounts(account_ids, as_of=as_of)
        holdings = compute_holdings(operations, as_of=as_of)
        portfolio_holdings = holdings
        heterogeneous_governance = any(
            uow.buckets.get(bucket_id).strategy_id != resolved_strategy_id
            for bucket_id in uow.buckets.for_portfolio(portfolio_id)
        )

    # `over_apportioned` is assembled in every scope (review BLOCKER 2): `compute_apportionment`
    # itself narrows the resolved records to this scope (Bucket vs Portfolio, ADR-L04 §4.4), and
    # the holdings compared against are always the Portfolio-wide fold above. Buckets are
    # filtered to this Portfolio (review MAJOR 3) so a different Portfolio's apportionment chain
    # can never leak into the fold.
    records = [
        record
        for bucket_id in uow.buckets.for_portfolio(portfolio_id)
        for record in uow.apportionments.full_history(bucket_id)
    ]
    lines = compute_apportionment(records, portfolio_holdings, as_of=as_of, scope=scope)
    apportionment = {
        line.asset_id: Bound(value=line, source=SourceRef.derived(engine="portfolio"))
        for line in lines
    }

    sv = uow.strategies.current_version(resolved_strategy_id)

    # The Portfolio-wide holdings' Assets are pulled in alongside scope's own, so the
    # `residual` fact below (portfolio-scoped by nature, ADR-0029) never needs a second
    # repository round trip for Assets/prices `holdings` alone would not have covered.
    asset_ids = {h.asset_id for h in holdings} | {h.asset_id for h in portfolio_holdings}
    assets = uow.assets.get_many(asset_ids)
    prices = uow.prices.price_latest(asset_ids, as_of=as_of)

    allocation = compute_allocation(
        holdings, assets, prices, scope=scope, as_of=as_of, currency=currency
    )
    # BLOCKER 1 (review): under mixed governance neither fact the candidate `sv.targets` feeds
    # may be computed at all — not merely flagged `unavailable` afterward, which a kind that
    # bypasses the `required_facts` precheck (`allocation_absent`'s own per-class `drift:
    # {asset_class}` read, `rule_engine.py:1010-1013`) would never see. Leaving both empty is
    # what makes every consumer fail honestly on its own terms, whichever gate it uses.
    if heterogeneous_governance:
        drift_lines: Mapping[AssetClass, Bound[DriftLine]] = {}
        targets_facts: Mapping[AssetClass, Bound[LeafTarget]] = {}
        drift_unavailable: SkipReason | None = SkipReason.HETEROGENEOUS_STRATEGIES
    else:
        comp = compute_drift(allocation, sv.targets, strategy_version_id=sv.id)
        drift_lines = comp.lines
        targets_facts = compute_targets(sv.targets, strategy_version_id=sv.id)
        drift_unavailable = comp.unavailable

    # `residual` (ADR-0029) is portfolio-scoped by nature — `unassigned_residual_above` has no
    # `scope` param — so it always folds the Portfolio-wide apportionment chain, never the
    # scope-narrowed `lines` above (that narrowing exists only for `over_apportioned`'s
    # `FACT_APPORTIONMENT`, ADR-L04 §4.4).
    portfolio_scope = Scope.for_portfolio(portfolio_id)
    residual_apportionment = compute_apportionment(
        records, portfolio_holdings, as_of=as_of, scope=portfolio_scope
    )
    residual_comp = compute_residual(
        portfolio_holdings, residual_apportionment, assets, prices, as_of=as_of, currency=currency
    )
    residual = None
    if residual_comp.is_available:
        assert residual_comp.residual_weight is not None  # `is_available` guarantees this
        residual = Bound(
            value=residual_comp.residual_weight,
            source=SourceRef.derived(engine="portfolio", inputs=residual_comp.input_refs),
        )

    # `allocation`/`bucket_value` are assembled so `untargeted_allocation` (BLOCKER 1) and
    # `bucket_below_target_value` are actually evaluable in a real run rather than perpetually
    # `SKIPPED(missing_fact)` — `compute_allocation` already computes both, for whichever scope
    # was requested.
    allocation_facts = {
        asset_class: Bound(
            value=line, source=SourceRef.derived(engine="portfolio", inputs=line.input_refs)
        )
        for asset_class, line in allocation.lines.items()
    }
    bucket_value = Bound(value=allocation.total_value, source=SourceRef.derived(engine="portfolio"))

    unavailable: dict[str, SkipReason] = {}
    if heterogeneous_governance:
        # RFC-0007 §5: reuses the Rule Engine's own SKIPPED machinery rather than an average
        # or a special-cased error path. Both target-tree-derived families are marked, not
        # just `drift` — `untargeted_allocation` declares `targets` in its own
        # `required_facts` and would otherwise evaluate against the candidate's tree instead
        # of being gated at all.
        for family in _TARGET_TREE_FACT_FAMILIES:
            unavailable[family] = SkipReason.HETEROGENEOUS_STRATEGIES
    elif drift_unavailable is not None:
        unavailable[rule_engine.FACT_DRIFT] = drift_unavailable
    if residual_comp.unavailable is not None:
        unavailable[rule_engine.FACT_RESIDUAL] = residual_comp.unavailable

    facts = FactSet(
        as_of=as_of,
        scope=scope,
        drift=drift_lines,
        allocation=allocation_facts,
        targets=targets_facts,
        residual=residual,
        bucket_value=bucket_value,
        apportionment=apportionment,
        unavailable=unavailable,
    )

    run = EvaluationRun(
        id=EvaluationRunId(id_gen()),
        portfolio_id=portfolio_id,
        strategy_id=resolved_strategy_id,
        strategy_version_id=sv.id,
        scope=scope,
        as_of=as_of,
        evaluated_at=now,
        mode=RunMode.ACTUAL,
        engine_versions={
            module.ENGINE_NAME: module.ENGINE_VERSION
            for module in (portfolio_engine, strategy_engine, rule_engine, decision_engine)
        },
        input_digest=_input_digest(facts),
    )

    # ADR-L06: `sv.rules` mixes rules meant for every governed Bucket call, rules meant only
    # for the Portfolio-scope call, and rules named to one specific Bucket. The engine takes
    # no scope (C2, RFC-0006 §3.1) — the application layer subsets the rules it hands over.
    # A rule whose own scope reference is malformed or names a Bucket/Portfolio foreign to
    # this one (review SHOULD-FIX 4) is excluded from every call and surfaced as a synthetic
    # `ERROR` firing instead of silently vanishing (ADR-0016).
    known_bucket_ids = frozenset(uow.buckets.for_portfolio(portfolio_id))
    applicable_rules: list[Rule] = []
    placement_error_firings: list[RuleFiring] = []
    for rule in sv.rules:
        error = _placement_error(rule, portfolio_id=portfolio_id, known_bucket_ids=known_bucket_ids)
        if error is not None:
            placement_error_firings.append(_placement_error_firing(rule, error))
            continue
        if _applies_to_this_call(rule, scope):
            applicable_rules.append(rule)

    firings = evaluate(tuple(applicable_rules), facts) + tuple(placement_error_firings)
    result = materialize(firings, sv, run, next_id=id_gen, recorded_at=now)
    snapshot = _build_snapshot(
        uow,
        id_gen,
        portfolio_id=portfolio_id,
        portfolio_holdings=portfolio_holdings,
        portfolio_scope=portfolio_scope,
        assets=assets,
        prices=prices,
        residual_comp=residual_comp,
        as_of=as_of,
        currency=currency,
        run_id=run.id,
        recorded_at=now,
    )
    uow.evaluations.save(run, result.alerts, result.recommendations, snapshot)
    return result


def _named_scope_value(rule: Rule) -> str | None:
    """The one scope-shaped string among `rule.condition.params`'s values, if there is one.

    Every condition kind that names a Bucket or Scope writes it in `Scope.ref` form
    (``"bucket:<uuid>"`` / ``"portfolio:<uuid>"``) — `drift_outside_tolerance`,
    `untargeted_allocation`, `allocation_absent` and `over_apportioned` under the params key
    `"scope"`; `bucket_below_target_value` under the key `"bucket"`
    (`rule_engine.py`'s `BucketBelowTargetValueParams`, review BLOCKER 2). Scanning every
    *value* rather than a hardcoded set of key names is what makes this cover both without
    special-casing either, and covers a future kind using a third key name under the same
    `Scope.ref` convention for free.
    """
    for value in rule.condition.params.values():
        if ":" in value:
            return value
    return None


def _parse_scope_ref(raw: str) -> Scope | None:
    """`raw` parsed as a canonical `Scope` ref, or `None` if it is not one."""
    kind_str, sep, id_str = raw.partition(":")
    if not sep:
        return None
    try:
        return Scope(kind=ScopeKind(kind_str.upper()), id=UUID(id_str))
    except ValueError:
        return None


def _placement_error(
    rule: Rule, *, portfolio_id: PortfolioId, known_bucket_ids: frozenset[BucketId]
) -> str | None:
    """Why `rule` can never be placed in *any* call of this Portfolio's evaluation, or `None`.

    Two authoring defects share this path (review SHOULD-FIX 4): a scope-shaped param that
    fails to parse (malformed — previously fell through to "unconstrained", silently widening
    what the rule sees instead of narrowing it), and one that parses but names a Bucket or
    Portfolio foreign to this one (deleted or moved — previously made the rule vanish from
    every run with no `SKIPPED`/`ERROR` row). ADR-0016: an unplaceable rule must show up on the
    run-health panel, not disappear.

    An explicit `scope_gate` is never a defect, whatever it names — this only inspects the
    condition-level inference `_applies_to_this_call` falls back to.
    """
    if rule.scope_gate is not None:
        return None
    raw = _named_scope_value(rule)
    if raw is None:
        return None
    parsed = _parse_scope_ref(raw)
    if parsed is None:
        return f"condition.params names an unparseable scope reference: {raw!r}"
    if parsed.kind is ScopeKind.PORTFOLIO and PortfolioId(parsed.id) != portfolio_id:
        return f"condition.params names a different Portfolio ({parsed.id})"
    if parsed.kind is ScopeKind.BUCKET and BucketId(parsed.id) not in known_bucket_ids:
        return f"condition.params names a Bucket not governed by this Portfolio ({parsed.id})"
    return None


def _placement_error_firing(rule: Rule, message: str) -> RuleFiring:
    """A synthetic `ERROR` firing for a rule this call could never place (ADR-0016).

    Built here in the app layer — `rule_engine.evaluate` never sees a rule excluded before it
    is called — with the same `RuleFiring`/`EvaluationTrace` shape `rule_engine._errored`
    builds for an evaluator defect, so it renders identically on the run health panel.
    """
    reference = ConditionRef(
        kind=rule.condition.kind,
        kind_version=rule.condition.kind_version,
        params=dict(rule.condition.params),
    )
    return RuleFiring(
        rule_id=rule.id,
        priority=rule.priority,
        outcome=Outcome.ERROR,
        error=message,
        trace=EvaluationTrace(condition=reference, outcome=Outcome.ERROR, error=message),
    )


def _default_scope_gate(rule: Rule) -> RuleScopeGate | None:
    """The Portfolio-scope default a rule's condition *kind* carries by construction, if any.

    `unassigned_residual_above`'s sole required fact is `residual`, which RFC-0006 §4 itself
    documents as portfolio-scoped by nature — ADR-0029 removed `scope` from its params for
    exactly this reason, so there is no per-call authored intent to read (review SHOULD-FIX 5).
    Derived from the registry's declared `required_facts` against the small, documented set of
    portfolio-scoped-by-nature families, rather than the kind's name, so a future kind sharing
    the same fact family gets the same default with no second edit here.
    """
    try:
        spec = rule_engine.REGISTRY.get(rule.condition.kind, rule.condition.kind_version)
    except UnknownConditionKindError:
        return None
    if spec.required_facts and spec.required_facts <= _PORTFOLIO_SCOPED_FACT_FAMILIES:
        return RuleScopeGate(kind=ScopeKind.PORTFOLIO)
    return None


def _applies_to_this_call(rule: Rule, scope: Scope) -> bool:
    """ADR-L06: whether `rule` is meant to evaluate in this `scope`'s call.

    An explicit `scope_gate` wins (§4.1). Otherwise a parseable scope-shaped value among
    `condition.params` narrows the rule to that exact scope (§4.2, review BLOCKER 2). Absent
    both, a kind whose required facts are portfolio-scoped by nature defaults to the
    Portfolio call (§4.5, ADR-0029, review SHOULD-FIX 5). With none of the three, the rule is
    unconstrained — it applies to whichever call it is given, preserving every rule's
    behaviour from before ADR-L06.

    Callers must run `_placement_error` first: a rule with a malformed or foreign scope
    reference is excluded from every call before this function is ever asked about it.
    """
    if rule.scope_gate is not None:
        return rule.scope_gate.applies_to(scope)
    raw = _named_scope_value(rule)
    if raw is not None:
        condition_scope = _parse_scope_ref(raw)
        if condition_scope is not None:
            return condition_scope == scope
    default_gate = _default_scope_gate(rule)
    if default_gate is not None:
        return default_gate.applies_to(scope)
    return True


def _build_snapshot(
    uow: UnitOfWork,
    id_gen: IdGen,
    *,
    portfolio_id: PortfolioId,
    portfolio_holdings: Sequence[Holding],
    portfolio_scope: Scope,
    assets: Mapping[AssetId, Asset],
    prices: Mapping[AssetId, PriceView],
    residual_comp: ResidualComputation,
    as_of: date,
    currency: Currency,
    run_id: EvaluationRunId,
    recorded_at: Instant,
) -> Snapshot:
    """Build the Portfolio-wide checkpoint written on every evaluate (RFC-0009 §5.1).

    Reuses the Portfolio-wide `holdings`/`assets`/`prices` and `residual_comp` the caller
    already assembled for the `residual` fact — a Snapshot is the same valuation, just kept
    rather than discarded after the rules run.
    """
    portfolio_allocation = compute_allocation(
        portfolio_holdings, assets, prices, scope=portfolio_scope, as_of=as_of, currency=currency
    )
    total = portfolio_allocation.total_value.amount

    classes = {
        asset_class: SnapshotClassLine(value=line.value.amount, weight=line.weight.value)
        for asset_class, line in portfolio_allocation.lines.items()
    }

    buckets: dict[str, SnapshotBucketLine] = {}
    for bucket_id in uow.buckets.for_portfolio(portfolio_id):
        bucket_holdings = tuple(
            vh.as_holding() for vh in uow.apportionments.virtual_holdings(bucket_id, as_of=as_of)
        )
        bucket_allocation = compute_allocation(
            bucket_holdings,
            assets,
            prices,
            scope=Scope.for_bucket(bucket_id),
            as_of=as_of,
            currency=currency,
        )
        bucket_value = bucket_allocation.total_value.amount
        buckets[str(bucket_id)] = SnapshotBucketLine(
            value=bucket_value, weight=_share(bucket_value, total)
        )

    if residual_comp.is_available:
        assert residual_comp.residual_weight is not None  # `is_available` guarantees this
        buckets[UNASSIGNED] = SnapshotBucketLine(
            value=residual_comp.unassigned_value.amount, weight=residual_comp.residual_weight
        )

    return Snapshot(
        id=SnapshotId(id_gen()),
        portfolio_id=portfolio_id,
        as_of=as_of,
        run_id=run_id,
        total_value=total,
        currency=currency,
        allocation=classes,
        by_bucket=buckets,
        recorded_at=recorded_at,
    )


def _share(value: Decimal, total: Decimal) -> Decimal:
    """`value / total`, or zero when the Portfolio has no value."""
    return Decimal(0) if total == 0 else value / total


def _input_digest(facts: FactSet) -> str:
    """SHA-256 over the canonical bound facts, excluding `source`/`observed_at` (RFC-0006 §10).

    Reading `bound.value` rather than the `Bound` wrapper is what excludes provenance: a
    `DriftLine`'s own fields carry no `source`/`observed_at` member.
    """
    payload = {
        "as_of": facts.as_of.isoformat(),
        "scope": {"kind": facts.scope.kind.value, "id": str(facts.scope.id)},
        "drift": {
            asset_class: bound.value.model_dump(mode="json")
            for asset_class, bound in facts.drift.items()
        },
        "allocation": {
            asset_class: bound.value.model_dump(mode="json")
            for asset_class, bound in facts.allocation.items()
        },
        "targets": {
            asset_class: bound.value.model_dump(mode="json")
            for asset_class, bound in facts.targets.items()
        },
        "residual": facts.residual.value if facts.residual is not None else None,
        "bucket_value": (
            facts.bucket_value.value.model_dump(mode="json")
            if facts.bucket_value is not None
            else None
        ),
        "apportionment": {
            str(asset_id): bound.value.model_dump(mode="json")
            for asset_id, bound in facts.apportionment.items()
        },
        "unavailable": {family: reason.value for family, reason in facts.unavailable.items()},
    }
    return sha256_hex(canonical_json(payload))
