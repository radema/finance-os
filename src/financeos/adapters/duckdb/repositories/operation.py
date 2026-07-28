"""`DuckDBOperationRepository` — `operation`, the one true fact table (I-10, ADR-L01).

`write` is the single entry point. It validates the cross-row invariants W1-W10 (ADR-L01
§4.5 / HANDOFF §3.4) against the batch plus whatever the store already holds, then inserts
the whole batch in one transaction under one `import_batch_id` (W9). Per E-2 (DuckDB's inline
CHECKs are anonymous), the caller must construct the correct rows up front — this module
never probes a shape by catching a `ConstraintException`.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import duckdb

from financeos.adapters.duckdb._time import parse_instant
from financeos.core.portfolio import Operation, OperationType
from financeos.core.shared import AccountId, InvariantViolationError

_PRIMARY_LEG_TYPES = frozenset(
    {OperationType.BUY, OperationType.SELL, OperationType.DIVIDEND, OperationType.COUPON}
)
_FORMULA_TYPES = frozenset({OperationType.BUY, OperationType.SELL})
_TRANSFER_TYPES = frozenset({OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT})

_COLUMNS = (
    "id",
    "type",
    "account_id",
    "asset_id",
    "trade_date",
    "quantity",
    "price",
    "fees",
    "currency",
    "corrects_id",
    "transfer_pair_id",
    "cash_leg_of",
)


@dataclass(frozen=True)
class _Row:
    """The subset of an `operation` row the W1-W10 checks read."""

    id: UUID
    type: OperationType
    account_id: UUID
    asset_id: UUID
    trade_date: date
    quantity: Decimal
    price: Decimal | None
    fees: Decimal
    currency: str
    corrects_id: UUID | None
    transfer_pair_id: UUID | None
    cash_leg_of: UUID | None


def _to_row(op: Operation) -> _Row:
    return _Row(
        id=UUID(str(op.id)),
        type=op.type,
        account_id=UUID(str(op.account_id)),
        asset_id=UUID(str(op.asset_id)),
        trade_date=op.trade_date,
        quantity=op.quantity.amount,
        price=op.price,
        fees=op.fees,
        currency=op.currency,
        corrects_id=UUID(str(op.corrects_id)) if op.corrects_id else None,
        transfer_pair_id=UUID(str(op.transfer_pair_id)) if op.transfer_pair_id else None,
        cash_leg_of=UUID(str(op.cash_leg_of)) if op.cash_leg_of else None,
    )


class DuckDBOperationRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    # -- reads -----------------------------------------------------------------

    def for_accounts(
        self, account_ids: Collection[AccountId], *, as_of: date
    ) -> tuple[Operation, ...]:
        if not account_ids:
            return ()
        ids = [str(a) for a in account_ids]
        placeholders = ",".join("?" for _ in ids)
        rows = self._con.execute(
            "SELECT id, type, account_id, asset_id, trade_date, quantity, price, fees, "
            "currency, import_batch_id, corrects_id, transfer_pair_id, cash_leg_of, "
            "CAST(recorded_at AS VARCHAR) "
            f"FROM operation WHERE account_id IN ({placeholders}) AND trade_date <= ? "
            "ORDER BY trade_date, id",
            [*ids, as_of],
        ).fetchall()
        return tuple(_operation_from_row(row) for row in rows)

    def _fetch_row(self, op_id: UUID) -> _Row | None:
        row = self._con.execute(
            f"SELECT {', '.join(_COLUMNS)} FROM operation WHERE id = ?", [str(op_id)]
        ).fetchone()
        if row is None:
            return None
        return _Row(
            id=UUID(row[0]),
            type=OperationType(row[1]),
            account_id=UUID(row[2]),
            asset_id=UUID(row[3]),
            trade_date=row[4],
            quantity=row[5],
            price=row[6],
            fees=row[7],
            currency=row[8],
            corrects_id=UUID(row[9]) if row[9] else None,
            transfer_pair_id=UUID(row[10]) if row[10] else None,
            cash_leg_of=UUID(row[11]) if row[11] else None,
        )

    def _account_info(self, account_id: UUID) -> tuple[UUID, str]:
        """`(cash_asset_id, currency)` for `account_id`."""
        row = self._con.execute(
            "SELECT cash_asset_id, currency FROM account WHERE id = ?", [str(account_id)]
        ).fetchone()
        if row is None:
            raise InvariantViolationError(f"operation references unknown account {account_id}")
        return UUID(row[0]), row[1]

    def _transfer_pair_sibling(self, pair_id: UUID, exclude_id: UUID) -> _Row | None:
        row = self._con.execute(
            "SELECT id FROM operation WHERE transfer_pair_id = ? AND id <> ?",
            [str(pair_id), str(exclude_id)],
        ).fetchone()
        return self._fetch_row(UUID(row[0])) if row else None

    def _leg_of(self, parent_id: UUID) -> _Row | None:
        row = self._con.execute(
            "SELECT id FROM operation WHERE cash_leg_of = ?", [str(parent_id)]
        ).fetchone()
        return self._fetch_row(UUID(row[0])) if row else None

    # -- write -------------------------------------------------------------

    def write(self, operations: Sequence[Operation], *, import_batch_id: UUID) -> None:
        if not operations:
            return
        for op in operations:
            if op.import_batch_id is not None and UUID(str(op.import_batch_id)) != import_batch_id:
                raise InvariantViolationError(
                    "W9: every row of a write() batch must share one import_batch_id"
                )
        batch = {_to_row(op).id: _to_row(op) for op in operations}
        self._validate(batch)

        self._con.execute("BEGIN TRANSACTION")
        try:
            self._con.execute(
                "INSERT INTO import_batch (id, imported_at) VALUES (?, ?) "
                "ON CONFLICT DO NOTHING",
                [str(import_batch_id), operations[0].recorded_at],
            )
            for op in operations:
                self._con.execute(
                    "INSERT INTO operation "
                    "(id, type, account_id, asset_id, trade_date, quantity, price, fees, "
                    " currency, import_batch_id, corrects_id, transfer_pair_id, cash_leg_of, "
                    " recorded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        str(op.id),
                        op.type.value,
                        str(op.account_id),
                        str(op.asset_id),
                        op.trade_date,
                        op.quantity.amount,
                        op.price,
                        op.fees,
                        op.currency,
                        str(import_batch_id),
                        str(op.corrects_id) if op.corrects_id else None,
                        str(op.transfer_pair_id) if op.transfer_pair_id else None,
                        str(op.cash_leg_of) if op.cash_leg_of else None,
                        op.recorded_at,
                    ],
                )
        except Exception:
            self._con.execute("ROLLBACK")
            raise
        else:
            self._con.execute("COMMIT")

    # -- W1-W10 -----------------------------------------------------------

    def _resolve(self, batch: dict[UUID, _Row], op_id: UUID) -> _Row | None:
        return batch.get(op_id) or self._fetch_row(op_id)

    def _validate(self, batch: dict[UUID, _Row]) -> None:
        for row in batch.values():
            if row.type in _PRIMARY_LEG_TYPES and row.cash_leg_of is None:
                self._check_w1_w2(row, batch)
            if row.cash_leg_of is not None:
                self._check_w3(row, batch)
            if row.type is OperationType.CORRECTION and row.corrects_id is not None:
                self._check_w5_w6_w7_w8(row, batch)
        self._check_w4(batch)

    def _check_w1_w2(self, primary: _Row, batch: dict[UUID, _Row]) -> None:
        legs = [r for r in batch.values() if r.cash_leg_of == primary.id]
        if len(legs) != 1:
            raise InvariantViolationError(
                f"W1: {primary.type} {primary.id} must have exactly one cash leg in the same "
                f"batch; found {len(legs)}"
            )
        leg = legs[0]
        cash_asset_id, currency = self._account_info(primary.account_id)
        if leg.account_id != primary.account_id:
            raise InvariantViolationError("W2: leg.account_id must equal parent.account_id")
        if leg.asset_id != cash_asset_id:
            raise InvariantViolationError("W2: leg.asset_id must equal account.cash_asset_id")
        if leg.currency != currency:
            raise InvariantViolationError("W2: leg.currency must equal account.currency")
        if leg.price != Decimal(1):
            raise InvariantViolationError("W2: leg.price must be 1 (CASH at par)")
        if leg.trade_date != primary.trade_date:
            raise InvariantViolationError("W2: leg.trade_date must equal parent.trade_date")
        if leg.fees != Decimal(0):
            raise InvariantViolationError("W2: leg.fees must be 0 (folded into the amount)")
        if primary.type in _FORMULA_TYPES:
            expected = -(primary.quantity * (primary.price or Decimal(0))) - primary.fees
            if leg.quantity != expected:
                raise InvariantViolationError(
                    f"W2: leg amount formula violated: expected {expected}, got {leg.quantity}"
                )
        # DIVIDEND/COUPON: no self-contained formula (O1) — structural checks only.

    def _check_w3(self, leg: _Row, batch: dict[UUID, _Row]) -> None:
        parent = self._resolve(batch, leg.cash_leg_of)  # type: ignore[arg-type]
        if parent is None:
            raise InvariantViolationError(
                f"W3: cash_leg_of target {leg.cash_leg_of} does not exist"
            )
        if parent.cash_leg_of is not None:
            raise InvariantViolationError("W3: no leg of a leg")

    def _check_w4(self, batch: dict[UUID, _Row]) -> None:
        pairs: dict[UUID, list[_Row]] = {}
        for row in batch.values():
            if row.transfer_pair_id is not None:
                pairs.setdefault(row.transfer_pair_id, []).append(row)
        for pair_id, rows in pairs.items():
            if len(rows) != 2:
                raise InvariantViolationError(
                    f"W4: transfer_pair_id {pair_id} must have exactly two rows in one batch"
                )
            a, b = rows
            types = {a.type, b.type}
            if types != _TRANSFER_TYPES:
                raise InvariantViolationError("W4: a transfer pair must be one IN and one OUT")
            out_row = a if a.type is OperationType.TRANSFER_OUT else b
            in_row = b if out_row is a else a
            if not (out_row.quantity < 0 and in_row.quantity > 0):
                raise InvariantViolationError(
                    "W4: TRANSFER_OUT must be negative, TRANSFER_IN positive"
                )
            if a.asset_id != b.asset_id:
                raise InvariantViolationError("W4: both sides of a transfer must share asset_id")
            if a.account_id == b.account_id:
                raise InvariantViolationError(
                    "W4: both sides of a transfer must be distinct accounts"
                )
            if a.quantity + b.quantity != 0:
                raise InvariantViolationError("W4: a transfer pair must net to zero")
            if a.trade_date != b.trade_date:
                raise InvariantViolationError("W4: both sides of a transfer must share trade_date")

    def _check_w5_w6_w7_w8(self, correction: _Row, batch: dict[UUID, _Row]) -> None:
        target = self._resolve(batch, correction.corrects_id)  # type: ignore[arg-type]
        if target is None:
            raise InvariantViolationError(
                f"W5: correction target {correction.corrects_id} does not exist"
            )
        if target.type is OperationType.CORRECTION:
            raise InvariantViolationError("W5: no correction chains")
        if correction.cash_leg_of is not None:
            return  # this is the cash side (row #6) itself; its own pairing is checked below
        if target.cash_leg_of is not None:
            return  # a direct correction of a leg row; not a shape the corpus models further
        if target.type in _PRIMARY_LEG_TYPES:
            self._check_w6(correction, target, batch)
        elif target.type in _TRANSFER_TYPES:
            self._check_w7(correction, target, batch)

    def _check_w6(self, correction: _Row, target: _Row, batch: dict[UUID, _Row]) -> None:
        leg = self._leg_of(target.id) or next(
            (r for r in batch.values() if r.cash_leg_of == target.id), None
        )
        if leg is None:
            raise InvariantViolationError(f"W6: corrected row {target.id} has no cash leg to pair")
        siblings = [
            r
            for r in batch.values()
            if r.type is OperationType.CORRECTION
            and r.corrects_id == leg.id
            and r.cash_leg_of == correction.id
        ]
        if len(siblings) != 1:
            raise InvariantViolationError(
                "W6: a correction of a legged Operation requires exactly one paired cash "
                "CORRECTION (corrects_id -> original leg, cash_leg_of -> this correction)"
            )
        sibling = siblings[0]
        if target.type in _FORMULA_TYPES:
            expected = -(correction.quantity * (target.price or Decimal(0))) - correction.fees
            if sibling.quantity != expected:
                raise InvariantViolationError(
                    f"W8: correction leg amount formula violated: expected {expected}, "
                    f"got {sibling.quantity}"
                )

    def _check_w7(self, correction: _Row, target: _Row, batch: dict[UUID, _Row]) -> None:
        sibling_side = self._transfer_pair_sibling(target.transfer_pair_id, target.id)  # type: ignore[arg-type]
        if sibling_side is None:
            raise InvariantViolationError(f"W7: transfer side {target.id} has no pair sibling")
        counter_corrections = [
            r
            for r in batch.values()
            if r.type is OperationType.CORRECTION and r.corrects_id == sibling_side.id
        ]
        if len(counter_corrections) != 1:
            raise InvariantViolationError(
                "W7: a correction of one transfer side requires exactly one correction of the "
                "other side in the same batch"
            )
        counter = counter_corrections[0]
        if correction.quantity != -counter.quantity:
            raise InvariantViolationError(
                "W7: the two correction deltas must be equal and opposite"
            )


def _operation_from_row(row: tuple[Any, ...]) -> Operation:
    from financeos.core.shared import AccountId, AssetId, OperationId, Quantity

    (
        op_id,
        type_,
        account_id,
        asset_id,
        trade_date,
        quantity,
        price,
        fees,
        currency,
        import_batch_id,
        corrects_id,
        transfer_pair_id,
        cash_leg_of,
        recorded_at,
    ) = row
    return Operation(
        id=OperationId(UUID(op_id)),
        type=OperationType(type_),
        account_id=AccountId(UUID(account_id)),
        asset_id=AssetId(UUID(asset_id)),
        trade_date=trade_date,
        quantity=Quantity(amount=quantity),
        price=price,
        fees=fees,
        currency=currency,
        import_batch_id=UUID(import_batch_id) if import_batch_id else None,
        corrects_id=OperationId(UUID(corrects_id)) if corrects_id else None,
        transfer_pair_id=UUID(transfer_pair_id) if transfer_pair_id else None,
        cash_leg_of=OperationId(UUID(cash_leg_of)) if cash_leg_of else None,
        recorded_at=parse_instant(recorded_at),
    )
