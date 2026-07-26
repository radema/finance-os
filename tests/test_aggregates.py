"""Constructor validation of the eight skeleton aggregates (RFC-0004 §6, ERR-7)."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from financeos.core.decision import (
    Alert,
    Binding,
    ConditionRef,
    EvaluationRun,
    EvaluationTrace,
    Step,
    StepOp,
)
from financeos.core.portfolio import Bucket, Operation, OperationType, Portfolio, VirtualHolding
from financeos.core.shared import (
    Outcome,
    Priority,
    Quantity,
    SkipReason,
    SourceRef,
    Weight,
)
from financeos.core.shared.errors import RuleNotInVersionError
from financeos.core.strategy import (
    Horizon,
    StrategyDefinition,
    TargetAllocation,
    TargetNode,
    Tolerance,
    ToleranceKind,
)
from tests import factories as f


class TestOperation:
    """ADR-0028 / ADR-L01 row-local rules, mirrored from migration 001's CHECK constraints."""

    def test_buy_requires_positive_quantity(self) -> None:
        with pytest.raises(ValidationError):
            f.operation(1, qty="-1")

    def test_sell_requires_negative_quantity(self) -> None:
        assert f.operation(1, qty="-4", op_type=OperationType.SELL).quantity.amount == Decimal(-4)
        with pytest.raises(ValidationError):
            f.operation(1, qty="4", op_type=OperationType.SELL)

    def test_a_cash_leg_is_exempt_from_its_parents_sign_check(self) -> None:
        leg = Operation(
            id=f.operation(1).id,
            type=OperationType.BUY,
            account_id=f.ACCOUNT,
            asset_id=f.BOND,
            trade_date=date(2026, 1, 15),
            quantity=Quantity(amount=Decimal(-1000)),
            fees=Decimal(0),
            currency="EUR",
            cash_leg_of=f.operation(2).id,
            recorded_at=f.NOW,
        )
        assert leg.cash_leg_of is not None

    def test_correction_requires_corrects_id_and_is_sign_exempt(self) -> None:
        correction = Operation(
            id=f.operation(9).id,
            type=OperationType.CORRECTION,
            account_id=f.ACCOUNT,
            asset_id=f.EQUITY,
            trade_date=date(2026, 1, 16),
            quantity=Quantity(amount=Decimal("-0.5")),
            fees=Decimal(0),
            currency="EUR",
            corrects_id=f.operation(1).id,
            recorded_at=f.NOW,
        )
        assert correction.corrects_id == f.operation(1).id

    def test_corrects_id_only_on_a_correction(self) -> None:
        with pytest.raises(ValidationError):
            Operation(
                id=f.operation(3).id,
                type=OperationType.BUY,
                account_id=f.ACCOUNT,
                asset_id=f.EQUITY,
                trade_date=date(2026, 1, 15),
                quantity=Quantity(amount=Decimal(1)),
                fees=Decimal(0),
                currency="EUR",
                corrects_id=f.operation(1).id,
                recorded_at=f.NOW,
            )

    def test_transfer_row_must_be_a_pair_side_or_a_leg(self) -> None:
        with pytest.raises(ValidationError):
            f.operation(4, qty="1", op_type=OperationType.TRANSFER_IN)

    def test_transfer_pair_id_is_exclusive_and_type_restricted(self) -> None:
        pair = UUID(int=77)
        with pytest.raises(ValidationError):
            Operation(
                id=f.operation(5).id,
                type=OperationType.BUY,
                account_id=f.ACCOUNT,
                asset_id=f.EQUITY,
                trade_date=date(2026, 1, 15),
                quantity=Quantity(amount=Decimal(1)),
                fees=Decimal(0),
                currency="EUR",
                transfer_pair_id=pair,
                recorded_at=f.NOW,
            )

    def test_operation_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            f.operation(1).quantity = Quantity(amount=Decimal(1))  # type: ignore[misc]


class TestPortfolioAndBucket:
    def test_portfolio_is_a_thin_container(self) -> None:
        portfolio = Portfolio(id=f.PORTFOLIO, name="Personale", accounts=(f.ACCOUNT,))
        assert portfolio.accounts == (f.ACCOUNT,)
        assert not hasattr(portfolio, "holdings")

    def test_bucket_is_thin_and_carries_both_references(self) -> None:
        bucket = Bucket(
            id=f.BUCKET, portfolio_id=f.PORTFOLIO, strategy_id=f.STRATEGY, name="Pensione"
        )
        assert bucket.strategy_id == f.STRATEGY
        assert "virtual_holdings" not in Bucket.model_fields  # ADR-0025: thin aggregate
        assert bucket.portfolio_id == f.PORTFOLIO  # ERR-9

    def test_virtual_holding_is_read_as_a_holding(self) -> None:
        virtual = VirtualHolding(
            bucket_id=f.BUCKET,
            asset_id=f.EQUITY,
            quantity=f.quantity("4"),
            input_refs=("apportionment:1",),
        )
        assert virtual.as_holding().quantity == f.quantity("4")
        assert virtual.as_holding().input_refs == ("apportionment:1",)


WEIGHTS = st.decimals(min_value=Decimal(0), max_value=Decimal(1), places=8, allow_nan=False)


class TestTargetAllocation:
    def test_effective_target_is_the_product_along_the_path(self) -> None:
        tree = TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY",
                    weight=f.weight("0.6"),
                    children=(
                        TargetNode(
                            key="EQUITY_DEVELOPED",
                            weight=f.weight("0.7"),
                            tolerance=f.absolute("0.02"),
                        ),
                        TargetNode(
                            key="EQUITY_EMERGING",
                            weight=f.weight("0.3"),
                            tolerance=f.relative("0.25"),
                        ),
                    ),
                ),
                TargetNode(
                    key="BONDS_GOV_EUR", weight=f.weight("0.4"), tolerance=f.absolute("0.05")
                ),
            )
        )
        leaves = tree.leaves()
        assert leaves["EQUITY_DEVELOPED"].effective_target == Decimal("0.42000000")
        assert leaves["EQUITY_EMERGING"].effective_target == Decimal("0.18000000")
        assert leaves["BONDS_GOV_EUR"].effective_target == Decimal("0.40000000")
        assert leaves["EQUITY_DEVELOPED"].target_path == "targets.EQUITY.EQUITY_DEVELOPED"

    def test_i13_children_must_sum_to_one(self) -> None:
        with pytest.raises(ValidationError):
            f.flat_targets(
                ("EQUITY_DEVELOPED", "0.4", f.absolute("0.02")),
                ("BONDS_GOV_EUR", "0.5", f.absolute("0.05")),
            )

    def test_i13_holds_within_the_declared_epsilon(self) -> None:
        third = "0.33333333"
        tree = f.flat_targets(
            ("A", third, f.absolute("0.01")),
            ("B", third, f.absolute("0.01")),
            ("C", "0.33333334", f.absolute("0.01")),
        )
        assert len(tree.leaves()) == 3

    @given(WEIGHTS)
    def test_leaf_effective_targets_sum_to_one_for_any_valid_tree(self, split: Decimal) -> None:
        tree = TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY",
                    weight=Weight(value=split),
                    children=(
                        TargetNode(
                            key="EQUITY_DEVELOPED",
                            weight=f.weight("0.7"),
                            tolerance=f.absolute("0.02"),
                        ),
                        TargetNode(
                            key="EQUITY_EMERGING",
                            weight=f.weight("0.3"),
                            tolerance=f.absolute("0.02"),
                        ),
                    ),
                ),
                TargetNode(
                    key="BONDS_GOV_EUR",
                    weight=Weight(value=Decimal(1) - split),
                    tolerance=f.absolute("0.05"),
                ),
            )
        )
        total = sum(leaf.effective_target for leaf in tree.leaves().values())
        assert abs(total - Decimal(1)) <= Decimal("0.00000002")

    def test_restructuring_a_subtree_leaves_other_effective_targets_identical(self) -> None:
        """Guards ADR-0017's core claim: relative weights keep subtree edits local."""
        bonds = TargetNode(
            key="BONDS_GOV_EUR", weight=f.weight("0.4"), tolerance=f.absolute("0.05")
        )
        before = TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY",
                    weight=f.weight("0.6"),
                    children=(
                        TargetNode(
                            key="EQUITY_DEVELOPED",
                            weight=f.weight("0.7"),
                            tolerance=f.absolute("0.02"),
                        ),
                        TargetNode(
                            key="EQUITY_EMERGING",
                            weight=f.weight("0.3"),
                            tolerance=f.absolute("0.02"),
                        ),
                    ),
                ),
                bonds,
            )
        )
        after = TargetAllocation(
            children=(
                TargetNode(
                    key="EQUITY",
                    weight=f.weight("0.6"),
                    children=(
                        TargetNode(
                            key="EQUITY_DEVELOPED",
                            weight=f.weight("0.5"),
                            tolerance=f.absolute("0.02"),
                        ),
                        TargetNode(
                            key="EQUITY_EMERGING",
                            weight=f.weight("0.5"),
                            tolerance=f.absolute("0.02"),
                        ),
                    ),
                ),
                bonds,
            )
        )
        assert (
            before.leaves()["BONDS_GOV_EUR"].effective_target
            == after.leaves()["BONDS_GOV_EUR"].effective_target
        )

    def test_a_leaf_must_declare_a_tolerance(self) -> None:
        with pytest.raises(ValidationError):
            TargetNode(key="EQUITY_DEVELOPED", weight=f.weight("1"))

    def test_duplicate_targeted_class_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TargetAllocation(
                children=(
                    TargetNode(
                        key="EQUITY",
                        weight=f.weight("0.5"),
                        children=(
                            TargetNode(
                                key="SHARED", weight=f.weight("1"), tolerance=f.absolute("0.01")
                            ),
                        ),
                    ),
                    TargetNode(
                        key="BONDS",
                        weight=f.weight("0.5"),
                        children=(
                            TargetNode(
                                key="SHARED", weight=f.weight("1"), tolerance=f.absolute("0.01")
                            ),
                        ),
                    ),
                )
            )

    def test_an_empty_tree_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TargetAllocation(children=())

    def test_i14_keys_are_asset_classes_never_ids(self) -> None:
        with pytest.raises(ValidationError):
            f.flat_targets(("019460a1-7c3e", "1", f.absolute("0.02")))


class TestTolerance:
    @pytest.mark.parametrize(
        ("kind", "band", "target", "expected"),
        [
            (ToleranceKind.ABSOLUTE, "0.05", "0.40", "0.05000000"),
            (ToleranceKind.ABSOLUTE, "0.05", "0.04", "0.05000000"),
            (ToleranceKind.RELATIVE, "0.25", "0.40", "0.10000000"),
            (ToleranceKind.RELATIVE, "0.25", "0.18", "0.04500000"),
            (ToleranceKind.RELATIVE, "0.25", "0.04", "0.01000000"),
        ],
    )
    def test_adr0018_band_matrix(
        self, kind: ToleranceKind, band: str, target: str, expected: str
    ) -> None:
        tolerance = Tolerance(kind=kind, band=Decimal(band))
        assert tolerance.effective_band(Decimal(target)) == Decimal(expected)

    def test_band_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            Tolerance(kind=ToleranceKind.ABSOLUTE, band=Decimal(0))

    def test_binding_form_is_canonical(self) -> None:
        assert f.absolute("0.02").as_binding() == {"kind": "ABSOLUTE", "band": "0.02000000"}


class TestStrategyVersion:
    def test_i4_an_empty_rule_set_is_rejected_at_freeze(self) -> None:
        with pytest.raises(ValidationError):
            StrategyDefinition(
                name="Vuota",
                horizon=Horizon(years=10),
                risk=f.strategy_version().definition.risk,
                targets=f.DEMO_TARGETS,
                rules=(),
            )

    def test_change_note_is_required(self) -> None:
        with pytest.raises(ValidationError):
            f.strategy_version(change_note="")

    def test_rule_lookup_resolves_within_the_pinned_version(self) -> None:
        version = f.strategy_version(rules=(f.drift_rule(1),))
        assert version.rule(f.rule_id(1)).id == f.rule_id(1)
        with pytest.raises(RuleNotInVersionError):
            version.rule(f.rule_id(99))

    def test_duplicate_rule_ids_are_rejected(self) -> None:
        with pytest.raises(ValidationError):
            f.strategy_version(rules=(f.drift_rule(1), f.drift_rule(1)))

    def test_horizon_carries_exactly_one_form(self) -> None:
        with pytest.raises(ValidationError):
            Horizon(years=10, target_date=date(2040, 1, 1))
        with pytest.raises(ValidationError):
            Horizon()

    def test_version_is_immutable(self) -> None:
        with pytest.raises(ValidationError):
            f.strategy_version().change_note = "riscritta"  # type: ignore[misc]


def _trace(outcome: Outcome, *, bound: bool = True) -> EvaluationTrace:
    bindings = (
        (
            Binding(
                name="current_weight",
                value="0.34000000",
                source=SourceRef.derived(engine="strategy"),
            ),
        )
        if bound
        else ()
    )
    steps = (
        (Step(op=StepOp.ABS_GT, inputs=("current_weight", "current_weight"), out="b", value=True),)
        if bound
        else ()
    )
    return EvaluationTrace(
        condition=ConditionRef(kind="drift_outside_tolerance", kind_version=1, params={}),
        bindings=bindings,
        steps=steps,
        outcome=outcome,
        skip_reason=SkipReason.DISABLED if outcome is Outcome.SKIPPED else None,
    )


class TestAlert:
    def test_i6_an_evaluated_alert_requires_a_bound_stepped_trace(self) -> None:
        with pytest.raises(ValidationError):
            Alert(
                id=f.RUN,  # any UUID
                run_id=f.RUN,
                rule_id=f.rule_id(1),
                outcome=Outcome.FIRED,
                priority=Priority.HIGH,
                trace=_trace(Outcome.FIRED, bound=False),
                recorded_at=f.NOW,
            )

    def test_a_skipped_alert_is_explained_by_its_reason(self) -> None:
        alert = Alert(
            id=f.RUN,
            run_id=f.RUN,
            rule_id=f.rule_id(1),
            outcome=Outcome.SKIPPED,
            priority=Priority.HIGH,
            trace=_trace(Outcome.SKIPPED, bound=False),
            recorded_at=f.NOW,
        )
        assert alert.trace.skip_reason is SkipReason.DISABLED

    def test_trace_outcome_must_agree_with_the_alert(self) -> None:
        with pytest.raises(ValidationError):
            Alert(
                id=f.RUN,
                run_id=f.RUN,
                rule_id=f.rule_id(1),
                outcome=Outcome.NOT_FIRED,
                priority=Priority.HIGH,
                trace=_trace(Outcome.FIRED),
                recorded_at=f.NOW,
            )

    def test_err1_severity_is_null_for_skipped_and_error(self) -> None:
        with pytest.raises(ValidationError):
            Alert(
                id=f.RUN,
                run_id=f.RUN,
                rule_id=f.rule_id(1),
                outcome=Outcome.SKIPPED,
                priority=Priority.HIGH,
                severity=Decimal(3),
                trace=_trace(Outcome.SKIPPED, bound=False),
                recorded_at=f.NOW,
            )


class TestEvaluationRun:
    def test_err2_run_carries_its_scope(self) -> None:
        run = f.evaluation_run()
        assert run.scope.kind.value == "BUCKET"
        assert run.scope.id == f.BUCKET

    def test_input_digest_must_be_a_sha256(self) -> None:
        with pytest.raises(ValidationError):
            EvaluationRun.model_validate({**dict(f.evaluation_run()), "input_digest": "nope"})

    def test_evaluated_at_must_be_timezone_aware(self) -> None:
        naive = datetime(2026, 3, 12, 9, 30)  # noqa: DTZ001 - the value under test
        with pytest.raises(ValidationError):
            EvaluationRun.model_validate({**dict(f.evaluation_run()), "evaluated_at": naive})

    def test_timestamps_are_normalized_to_utc(self) -> None:
        assert f.evaluation_run().evaluated_at.tzinfo is UTC
