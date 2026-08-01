"""`import_operations` — CSV rows to `Operation` writes: primary+leg (`BUY`/`SELL`), paired
transfer sides (`TRANSFER_IN`/`TRANSFER_OUT`), and paired corrections (`CORRECTION`) — ADR-0026,
ADR-0028, ADR-L01.

One fresh `import_batch_id` per call, so W1/W2/W4/W6/W7/W9 are all satisfied by construction:
every row a CSV type requires reaches `OperationRepository.write` in the same batch.
`OperationRepository.write` re-validates all of it (E-2: no probing by catching a
`ConstraintException`) — this module's only job is to build the correct *shape*.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from financeos.adapters.importers.csv_operations import OperationImportRow
from financeos.app.unit_of_work import UnitOfWork
from financeos.core.portfolio import Operation, OperationType
from financeos.core.shared import OperationId, Quantity
from financeos.ports import Clock, IdGen

_LEGGED_TYPES = frozenset({OperationType.BUY, OperationType.SELL})
_TRANSFER_TYPES = frozenset({OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT})


def import_operations(
    uow: UnitOfWork, id_gen: IdGen, clock: Clock, rows: Sequence[OperationImportRow]
) -> UUID:
    """Write `rows` as `Operation`s under one fresh `import_batch_id`.

    Returns:
        The minted `import_batch_id`.
    """
    if not rows:
        raise ValueError("import_operations: no rows to import")

    batch_id = id_gen()
    recorded_at = clock.now()
    operations: list[Operation] = []

    for row in rows:
        if row.type in _LEGGED_TYPES:
            operations.extend(_buy_sell_pair(uow, id_gen, row, batch_id, recorded_at))
        elif row.type is OperationType.CORRECTION:
            operations.extend(_correction_pair(uow, id_gen, row, batch_id, recorded_at))

    transfer_rows = [row for row in rows if row.type in _TRANSFER_TYPES]
    operations.extend(_transfer_pairs(id_gen, transfer_rows, batch_id, recorded_at))

    uow.operations.write(operations, import_batch_id=batch_id)
    return batch_id


def _buy_sell_pair(
    uow: UnitOfWork,
    id_gen: IdGen,
    row: OperationImportRow,
    batch_id: UUID,
    recorded_at: datetime,
) -> tuple[Operation, Operation]:
    if row.price is None:
        raise ValueError(f"{row.type} rows require a price")
    primary = Operation(
        id=OperationId(id_gen()),
        type=row.type,
        account_id=row.account_id,
        asset_id=row.asset_id,
        trade_date=row.trade_date,
        quantity=Quantity(amount=row.quantity),
        price=row.price,
        fees=row.fees,
        currency=row.currency,
        import_batch_id=batch_id,
        recorded_at=recorded_at,
    )
    info = uow.accounts.get(row.account_id)
    leg_amount = -(row.quantity * row.price) - row.fees
    leg = Operation(
        id=OperationId(id_gen()),
        type=row.type,
        account_id=row.account_id,
        asset_id=info.cash_asset_id,
        trade_date=row.trade_date,
        quantity=Quantity(amount=leg_amount),
        price=Decimal(1),
        fees=Decimal(0),
        currency=info.currency,
        cash_leg_of=primary.id,
        import_batch_id=batch_id,
        recorded_at=recorded_at,
    )
    return primary, leg


def _transfer_pairs(
    id_gen: IdGen,
    rows: Sequence[OperationImportRow],
    batch_id: UUID,
    recorded_at: datetime,
) -> list[Operation]:
    groups: dict[str, list[OperationImportRow]] = {}
    for row in rows:
        if row.ref is None:
            raise ValueError(f"{row.type} rows require a ref pairing key")
        groups.setdefault(row.ref, []).append(row)

    operations: list[Operation] = []
    for ref, group in groups.items():
        if len(group) != 2 or {row.type for row in group} != _TRANSFER_TYPES:
            raise ValueError(
                f"transfer ref {ref!r} must group exactly one TRANSFER_IN and one "
                "TRANSFER_OUT row"
            )
        pair_id = id_gen()
        for row in group:
            if row.price is None:
                raise ValueError(f"{row.type} rows require a price")
            if row.fees != 0:
                raise ValueError(
                    "TRANSFER_IN/TRANSFER_OUT fees must be 0 in this release "
                    "(ADR-L01 §4.3: fee legs deferred to V1.1)"
                )
            operations.append(
                Operation(
                    id=OperationId(id_gen()),
                    type=row.type,
                    account_id=row.account_id,
                    asset_id=row.asset_id,
                    trade_date=row.trade_date,
                    quantity=Quantity(amount=row.quantity),
                    price=row.price,
                    fees=row.fees,
                    currency=row.currency,
                    transfer_pair_id=pair_id,
                    import_batch_id=batch_id,
                    recorded_at=recorded_at,
                )
            )
    return operations


def _correction_pair(
    uow: UnitOfWork,
    id_gen: IdGen,
    row: OperationImportRow,
    batch_id: UUID,
    recorded_at: datetime,
) -> list[Operation]:
    if row.ref is None:
        raise ValueError("CORRECTION rows require a ref = the target Operation id")
    target = uow.operations.get(OperationId(UUID(row.ref)))

    if target.cash_leg_of is not None:
        raise ValueError(
            f"cannot directly correct cash leg {target.id}; correct its parent Operation instead"
        )
    if target.type is OperationType.CORRECTION:
        raise ValueError(f"cannot correct a CORRECTION ({target.id}; W5: no correction chains)")
    if target.type not in _LEGGED_TYPES | _TRANSFER_TYPES:
        raise ValueError(f"correcting {target.type} is out of this importer's scope")

    correction = Operation(
        id=OperationId(id_gen()),
        type=OperationType.CORRECTION,
        account_id=target.account_id,
        asset_id=target.asset_id,
        trade_date=row.trade_date,
        quantity=Quantity(amount=row.quantity),
        fees=row.fees,
        currency=target.currency,
        corrects_id=target.id,
        import_batch_id=batch_id,
        recorded_at=recorded_at,
    )
    operations = [correction]

    if target.type in _LEGGED_TYPES:
        leg = uow.operations.leg_of(target.id)
        if leg is None:
            raise ValueError(f"corrected Operation {target.id} has no cash leg (W1 violated)")
        leg_delta = -(row.quantity * (target.price or Decimal(0))) - row.fees
        operations.append(
            Operation(
                id=OperationId(id_gen()),
                type=OperationType.CORRECTION,
                account_id=leg.account_id,
                asset_id=leg.asset_id,
                trade_date=row.trade_date,
                quantity=Quantity(amount=leg_delta),
                price=Decimal(1),
                fees=Decimal(0),
                currency=leg.currency,
                corrects_id=leg.id,
                cash_leg_of=correction.id,
                import_batch_id=batch_id,
                recorded_at=recorded_at,
            )
        )
    else:  # TRANSFER_IN/TRANSFER_OUT
        if target.transfer_pair_id is None:
            raise ValueError(f"transfer side {target.id} has no transfer_pair_id (N3 violated)")
        sibling = uow.operations.transfer_sibling(target.transfer_pair_id, exclude_id=target.id)
        if sibling is None:
            raise ValueError(f"transfer side {target.id} has no pair sibling (W4 violated)")
        operations.append(
            Operation(
                id=OperationId(id_gen()),
                type=OperationType.CORRECTION,
                account_id=sibling.account_id,
                asset_id=sibling.asset_id,
                trade_date=row.trade_date,
                quantity=Quantity(amount=-row.quantity),
                fees=Decimal(0),
                currency=sibling.currency,
                corrects_id=sibling.id,
                import_batch_id=batch_id,
                recorded_at=recorded_at,
            )
        )
    return operations
