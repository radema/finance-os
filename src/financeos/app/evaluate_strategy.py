"""`evaluate_strategy` — the composition point of RFC-0005 §3's sequence diagram.

Wiring order (HANDOFF-2026-07-26 §4.3, from the core implementer): load `sv` **once** ->
`compute_holdings` (for Bucket scope, resolve `VirtualHolding`s and call `.as_holding()`; the
engine takes `Sequence[Holding]` and does not branch on scope) -> `compute_allocation` ->
`compute_drift(allocation, sv.targets, strategy_version_id=sv.id)` -> build `FactSet` ->
compute `input_digest` -> construct `EvaluationRun` -> `evaluate(sv.rules, facts)` ->
`materialize(...)`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from decimal import Decimal

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.decision import (
    UNASSIGNED,
    EvaluationRun,
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
    AssetId,
    Bound,
    BucketId,
    Currency,
    EvaluationRunId,
    Instant,
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
    prices = uow.prices.as_of(asset_ids, as_of=as_of)

    allocation = compute_allocation(
        holdings, assets, prices, scope=scope, as_of=as_of, currency=currency
    )
    comp = compute_drift(allocation, sv.targets, strategy_version_id=sv.id)
    targets_facts = compute_targets(sv.targets, strategy_version_id=sv.id)

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
    if comp.unavailable is not None:
        unavailable["drift"] = comp.unavailable
    if residual_comp.unavailable is not None:
        unavailable["residual"] = residual_comp.unavailable

    facts = FactSet(
        as_of=as_of,
        scope=scope,
        drift=comp.lines,
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

    firings = evaluate(sv.rules, facts)
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
