"""CSV -> `OperationImportRow` (RFC-0005 §4). One row per primary economic event; the
`import_operations` use case mints the auto cash leg (ADR-0026) — the CSV never carries one.

Columns: ``account_id,asset_id,type,trade_date,quantity,price,fees,currency``. Scope, matching
the walking skeleton (RFC-0005 §8.1): only `BUY`/`SELL` are supported here — a self-contained
leg-amount formula exists for both (ADR-L01 W2). `DIVIDEND`/`COUPON`/`TRANSFER_*`/`CORRECTION`
have no CSV-derivable leg amount or pairing shape and are out of this importer's scope.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from financeos.core.portfolio import OperationType
from financeos.core.shared import AccountId, AssetId, Currency

_SUPPORTED_TYPES = frozenset({OperationType.BUY, OperationType.SELL})


@dataclass(frozen=True)
class OperationImportRow:
    """One parsed CSV row: a primary economic event, before its cash leg is minted."""

    account_id: AccountId
    asset_id: AssetId
    type: OperationType
    trade_date: date
    quantity: Decimal
    price: Decimal
    fees: Decimal
    currency: Currency


def read_csv(path: Path) -> tuple[OperationImportRow, ...]:
    """Parse an operations CSV. Raises `ValueError` on an unsupported `type`."""
    rows: list[OperationImportRow] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for record in csv.DictReader(fh):
            op_type = OperationType(record["type"])
            if op_type not in _SUPPORTED_TYPES:
                raise ValueError(
                    f"import-operations supports BUY/SELL only in this release; got {op_type}"
                )
            rows.append(
                OperationImportRow(
                    account_id=AccountId(UUID(record["account_id"])),
                    asset_id=AssetId(UUID(record["asset_id"])),
                    type=op_type,
                    trade_date=date.fromisoformat(record["trade_date"]),
                    quantity=Decimal(record["quantity"]),
                    price=Decimal(record["price"]),
                    fees=Decimal(record["fees"] or "0"),
                    currency=record["currency"],
                )
            )
    return tuple(rows)
