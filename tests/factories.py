"""Deterministic builders for domain fixtures.

Ids are derived from small integers so that expected values in tests are readable and the
`rule_id ASC` tiebreaks are predictable.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from financeos.core.decision import EvaluationRun
from financeos.core.market import PriceView
from financeos.core.portfolio import Asset, Operation, OperationType
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    EvaluationRunId,
    Money,
    OperationId,
    PortfolioId,
    PriceId,
    Priority,
    Quantity,
    RuleId,
    RunMode,
    Scope,
    StrategyId,
    StrategyVersionId,
    SuggestionClass,
    Weight,
)
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskLevel,
    RiskProfile,
    Rule,
    StrategyDefinition,
    StrategyVersion,
    TargetAllocation,
    TargetNode,
    Tolerance,
    ToleranceKind,
)

AS_OF = date(2026, 3, 12)
NOW = datetime(2026, 3, 12, 9, 30, tzinfo=UTC)
FROZEN_AT = datetime(2026, 3, 1, 8, 0, tzinfo=UTC)
EUR = "EUR"

ACCOUNT = AccountId(UUID(int=1))
PORTFOLIO = PortfolioId(UUID(int=2))
BUCKET = BucketId(UUID(int=3))
STRATEGY = StrategyId(UUID(int=4))
VERSION = StrategyVersionId(UUID(int=5))
RUN = EvaluationRunId(UUID(int=6))
EQUITY = AssetId(UUID(int=10))
BOND = AssetId(UUID(int=11))
BUCKET_SCOPE = Scope.for_bucket(BUCKET)
DIGEST = "0" * 64


def rule_id(n: int) -> RuleId:
    """A readable, ordering-stable rule id."""
    return RuleId(UUID(int=1000 + n))


def money(amount: str, currency: str = EUR) -> Money:
    """A `Money` from a decimal string."""
    return Money(amount=Decimal(amount), currency=currency)


def quantity(amount: str) -> Quantity:
    """A `Quantity` from a decimal string."""
    return Quantity(amount=Decimal(amount))


def weight(value: str) -> Weight:
    """A `Weight` from a decimal string."""
    return Weight(value=Decimal(value))


def asset(
    asset_id: AssetId = EQUITY,
    asset_class: str = "EQUITY_DEVELOPED",
    *,
    name: str = "Sample ETF",
    currency: str = EUR,
) -> Asset:
    """An `Asset` in one taxonomy class."""
    return Asset(id=asset_id, name=name, asset_class=asset_class, currency=currency)


def operation(
    n: int,
    *,
    asset_id: AssetId = EQUITY,
    qty: str = "10",
    price: str = "100",
    op_type: OperationType = OperationType.BUY,
    trade_date: date = date(2026, 1, 15),
    account_id: AccountId = ACCOUNT,
) -> Operation:
    """A settled `Operation`."""
    return Operation(
        id=OperationId(UUID(int=2000 + n)),
        type=op_type,
        account_id=account_id,
        asset_id=asset_id,
        trade_date=trade_date,
        quantity=quantity(qty),
        price=Decimal(price),
        fees=Decimal(0),
        currency=EUR,
        recorded_at=NOW,
    )


def price(
    asset_id: AssetId = EQUITY,
    close: str = "100",
    *,
    n: int = 1,
    valid_date: date = AS_OF,
    currency: str = EUR,
) -> PriceView:
    """A seeded `PriceView`."""
    return PriceView(
        asset_id=asset_id,
        price_id=PriceId(UUID(int=3000 + n)),
        valid_date=valid_date,
        close=Decimal(close),
        currency=currency,
        recorded_at=NOW,
    )


def flat_targets(*specs: tuple[str, str, Tolerance]) -> TargetAllocation:
    """A depth-1 target tree from `(asset_class, weight, tolerance)` triples."""
    return TargetAllocation(
        children=tuple(
            TargetNode(key=asset_class, weight=weight(node_weight), tolerance=tolerance)
            for asset_class, node_weight, tolerance in specs
        )
    )


def absolute(band: str) -> Tolerance:
    """An `ABSOLUTE` tolerance: ±band in percentage points."""
    return Tolerance(kind=ToleranceKind.ABSOLUTE, band=Decimal(band))


def relative(band: str) -> Tolerance:
    """A `RELATIVE` tolerance: ±(band × effective_target)."""
    return Tolerance(kind=ToleranceKind.RELATIVE, band=Decimal(band))


DEMO_TARGETS = flat_targets(
    ("EQUITY_DEVELOPED", "0.4", absolute("0.02")),
    ("BONDS_GOV_EUR", "0.6", absolute("0.05")),
)


def drift_rule(
    n: int = 1,
    *,
    asset_class: str = "EQUITY_DEVELOPED",
    priority: Priority = Priority.HIGH,
    enabled: bool = True,
    scope: Scope = BUCKET_SCOPE,
    message: str | None = None,
    suggestion_class: SuggestionClass = SuggestionClass.CONSIDER_REBALANCE,
) -> Rule:
    """A `Rule` over the skeleton's single condition kind."""
    return Rule(
        id=rule_id(n),
        name=f"{asset_class} fuori tolleranza",
        enabled=enabled,
        priority=priority,
        suggestion_class=suggestion_class,
        message=message
        or (
            "{asset_class_label} è al {current_pct}% contro un target del {target_pct}% "
            "(tolleranza ±{tolerance_pct}pp). Scostamento: {drift_pct}pp."
        ),
        condition=LeafCondition(
            kind="drift_outside_tolerance",
            kind_version=1,
            params={"asset_class": asset_class, "scope": scope.ref},
        ),
    )


def strategy_version(
    *,
    rules: tuple[Rule, ...] = (),
    targets: TargetAllocation | None = None,
    version_id: StrategyVersionId = VERSION,
    name: str = "Crescita di lungo periodo",
    change_note: str = "Prima definizione della strategia.",
    principles: tuple[str, ...] = ("preservare il potere d'acquisto senza fare market timing",),
    horizon_years: int = 20,
) -> StrategyVersion:
    """A frozen `StrategyVersion` carrying targets and embedded rules (ADR-0027)."""
    return StrategyVersion(
        id=version_id,
        strategy_id=STRATEGY,
        definition=StrategyDefinition(
            name=name,
            objective="Preservare e accrescere il capitale su vent'anni.",
            horizon=Horizon(years=horizon_years),
            risk=RiskProfile(level=RiskLevel.BALANCED, principles=principles),
            targets=targets or DEMO_TARGETS,
            rules=rules or (drift_rule(),),
        ),
        change_note=change_note,
        frozen_at=FROZEN_AT,
    )


def evaluation_run(
    *,
    mode: RunMode = RunMode.ACTUAL,
    scope: Scope = BUCKET_SCOPE,
    version_id: StrategyVersionId = VERSION,
    as_of: date = AS_OF,
) -> EvaluationRun:
    """An `EvaluationRun` pinning one frozen version."""
    return EvaluationRun(
        id=RUN,
        portfolio_id=PORTFOLIO,
        strategy_id=STRATEGY,
        strategy_version_id=version_id,
        scope=scope,
        as_of=as_of,
        evaluated_at=NOW,
        mode=mode,
        engine_versions={"portfolio": "1.0.0", "strategy": "1.0.0", "rule": "1.0.0"},
        input_digest=DIGEST,
    )
