"""`import_operations` — CSV rows to paired primary + auto-cash-leg `Operation` writes.

One fresh `import_batch_id` per call, so W1 (leg totality), W2 (leg shape/amount) and W9
(atomicity) are all satisfied by construction: every primary and its leg reach
`OperationRepository.write` in the same batch (RFC-0005 §3, ADR-0026, ADR-L01).
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

from financeos.adapters.importers.csv_operations import OperationImportRow
from financeos.app.unit_of_work import UnitOfWork
from financeos.core.portfolio import Operation
from financeos.core.shared import OperationId, Quantity
from financeos.ports import Clock, IdGen


def import_operations(
    uow: UnitOfWork, id_gen: IdGen, clock: Clock, rows: Sequence[OperationImportRow]
) -> UUID:
    """Write `rows` as primary+cash-leg `Operation` pairs under one fresh `import_batch_id`.

    Returns:
        The minted `import_batch_id`.
    """
    if not rows:
        raise ValueError("import_operations: no rows to import")

    batch_id = id_gen()
    recorded_at = clock.now()
    operations: list[Operation] = []

    for row in rows:
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
        operations.append(primary)

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
        operations.append(leg)

    uow.operations.write(operations, import_batch_id=batch_id)
    return batch_id
