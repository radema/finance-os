"""`evaluate_strategy` — the composition point of RFC-0005 §3's sequence diagram.

Wiring order (HANDOFF-2026-07-26 §4.3, from the core implementer): load `sv` **once** ->
`compute_holdings` (for Bucket scope, resolve `VirtualHolding`s and call `.as_holding()`; the
engine takes `Sequence[Holding]` and does not branch on scope) -> `compute_allocation` ->
`compute_drift(allocation, sv.targets, strategy_version_id=sv.id)` -> build `FactSet` ->
compute `input_digest` -> construct `EvaluationRun` -> `evaluate(sv.rules, facts)` ->
`materialize(...)`.
"""

from __future__ import annotations

from datetime import date

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.decision import EvaluationRun
from financeos.core.engines import (
    FactSet,
    MaterializationResult,
    compute_allocation,
    compute_drift,
    compute_holdings,
    decision_engine,
    evaluate,
    materialize,
    portfolio_engine,
    rule_engine,
    strategy_engine,
)
from financeos.core.shared import (
    BucketId,
    Currency,
    EvaluationRunId,
    PortfolioId,
    RunMode,
    Scope,
    ScopeKind,
    StrategyId,
    canonical_json,
    sha256_hex,
)
from financeos.ports import Clock, IdGen


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

    if scope.kind is ScopeKind.BUCKET:
        bucket = uow.buckets.get(BucketId(scope.id))
        portfolio_id, resolved_strategy_id = bucket.portfolio_id, bucket.strategy_id
        holdings = tuple(
            vh.as_holding()
            for vh in uow.apportionments.virtual_holdings(bucket.id, as_of=as_of)
        )
    else:
        if strategy_id is None:
            raise ValueError("evaluate_strategy: strategy_id is required for Portfolio scope")
        portfolio = uow.portfolios.get(PortfolioId(scope.id))
        portfolio_id, resolved_strategy_id = portfolio.id, strategy_id
        account_ids = uow.portfolios.accounts_of(portfolio_id)
        operations = uow.operations.for_accounts(account_ids, as_of=as_of)
        holdings = compute_holdings(operations, as_of=as_of)

    sv = uow.strategies.current_version(resolved_strategy_id)

    asset_ids = {h.asset_id for h in holdings}
    assets = uow.assets.get_many(asset_ids)
    prices = uow.prices.as_of(asset_ids, as_of=as_of)

    allocation = compute_allocation(
        holdings, assets, prices, scope=scope, as_of=as_of, currency=currency
    )
    comp = compute_drift(allocation, sv.targets, strategy_version_id=sv.id)

    facts = FactSet(
        as_of=as_of,
        scope=scope,
        drift=comp.lines,
        unavailable={"drift": comp.unavailable} if comp.unavailable else {},
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

    firings = evaluate(sv.rules, facts)
    result = materialize(firings, sv, run, next_id=id_gen, recorded_at=now)
    uow.evaluations.save(run, result.alerts, result.recommendations)
    return result


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
        "unavailable": {family: reason.value for family, reason in facts.unavailable.items()},
    }
    return sha256_hex(canonical_json(payload))
