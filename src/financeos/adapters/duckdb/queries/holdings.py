"""Read-side query: `mv_holding`, joined to `asset` for display (RFC-0004 §2.3, ADR-0003).

Only `financeos.web` may import this module (contract C4).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import duckdb


@dataclass(frozen=True)
class HoldingRow:
    """One portfolio's non-zero position in one `Asset`, as folded by `mv_holding`."""

    portfolio_id: str
    asset_id: str
    asset_name: str
    asset_class: str
    quantity: Decimal


def list_holdings(con: duckdb.DuckDBPyConnection, portfolio_id: str) -> list[HoldingRow]:
    """Every non-zero holding of `portfolio_id`, ordered by `asset_class` then `asset_name`."""
    rows = con.execute(
        """
        SELECT h.portfolio_id, a.id, a.name, a.asset_class, h.quantity
        FROM mv_holding h
        JOIN asset a ON a.id = h.asset_id
        WHERE h.portfolio_id = ?
        ORDER BY a.asset_class, a.name
        """,
        [portfolio_id],
    ).fetchall()
    return [
        HoldingRow(portfolio_id=row[0], asset_id=row[1], asset_name=row[2], asset_class=row[3],
                   quantity=row[4])
        for row in rows
    ]
