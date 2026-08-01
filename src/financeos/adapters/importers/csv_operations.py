"""CSV -> `OperationImportRow` (RFC-0005 §4). `import_operations` builds the `Operation`
shapes ADR-L01 requires — primary+leg, transfer pairs, correction pairs — the CSV never
carries a leg or a link column directly.

Columns: ``account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref``. Scope
widened for V1.0 ingestion (RFC-0010's V1.0 table, ADR-0028): `BUY`/`SELL` (unchanged from the
skeleton) plus `TRANSFER_IN`/`TRANSFER_OUT`/`CORRECTION` (E10, ADR-L01). `DIVIDEND`/`COUPON`
still have no CSV-derivable leg amount (ADR-L01 §6 open item 1, unresolved) and stay out of
this importer's scope.

`ref` is overloaded per type — the one column real broker exports don't share a name for, but
every export has *some* linking column:

- `BUY`/`SELL`: unused, may be blank.
- `TRANSFER_IN`/`TRANSFER_OUT`: the pairing key. Two rows in the same file sharing one `ref`
  become one `transfer_pair_id` — `import_operations` mints that id, never the CSV.
- `CORRECTION`: the target `Operation.id` being corrected. No external broker reference
  survives into `operation` (RFC-0009 §3.1 has no such column), so this importer's contract is
  that the operator looked the id up in the app first.

`price` is required for `BUY`/`SELL`/`TRANSFER_IN`/`TRANSFER_OUT` and optional for
`CORRECTION`: a correction's cash effect is computed from the *target's* recorded price
(ADR-L01 W8), never the correction row's own.
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

_SUPPORTED_TYPES = frozenset(
    {
        OperationType.BUY,
        OperationType.SELL,
        OperationType.TRANSFER_IN,
        OperationType.TRANSFER_OUT,
        OperationType.CORRECTION,
    }
)
_PRICE_REQUIRED_TYPES = frozenset(
    {OperationType.BUY, OperationType.SELL, OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT}
)
_REF_REQUIRED_TYPES = frozenset(
    {OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT, OperationType.CORRECTION}
)


@dataclass(frozen=True)
class OperationImportRow:
    """One parsed CSV row, before its cash leg/pairing is minted by `import_operations`."""

    account_id: AccountId
    asset_id: AssetId
    type: OperationType
    trade_date: date
    quantity: Decimal
    price: Decimal | None
    fees: Decimal
    currency: Currency
    ref: str | None = None


def read_csv(path: Path) -> tuple[OperationImportRow, ...]:
    """Parse an operations CSV.

    Raises:
        ValueError: `type` is unsupported, or `ref`/`price` is missing where the row's `type`
            requires it.
    """
    rows: list[OperationImportRow] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for record in csv.DictReader(fh):
            op_type = OperationType(record["type"])
            if op_type not in _SUPPORTED_TYPES:
                raise ValueError(f"import-operations does not support {op_type} in this release")
            ref = record.get("ref") or None
            if op_type in _REF_REQUIRED_TYPES and ref is None:
                raise ValueError(f"{op_type} rows require a non-empty ref")
            price_raw = record.get("price") or None
            if op_type in _PRICE_REQUIRED_TYPES and price_raw is None:
                raise ValueError(f"{op_type} rows require a price")
            rows.append(
                OperationImportRow(
                    account_id=AccountId(UUID(record["account_id"])),
                    asset_id=AssetId(UUID(record["asset_id"])),
                    type=op_type,
                    trade_date=date.fromisoformat(record["trade_date"]),
                    quantity=Decimal(record["quantity"]),
                    price=Decimal(price_raw) if price_raw is not None else None,
                    fees=Decimal(record["fees"] or "0"),
                    currency=record["currency"],
                    ref=ref,
                )
            )
    return tuple(rows)
