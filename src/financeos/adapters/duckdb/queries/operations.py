"""Read-side query: `/operations` — the ledger (screen 5, ADR-0026, ADR-0028, I-10).

Only `financeos.web` may import this module (contract C4).

**Append-only, and the UI offers no way to change or remove a row (I-10).** This table has no
mutation path at all (C6); a correction is a new `CORRECTION` row pointing at `corrects_id`,
never a change to the row it corrects. This module is read-only by construction — it has no
write function at all — and the route it feeds renders no in-place editing control either.

**Cash legs render inline, indented (UX-0001 §6.2, medium confidence, invented).** A leg carries
its parent's `type` (ADR-L01 Premise) and settles the cash side of a BUY/SELL/DIVIDEND/COUPON on
its own `account_id`/`asset_id`. Keeping every row in one ledger, with a leg indented under its
parent rather than in a second table, preserves "one row = one account's side of one event" as a
single uniform shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import duckdb


@dataclass(frozen=True)
class OperationRow:
    """One `operation` row, joined to the names a ledger reads by."""

    id: str
    type: str
    account_name: str
    asset_name: str
    asset_class: str
    trade_date: date
    quantity: Decimal
    price: Decimal | None
    fees: Decimal
    currency: str
    is_leg: bool
    parent_id: str | None  # cash_leg_of, corrects_id or transfer_pair_id — whichever applies
    link_kind: str | None  # "cash_leg" | "correction" | "transfer"


def list_operations(
    con: duckdb.DuckDBPyConnection, portfolio_id: str, *, limit: int = 500
) -> tuple[OperationRow, ...]:
    """Every Operation touching `portfolio_id`'s accounts, most recent `trade_date` first.

    Ordered by `trade_date DESC, recorded_at DESC` rather than resorted in Python — the same
    "the view's order is the page's order" discipline the findings list holds (RFC-0008 §3),
    even though nothing here is corpus-specified beyond append-only-ness.
    """
    rows = con.execute(
        """
        SELECT o.id, o.type, acc.name, a.name, a.asset_class, o.trade_date, o.quantity,
               o.price, o.fees, o.currency, o.cash_leg_of, o.corrects_id, o.transfer_pair_id
        FROM operation o
        JOIN account acc         ON acc.id = o.account_id
        JOIN asset a             ON a.id   = o.asset_id
        JOIN portfolio_account pa ON pa.account_id = o.account_id
        WHERE pa.portfolio_id = ?
        ORDER BY o.trade_date DESC, o.recorded_at DESC
        LIMIT ?
        """,
        [portfolio_id, limit],
    ).fetchall()
    return tuple(_to_row(row) for row in rows)


def _to_row(row: tuple[object, ...]) -> OperationRow:
    cash_leg_of, corrects_id, transfer_pair_id = row[10], row[11], row[12]
    if cash_leg_of is not None:
        parent_id, link_kind = str(cash_leg_of), "cash_leg"
    elif corrects_id is not None:
        parent_id, link_kind = str(corrects_id), "correction"
    elif transfer_pair_id is not None:
        parent_id, link_kind = str(transfer_pair_id), "transfer"
    else:
        parent_id, link_kind = None, None
    return OperationRow(
        id=str(row[0]),
        type=str(row[1]),
        account_name=str(row[2]),
        asset_name=str(row[3]),
        asset_class=str(row[4]),
        trade_date=row[5],  # type: ignore[arg-type]
        quantity=row[6],  # type: ignore[arg-type]
        price=row[7],  # type: ignore[arg-type]
        fees=row[8],  # type: ignore[arg-type]
        currency=str(row[9]),
        is_leg=cash_leg_of is not None,
        parent_id=parent_id,
        link_kind=link_kind,
    )
