"""`DuckDBAccountRepository` — `account` (ADR-0026; no core aggregate)."""

from __future__ import annotations

from uuid import UUID

import duckdb

from financeos.core.shared import AccountId, AssetId
from financeos.ports.repositories import AccountInfo


class DuckDBAccountRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def add(self, info: AccountInfo, *, name: str, type_: str) -> None:
        self._con.execute(
            "INSERT INTO account (id, name, type, currency, cash_asset_id) VALUES (?, ?, ?, ?, ?)",
            [str(info.id), name, type_, info.currency, str(info.cash_asset_id)],
        )

    def get(self, account_id: AccountId) -> AccountInfo:
        row = self._con.execute(
            "SELECT id, cash_asset_id, currency FROM account WHERE id = ?", [str(account_id)]
        ).fetchone()
        if row is None:
            raise KeyError(f"no account {account_id}")
        return AccountInfo(
            id=AccountId(UUID(row[0])), cash_asset_id=AssetId(UUID(row[1])), currency=row[2]
        )
