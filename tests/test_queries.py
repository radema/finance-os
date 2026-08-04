"""Read-side query modules over `mv_holding` / `mv_finding` (adapters.duckdb.queries)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest
from click.testing import CliRunner

from financeos.adapters.duckdb.queries.dashboard import (
    aggregate_outcome_counts,
    bucket_findings_states,
)
from financeos.adapters.duckdb.queries.findings import list_findings
from financeos.adapters.duckdb.queries.holdings import list_holdings
from financeos.adapters.duckdb.queries.runs import latest_actual_run_for_scope
from financeos.adapters.duckdb.queries.snapshots import drift_history
from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.cli import app
from financeos.core.portfolio import Asset, Bucket, Operation, OperationType, Portfolio
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    OperationId,
    PortfolioId,
    Priority,
    Quantity,
    RuleId,
    Scope,
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
    StrategyDefinition,
    StrategyVersion,
)
from financeos.ports import AccountInfo
from tests import factories as f
from tests.test_evaluate_strategy import MIGRATION_PATH

DEMO_PORTFOLIO_ID = "a8283d57-9cc4-5376-8952-1cf4208fcbd7"
DEMO_BUCKET_ID = "44940ba1-0bfd-5d7c-ba07-4d80aefdd508"

_SINGLE_GOV_AS_OF = date(2026, 3, 1)
_SINGLE_GOV_NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


class _FixedClock:
    def now(self) -> datetime:
        return _SINGLE_GOV_NOW


class _CountingIdGen:
    def __init__(self, start: int) -> None:
        self._n = start

    def __call__(self) -> UUID:
        self._n += 1
        return UUID(int=self._n)


@pytest.fixture
def single_governance_con() -> Iterator[duckdb.DuckDBPyConnection]:
    """A single-Bucket, single-Strategy Portfolio — homogeneous governance, so
    `drift_history` can be checked with `target`/`drift` actually populated (ADR-L06 §8.4
    reserves `None` for the *mixed*-governance case only, which the demo fixture now always
    is)."""
    con = duckdb.connect(":memory:")
    con.execute("SET TimeZone='UTC'")
    con.execute(MIGRATION_PATH.read_text())

    uow = DuckDBUnitOfWork(con)
    fund_id = AssetId(UUID(int=9001))
    cash_id = AssetId(UUID(int=9002))
    uow.assets.add(Asset(id=fund_id, name="Fund", asset_class="EQUITY_DEVELOPED", currency="EUR"))
    uow.assets.add(Asset(id=cash_id, name="Cash", asset_class="CASH", currency="EUR"))
    uow.prices.add(
        uuid4(), fund_id, valid_date=_SINGLE_GOV_AS_OF, close="1", currency="EUR",
        source="seed", recorded_at=_SINGLE_GOV_NOW,
    )

    account_id = AccountId(uuid4())
    uow.accounts.add(
        AccountInfo(id=account_id, cash_asset_id=cash_id, currency="EUR"), name="Main",
        type_="BROKERAGE",
    )
    portfolio_id = PortfolioId(uuid4())
    uow.portfolios.add(Portfolio(id=portfolio_id, name="P", accounts=(account_id,)))
    strategy_id = StrategyId(uuid4())
    uow.strategies.ensure_strategy(strategy_id, name="S")
    bucket_id = BucketId(uuid4())
    uow.buckets.add(
        Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
    )

    primary_id = OperationId(uuid4())
    uow.operations.write(
        [
            Operation(
                id=primary_id, type=OperationType.BUY, account_id=account_id, asset_id=fund_id,
                trade_date=_SINGLE_GOV_AS_OF, quantity=Quantity(amount=Decimal("100")),
                price=Decimal("1"), fees=Decimal(0), currency="EUR", recorded_at=_SINGLE_GOV_NOW,
            ),
            Operation(
                id=OperationId(uuid4()), type=OperationType.BUY, account_id=account_id,
                asset_id=cash_id, trade_date=_SINGLE_GOV_AS_OF,
                quantity=Quantity(amount=Decimal("-100")), price=Decimal("1"), fees=Decimal(0),
                currency="EUR", cash_leg_of=primary_id, recorded_at=_SINGLE_GOV_NOW,
            ),
        ],
        import_batch_id=uuid4(),
    )

    version = StrategyVersion(
        id=StrategyVersionId(uuid4()),
        strategy_id=strategy_id,
        definition=StrategyDefinition(
            name="S",
            horizon=Horizon(years=10),
            risk=RiskProfile(level=RiskLevel.BALANCED),
            targets=f.flat_targets(("EQUITY_DEVELOPED", "1.0", f.absolute("0.10"))),
            rules=(
                Rule(
                    id=RuleId(UUID(int=1)),
                    name="r",
                    priority=Priority.HIGH,
                    suggestion_class=SuggestionClass.CONSIDER_REBALANCE,
                    message="m",
                    condition=LeafCondition(
                        kind="drift_outside_tolerance",
                        kind_version=1,
                        params={
                            "asset_class": "EQUITY_DEVELOPED",
                            "scope": Scope.for_bucket(bucket_id).ref,
                        },
                    ),
                ),
            ),
        ),
        change_note="seed",
        frozen_at=_SINGLE_GOV_NOW,
    )
    uow.strategies.freeze_version(version)

    evaluate_strategy(
        uow, _CountingIdGen(0), _FixedClock(), scope=Scope.for_bucket(bucket_id),
        as_of=_SINGLE_GOV_AS_OF, currency="EUR",
    )
    evaluate_strategy(
        uow, _CountingIdGen(1000), _FixedClock(), scope=Scope.for_portfolio(portfolio_id),
        as_of=_SINGLE_GOV_AS_OF, currency="EUR", strategy_id=strategy_id,
    )

    yield con
    con.close()


def _seeded_and_evaluated(tmp_path: Path) -> Path:
    db_path = tmp_path / "financeos.duckdb"
    runner = CliRunner()
    assert runner.invoke(app, ["--db-path", str(db_path), "seed", "demo"]).exit_code == 0
    assert (
        runner.invoke(
            app, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
        ).exit_code
        == 0
    )
    return db_path


def test_list_findings_returns_the_ux_0001_ten(tmp_path: Path) -> None:
    """UX-0001 §8.5: the six-class fixture opens exactly ten findings, one per FIRED Rule."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    findings = list_findings(con)
    assert len(findings) == 10
    assert all(f.occurrences == 1 for f in findings)
    # The canonical row (RFC-0005 §8.3): Pensione's Equity/Developed drift, CRITICAL row
    # aside the only one at severity 3.00.
    canonical = next(f for f in findings if f.current_severity == Decimal("3.00000000"))
    assert canonical.rule_id == "10000000-0000-0000-0000-000000000001"
    assert canonical.current_priority == "HIGH"


def test_list_holdings_returns_the_demo_assets(tmp_path: Path) -> None:
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    holdings = list_holdings(con, DEMO_PORTFOLIO_ID)
    asset_classes = {h.asset_class for h in holdings}
    assert {"EQUITY_DEVELOPED", "BOND_GOV_EUR", "EQUITY_GLOBAL", "CASH"} <= asset_classes
    # UX-0001 §8.1: every account is funded via TRANSFER_IN before its BUYs, so every
    # holding — CASH included — is non-negative, unlike the BUY-only walking skeleton.
    assert all(h.quantity >= 0 for h in holdings)


def test_drift_history_reads_the_snapshot_written_on_evaluate(tmp_path: Path) -> None:
    """RFC-0009 §5.1/§6: `Snapshot` is written on `evaluate`, and the series reads it
    as-recorded rather than recomputing under today's Strategy.

    UX-0001 §8.4's two Strategies make the demo Portfolio's governance mixed, so
    `target`/`drift` are `None` for every class at Portfolio scope (ADR-L06 §8.4) — `weight`
    alone survives, because it is a fact about the Portfolio, not about which Strategy
    governs it.
    """
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    (point,) = drift_history(con, DEMO_PORTFOLIO_ID, "EQUITY_DEVELOPED")
    assert point.weight == Decimal("0.25496468")
    assert point.target is None
    assert point.drift is None


def test_drift_history_is_none_for_every_class_under_mixed_governance(tmp_path: Path) -> None:
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    (point,) = drift_history(con, DEMO_PORTFOLIO_ID, "CASH")
    assert point.target is None
    assert point.drift is None


def test_drift_history_populates_target_and_drift_under_single_governance(
    single_governance_con: duckdb.DuckDBPyConnection,
) -> None:
    """The demo fixture's Portfolio is always mixed (UX-0001 §8.4), so `target`/`drift`
    read `None` there by design (ADR-L06 §8.4) — proven above. Under a single Strategy,
    the same fields must carry real numbers: 100% held, 100% target, zero drift."""
    row = single_governance_con.execute("SELECT id FROM portfolio LIMIT 1").fetchone()
    assert row is not None
    (point,) = drift_history(single_governance_con, row[0], "EQUITY_DEVELOPED")
    assert point.weight == Decimal("1.00000000")
    assert point.target == Decimal("1.00000000")
    assert point.drift == Decimal("0.00000000")


def test_bucket_findings_states_carries_both_counts_together(tmp_path: Path) -> None:
    """`/dashboard`'s guard (task #12): open findings and unevaluated always travel together."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    states = bucket_findings_states(con, [DEMO_BUCKET_ID], as_of=date(2026, 7, 24))
    state = states[DEMO_BUCKET_ID]
    assert state.run_id is not None
    assert state.open_findings == 3
    assert state.rules_measured == 7
    assert state.rules_unevaluated == 1
    assert state.worst_severity == Decimal("3.00000000")


def test_bucket_findings_states_reports_never_evaluated_rather_than_zero(
    tmp_path: Path,
) -> None:
    """A Bucket with no run of its own is `None`, not a false `0` (ADR-0016)."""
    con = duckdb.connect(str(_seeded_and_evaluated(tmp_path)))
    con.execute("SET TimeZone='UTC'")
    never_run_id = "00000000-0000-0000-0000-000000000000"
    states = bucket_findings_states(con, [never_run_id], as_of=date(2026, 7, 24))
    state = states[never_run_id]
    assert state.run_id is None
    assert state.open_findings is None
    assert state.rules_measured is None
    assert state.rules_unevaluated is None
    assert state.worst_severity is None


def test_aggregate_outcome_counts_sums_across_runs(tmp_path: Path) -> None:
    db_path = _seeded_and_evaluated(tmp_path)
    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")
    bucket_run = latest_actual_run_for_scope(con, "BUCKET", DEMO_BUCKET_ID)
    portfolio_run = latest_actual_run_for_scope(con, "PORTFOLIO", DEMO_PORTFOLIO_ID)
    assert bucket_run is not None
    assert portfolio_run is not None

    counts = aggregate_outcome_counts(con, [bucket_run.id, portfolio_run.id])
    # Six-class fixture (UX-0001 §8.5): summed across the Pensione Bucket run and the
    # Portfolio-scope run, not the full 28-evaluation demo total.
    assert counts.total == 11
    assert counts.fired == 5
