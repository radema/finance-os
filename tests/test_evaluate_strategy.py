"""`evaluate_strategy` — full-pipeline coverage for review BLOCKER 2 / MAJOR 3.

Both defects only manifest through the real wiring (`compute_apportionment` called against the
real repositories, `uow.buckets.for_portfolio` filtering) — `tests/test_rule_engine_v1_kinds.py`
constructs a `FactSet` by hand and cannot exercise either. These tests run a real
`DuckDBUnitOfWork` end to end instead.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest
from pydantic import ValidationError

from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.core.portfolio import Asset, Bucket, Operation, OperationType, Portfolio
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    OperationId,
    Outcome,
    PortfolioId,
    Priority,
    Quantity,
    RuleId,
    Scope,
    ScopeKind,
    SkipReason,
    StrategyId,
    StrategyVersionId,
    SuggestionClass,
)
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskLevel,
    RiskProfile,
    Rule,
    RuleScopeGate,
    StrategyDefinition,
    StrategyVersion,
)
from financeos.ports import AccountInfo
from tests import factories as f

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "financeos"
    / "adapters"
    / "duckdb"
    / "migrations"
    / "001_init.sql"
)

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
TRADE_DATE = date(2026, 1, 1)
AS_OF = date(2026, 3, 1)
FUND = AssetId(UUID(int=900))
CASH_EUR = AssetId(UUID(int=901))


class _FixedClock:
    def now(self) -> datetime:
        return NOW


class _CountingIdGen:
    """Deterministic, collision-free ids for materialize()'s `next_id`."""

    def __init__(self, start: int) -> None:
        self._n = start

    def __call__(self) -> UUID:
        self._n += 1
        return UUID(int=self._n)


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute("SET TimeZone='UTC'")
    connection.execute(MIGRATION_PATH.read_text())
    yield connection
    connection.close()


@pytest.fixture
def uow(con: duckdb.DuckDBPyConnection) -> DuckDBUnitOfWork:
    unit = DuckDBUnitOfWork(con)
    unit.assets.add(Asset(id=FUND, name="Fund", asset_class="EQUITY_DEVELOPED", currency="EUR"))
    unit.assets.add(Asset(id=CASH_EUR, name="Cash EUR", asset_class="CASH", currency="EUR"))
    unit.prices.add(
        uuid4(),
        FUND,
        valid_date=AS_OF,
        close="1",
        currency="EUR",
        source="seed",
        recorded_at=NOW,
    )
    unit.prices.add(
        uuid4(),
        CASH_EUR,
        valid_date=AS_OF,
        close="1",
        currency="EUR",
        source="seed",
        recorded_at=NOW,
    )
    return unit


def _buy_fund(*, account_id: AccountId, quantity: str) -> tuple[Operation, Operation]:
    """A funded `BUY` of `FUND` plus its required cash leg (W1/W2)."""
    primary = Operation(
        id=OperationId(uuid4()),
        type=OperationType.BUY,
        account_id=account_id,
        asset_id=FUND,
        trade_date=TRADE_DATE,
        quantity=Quantity(amount=Decimal(quantity)),
        price=Decimal("1"),
        fees=Decimal(0),
        currency="EUR",
        recorded_at=NOW,
    )
    leg = Operation(
        id=OperationId(uuid4()),
        type=OperationType.BUY,
        account_id=account_id,
        asset_id=CASH_EUR,
        trade_date=TRADE_DATE,
        quantity=Quantity(amount=-Decimal(quantity)),
        price=Decimal("1"),
        fees=Decimal(0),
        currency="EUR",
        cash_leg_of=primary.id,
        recorded_at=NOW,
    )
    return primary, leg


def _over_apportioned_rule(scope: Scope) -> Rule:
    return Rule(
        id=RuleId(UUID(int=1)),
        name="Sovra-apportionment",
        priority=Priority.HIGH,
        suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
        message="sovra-apportionment",
        condition=LeafCondition(
            kind="over_apportioned", kind_version=1, params={"scope": scope.ref}
        ),
    )


def _strategy_version(
    *, strategy_id: StrategyId, version_id: StrategyVersionId, rules: tuple[Rule, ...]
) -> StrategyVersion:
    targets = f.flat_targets(("EQUITY_DEVELOPED", "1.0", f.absolute("0.5")))
    return StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        definition=StrategyDefinition(
            name="Test strategy",
            horizon=Horizon(years=10),
            risk=RiskProfile(level=RiskLevel.BALANCED),
            targets=targets,
            rules=rules,
        ),
        change_note="seed",
        frozen_at=NOW,
    )


def _setup_portfolio(
    uow: DuckDBUnitOfWork,
    *,
    portfolio_id: PortfolioId,
    strategy_id: StrategyId,
    fund_holding: str,
) -> AccountId:
    account_id = AccountId(uuid4())
    uow.accounts.add(
        AccountInfo(id=account_id, cash_asset_id=CASH_EUR, currency="EUR"),
        name="Main",
        type_="BROKERAGE",
    )
    uow.portfolios.add(Portfolio(id=portfolio_id, name="P", accounts=(account_id,)))
    uow.strategies.ensure_strategy(strategy_id, name="S")
    primary, leg = _buy_fund(account_id=account_id, quantity=fund_holding)
    uow.operations.write([primary, leg], import_batch_id=uuid4())
    return account_id


class TestBucketScopedOverApportioned:
    """BLOCKER 2 (review): a Bucket-scoped `over_apportioned` rule must fire/evaluate, not
    silently `NOT_FIRED` via an unwired, always-empty `apportionment` fact."""

    def test_fires_using_the_bucket_s_own_apportionment_chain(
        self, uow: DuckDBUnitOfWork
    ) -> None:
        portfolio_id = PortfolioId(uuid4())
        strategy_id = StrategyId(uuid4())
        bucket_id = BucketId(uuid4())
        _setup_portfolio(
            uow, portfolio_id=portfolio_id, strategy_id=strategy_id, fund_holding="46"
        )
        uow.buckets.add(
            Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
        )
        uow.apportionments.apportion(
            uuid4(),
            bucket_id,
            FUND,
            Quantity(amount=Decimal("53")),
            effective_from=TRADE_DATE,
            recorded_at=NOW,
        )
        scope = Scope.for_bucket(bucket_id)
        version = _strategy_version(
            strategy_id=strategy_id,
            version_id=StrategyVersionId(uuid4()),
            rules=(_over_apportioned_rule(scope),),
        )
        uow.strategies.freeze_version(version)

        result = evaluate_strategy(
            uow, _CountingIdGen(0), _FixedClock(), scope=scope, as_of=AS_OF, currency="EUR"
        )

        (alert,) = result.alerts
        assert alert.outcome is Outcome.FIRED
        # UX-0001 §8.2 / ADR-L04 §4.1: 53 committed against 46 held -> 1.13207547.
        assert alert.severity == Decimal("1.13207547")


class TestCrossPortfolioApportionmentLeakage:
    """MAJOR 3 (review): a second Portfolio's `bucket_apportionment` chain must never enter
    the fold of the Portfolio actually being evaluated."""

    def test_a_second_portfolio_s_apportionment_does_not_leak_in(
        self, uow: DuckDBUnitOfWork
    ) -> None:
        portfolio_id = PortfolioId(uuid4())
        strategy_id = StrategyId(uuid4())
        bucket_id = BucketId(uuid4())
        _setup_portfolio(
            uow, portfolio_id=portfolio_id, strategy_id=strategy_id, fund_holding="46"
        )
        uow.buckets.add(
            Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
        )
        uow.apportionments.apportion(
            uuid4(),
            bucket_id,
            FUND,
            Quantity(amount=Decimal("53")),
            effective_from=TRADE_DATE,
            recorded_at=NOW,
        )

        # A second, unrelated Portfolio with its own Bucket, apportioning a large quantity of
        # the *same* Asset. If `evaluate_strategy` ever goes back to an unfiltered
        # `uow.buckets.all_ids()`, this row leaks into Portfolio 1's fold and its severity
        # is no longer 1.13207547.
        other_portfolio_id = PortfolioId(uuid4())
        other_strategy_id = StrategyId(uuid4())
        other_bucket_id = BucketId(uuid4())
        _setup_portfolio(
            uow,
            portfolio_id=other_portfolio_id,
            strategy_id=other_strategy_id,
            fund_holding="1000",
        )
        uow.buckets.add(
            Bucket(
                id=other_bucket_id,
                portfolio_id=other_portfolio_id,
                strategy_id=other_strategy_id,
                name="B2",
            )
        )
        uow.apportionments.apportion(
            uuid4(),
            other_bucket_id,
            FUND,
            Quantity(amount=Decimal("999")),
            effective_from=TRADE_DATE,
            recorded_at=NOW,
        )

        scope = Scope.for_portfolio(portfolio_id)
        version = _strategy_version(
            strategy_id=strategy_id,
            version_id=StrategyVersionId(uuid4()),
            rules=(_over_apportioned_rule(scope),),
        )
        uow.strategies.freeze_version(version)

        result = evaluate_strategy(
            uow,
            _CountingIdGen(0),
            _FixedClock(),
            scope=scope,
            as_of=AS_OF,
            currency="EUR",
            strategy_id=strategy_id,
        )

        (alert,) = result.alerts
        assert alert.outcome is Outcome.FIRED
        assert alert.severity == Decimal("1.13207547")


GLOBAL_FUND = AssetId(UUID(int=910))


def _residual_rule() -> Rule:
    return Rule(
        id=RuleId(UUID(int=2)),
        name="Capitale non apportionato",
        priority=Priority.MEDIUM,
        suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
        message="residuo",
        condition=LeafCondition(
            kind="unassigned_residual_above", kind_version=1, params={"threshold_weight": "0.05"}
        ),
    )


def _untargeted_allocation_rule(scope: Scope) -> Rule:
    return Rule(
        id=RuleId(UUID(int=3)),
        name="Classe non targettizzata",
        priority=Priority.HIGH,
        suggestion_class=SuggestionClass.REVIEW_STRATEGY,
        message="non targettizzato",
        condition=LeafCondition(
            kind="untargeted_allocation",
            kind_version=1,
            params={"scope": scope.ref, "threshold_weight": "0.05"},
        ),
    )


class TestResidualAndTargetsWiring:
    """ADR-0029 / ADR-L05 §5: `residual` and `targets` are real fact producers in a real run,
    not perpetual `SKIPPED(missing_fact)` (review M1/M2). Also exercises multiple `Bucket`s
    apportioning distinct Assets of one Portfolio (RFC-0010:123) and the `Snapshot` written
    alongside (RFC-0009 §5.1)."""

    def test_unassigned_residual_and_untargeted_allocation_fire(
        self, uow: DuckDBUnitOfWork, con: duckdb.DuckDBPyConnection
    ) -> None:
        portfolio_id = PortfolioId(uuid4())
        strategy_id = StrategyId(uuid4())
        bucket_id = BucketId(uuid4())
        account_id = AccountId(uuid4())
        uow.accounts.add(
            AccountInfo(id=account_id, cash_asset_id=CASH_EUR, currency="EUR"),
            name="Main",
            type_="BROKERAGE",
        )
        uow.portfolios.add(Portfolio(id=portfolio_id, name="P", accounts=(account_id,)))
        uow.strategies.ensure_strategy(strategy_id, name="S")

        # An external counterparty account, only to satisfy W4's two-sided TRANSFER pair —
        # never added to this Portfolio, so it never enters its holdings fold.
        external_account_id = AccountId(uuid4())
        uow.accounts.add(
            AccountInfo(id=external_account_id, cash_asset_id=CASH_EUR, currency="EUR"),
            name="External",
            type_="BROKERAGE",
        )

        uow.assets.add(
            Asset(id=GLOBAL_FUND, name="Global Fund", asset_class="EQUITY_GLOBAL", currency="EUR")
        )
        uow.prices.add(
            uuid4(),
            GLOBAL_FUND,
            valid_date=AS_OF,
            close="1",
            currency="EUR",
            source="seed",
            recorded_at=NOW,
        )
        transfer_pair_id = uuid4()
        fund_buy_id = OperationId(uuid4())
        global_fund_buy_id = OperationId(uuid4())
        # A 500 EUR deposit, funded from the external account, leaves 350 EUR CASH on hand
        # after the two BUYs below — a nonzero Portfolio value with no CASH class dilution
        # to reason about in the assertions.
        uow.operations.write(
            [
                Operation(
                    id=OperationId(uuid4()),
                    type=OperationType.TRANSFER_IN,
                    account_id=account_id,
                    asset_id=CASH_EUR,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("500")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    transfer_pair_id=transfer_pair_id,
                    recorded_at=NOW,
                ),
                Operation(
                    id=OperationId(uuid4()),
                    type=OperationType.TRANSFER_OUT,
                    account_id=external_account_id,
                    asset_id=CASH_EUR,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("-500")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    transfer_pair_id=transfer_pair_id,
                    recorded_at=NOW,
                ),
                Operation(
                    id=fund_buy_id,
                    type=OperationType.BUY,
                    account_id=account_id,
                    asset_id=FUND,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("100")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    recorded_at=NOW,
                ),
                Operation(
                    id=OperationId(uuid4()),
                    type=OperationType.BUY,
                    account_id=account_id,
                    asset_id=CASH_EUR,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("-100")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    cash_leg_of=fund_buy_id,
                    recorded_at=NOW,
                ),
                Operation(
                    id=global_fund_buy_id,
                    type=OperationType.BUY,
                    account_id=account_id,
                    asset_id=GLOBAL_FUND,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("50")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    recorded_at=NOW,
                ),
                Operation(
                    id=OperationId(uuid4()),
                    type=OperationType.BUY,
                    account_id=account_id,
                    asset_id=CASH_EUR,
                    trade_date=TRADE_DATE,
                    quantity=Quantity(amount=Decimal("-50")),
                    price=Decimal("1"),
                    fees=Decimal(0),
                    currency="EUR",
                    cash_leg_of=global_fund_buy_id,
                    recorded_at=NOW,
                ),
            ],
            import_batch_id=uuid4(),
        )

        bucket_id_2 = BucketId(uuid4())
        uow.buckets.add(
            Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
        )
        uow.buckets.add(
            Bucket(id=bucket_id_2, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B2")
        )
        # Two Buckets apportion two distinct Assets of the same Portfolio (RFC-0010:123):
        # 60 of the 100 FUND units to B, 30 of the 50 GLOBAL_FUND units to B2. CASH and the
        # rest are apportioned to nothing -> 410 of 500 total value (82%) is UNASSIGNED.
        uow.apportionments.apportion(
            uuid4(),
            bucket_id,
            FUND,
            Quantity(amount=Decimal("60")),
            effective_from=TRADE_DATE,
            recorded_at=NOW,
        )
        uow.apportionments.apportion(
            uuid4(),
            bucket_id_2,
            GLOBAL_FUND,
            Quantity(amount=Decimal("30")),
            effective_from=TRADE_DATE,
            recorded_at=NOW,
        )

        scope = Scope.for_portfolio(portfolio_id)
        residual_rule = _residual_rule()
        untargeted_rule = _untargeted_allocation_rule(scope)
        version = _strategy_version(
            strategy_id=strategy_id,
            version_id=StrategyVersionId(uuid4()),
            rules=(residual_rule, untargeted_rule),
        )
        uow.strategies.freeze_version(version)

        result = evaluate_strategy(
            uow,
            _CountingIdGen(0),
            _FixedClock(),
            scope=scope,
            as_of=AS_OF,
            currency="EUR",
            strategy_id=strategy_id,
        )

        by_rule = {alert.rule_id: alert for alert in result.alerts}
        assert by_rule[residual_rule.id].outcome is Outcome.FIRED
        assert by_rule[untargeted_rule.id].outcome is Outcome.FIRED
        # 410/500 = 0.82 residual weight against a 0.05 threshold -> severity 16.40.
        assert by_rule[residual_rule.id].severity == Decimal("16.40000000")
        # Worst untargeted class is CASH at 350/500 = 0.70 against a 0.05 threshold -> 14.00.
        assert by_rule[untargeted_rule.id].severity == Decimal("14.00000000")

        # `Snapshot` (RFC-0009 §5.1): written on this same evaluate, sharing its run_id.
        run_id = str(by_rule[residual_rule.id].run_id)
        row = con.cursor().execute(
            "SELECT portfolio_id, total_value, currency, allocation, by_bucket "
            "FROM snapshot WHERE run_id = ?",
            [run_id],
        ).fetchone()
        assert row is not None
        assert row[0] == str(portfolio_id)
        assert row[1] == Decimal("500.0000")
        assert row[2] == "EUR"
        allocation = json.loads(row[3])
        assert allocation["CASH"]["value"] == "350.0000"
        assert allocation["CASH"]["weight"] == "0.70000000"
        assert allocation["EQUITY_GLOBAL"]["value"] == "50.0000"
        assert allocation["EQUITY_DEVELOPED"]["value"] == "100.0000"
        by_bucket = json.loads(row[4])
        assert by_bucket[str(bucket_id)]["value"] == "60.0000"
        assert by_bucket[str(bucket_id_2)]["value"] == "30.0000"
        assert by_bucket["UNASSIGNED"]["value"] == "410.0000"
        assert by_bucket["UNASSIGNED"]["weight"] == "0.82000000"


class TestBucketRepositoryForPortfolio:
    """MAJOR 3 (review): the new port method itself, at the DuckDB adapter level."""

    def test_returns_only_buckets_of_the_given_portfolio(self, uow: DuckDBUnitOfWork) -> None:
        p1, p2 = PortfolioId(uuid4()), PortfolioId(uuid4())
        s1, s2 = StrategyId(uuid4()), StrategyId(uuid4())
        uow.portfolios.add(Portfolio(id=p1, name="P1"))
        uow.portfolios.add(Portfolio(id=p2, name="P2"))
        uow.strategies.ensure_strategy(s1, name="S1")
        uow.strategies.ensure_strategy(s2, name="S2")
        b1, b2, b3 = BucketId(uuid4()), BucketId(uuid4()), BucketId(uuid4())
        uow.buckets.add(Bucket(id=b1, portfolio_id=p1, strategy_id=s1, name="B1"))
        uow.buckets.add(Bucket(id=b2, portfolio_id=p1, strategy_id=s1, name="B2"))
        uow.buckets.add(Bucket(id=b3, portfolio_id=p2, strategy_id=s2, name="B3"))

        assert set(uow.buckets.for_portfolio(p1)) == {b1, b2}
        assert set(uow.buckets.for_portfolio(p2)) == {b3}


class TestRuleScopeGateModel:
    """ADR-L06 §4.1: `RuleScopeGate.applies_to` and its construction guard, pure and DB-free."""

    def test_any_bucket_applies_to_every_bucket_but_not_portfolio(self) -> None:
        gate = RuleScopeGate(kind=ScopeKind.BUCKET)
        assert gate.applies_to(Scope.for_bucket(BucketId(uuid4())))
        assert not gate.applies_to(Scope.for_portfolio(PortfolioId(uuid4())))

    def test_named_bucket_applies_only_to_that_bucket(self) -> None:
        bucket_id = BucketId(uuid4())
        gate = RuleScopeGate(kind=ScopeKind.BUCKET, bucket_id=bucket_id)
        assert gate.applies_to(Scope.for_bucket(bucket_id))
        assert not gate.applies_to(Scope.for_bucket(BucketId(uuid4())))
        assert not gate.applies_to(Scope.for_portfolio(PortfolioId(uuid4())))

    def test_portfolio_applies_only_to_portfolio_scope(self) -> None:
        portfolio_id = PortfolioId(uuid4())
        gate = RuleScopeGate(kind=ScopeKind.PORTFOLIO)
        assert gate.applies_to(Scope.for_portfolio(portfolio_id))
        assert not gate.applies_to(Scope.for_bucket(BucketId(uuid4())))

    def test_bucket_id_rejected_with_portfolio_kind(self) -> None:
        with pytest.raises(ValidationError):
            RuleScopeGate(kind=ScopeKind.PORTFOLIO, bucket_id=BucketId(uuid4()))


class TestRuleScopeGating:
    """ADR-L06: a Rule's `scope_gate` decides which evaluation call(s) it subsets into.

    `unassigned_residual_above` carries no `condition.params["scope"]` to infer a gate from
    (ADR-0029), so an explicit `scope_gate` is the only way to narrow it — exactly the case
    §4.2 leaves to §4.1's override.
    """

    def test_bucket_gated_and_portfolio_gated_rules_are_mutually_exclusive(
        self, uow: DuckDBUnitOfWork
    ) -> None:
        portfolio_id = PortfolioId(uuid4())
        strategy_id = StrategyId(uuid4())
        bucket_id = BucketId(uuid4())
        _setup_portfolio(
            uow, portfolio_id=portfolio_id, strategy_id=strategy_id, fund_holding="100"
        )
        uow.buckets.add(
            Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
        )

        bucket_rule = Rule(
            id=RuleId(UUID(int=10)),
            name="Solo Bucket",
            priority=Priority.MEDIUM,
            suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
            message="bucket-only",
            condition=LeafCondition(
                kind="unassigned_residual_above",
                kind_version=1,
                params={"threshold_weight": "0.05"},
            ),
            scope_gate=RuleScopeGate(kind=ScopeKind.BUCKET, bucket_id=bucket_id),
        )
        portfolio_rule = Rule(
            id=RuleId(UUID(int=11)),
            name="Solo Portfolio",
            priority=Priority.MEDIUM,
            suggestion_class=SuggestionClass.REVIEW_BUCKET_ASSIGNMENT,
            message="portfolio-only",
            condition=LeafCondition(
                kind="unassigned_residual_above",
                kind_version=1,
                params={"threshold_weight": "0.05"},
            ),
            scope_gate=RuleScopeGate(kind=ScopeKind.PORTFOLIO),
        )
        version = _strategy_version(
            strategy_id=strategy_id,
            version_id=StrategyVersionId(uuid4()),
            rules=(bucket_rule, portfolio_rule),
        )
        uow.strategies.freeze_version(version)

        bucket_result = evaluate_strategy(
            uow,
            _CountingIdGen(0),
            _FixedClock(),
            scope=Scope.for_bucket(bucket_id),
            as_of=AS_OF,
            currency="EUR",
        )
        assert {alert.rule_id for alert in bucket_result.alerts} == {bucket_rule.id}

        portfolio_result = evaluate_strategy(
            uow,
            _CountingIdGen(100),
            _FixedClock(),
            scope=Scope.for_portfolio(portfolio_id),
            as_of=AS_OF,
            currency="EUR",
            strategy_id=strategy_id,
        )
        assert {alert.rule_id for alert in portfolio_result.alerts} == {portfolio_rule.id}


class TestHeterogeneousGovernance:
    """RFC-0007 §5: Portfolio-scope drift is `SKIPPED(heterogeneous_strategies)`, never an
    average, when the governed Buckets follow different Strategies."""

    def test_portfolio_scope_drift_skips_under_mixed_governance(
        self, uow: DuckDBUnitOfWork
    ) -> None:
        portfolio_id = PortfolioId(uuid4())
        strategy_id_a = StrategyId(uuid4())
        strategy_id_b = StrategyId(uuid4())
        bucket_a = BucketId(uuid4())
        bucket_b = BucketId(uuid4())

        _setup_portfolio(
            uow, portfolio_id=portfolio_id, strategy_id=strategy_id_a, fund_holding="50"
        )
        uow.strategies.ensure_strategy(strategy_id_b, name="S2")
        uow.buckets.add(
            Bucket(id=bucket_a, portfolio_id=portfolio_id, strategy_id=strategy_id_a, name="A")
        )
        uow.buckets.add(
            Bucket(id=bucket_b, portfolio_id=portfolio_id, strategy_id=strategy_id_b, name="B")
        )

        scope = Scope.for_portfolio(portfolio_id)
        drift_rule = Rule(
            id=RuleId(UUID(int=20)),
            name="Drift portafoglio",
            priority=Priority.HIGH,
            suggestion_class=SuggestionClass.CONSIDER_REBALANCE,
            message="drift",
            condition=LeafCondition(
                kind="drift_outside_tolerance",
                kind_version=1,
                params={"asset_class": "EQUITY_DEVELOPED", "scope": scope.ref},
            ),
        )
        version = _strategy_version(
            strategy_id=strategy_id_a,
            version_id=StrategyVersionId(uuid4()),
            rules=(drift_rule,),
        )
        uow.strategies.freeze_version(version)

        result = evaluate_strategy(
            uow,
            _CountingIdGen(0),
            _FixedClock(),
            scope=scope,
            as_of=AS_OF,
            currency="EUR",
            strategy_id=strategy_id_a,
        )

        (alert,) = result.alerts
        assert alert.outcome is Outcome.SKIPPED
        assert alert.trace.skip_reason is SkipReason.HETEROGENEOUS_STRATEGIES
