"""`DuckDBPortfolioRepository` and `DuckDBBucketRepository` — thin containers (ERR-8, ERR-9)."""

from __future__ import annotations

from uuid import UUID

import duckdb

from financeos.core.portfolio import Bucket, Portfolio
from financeos.core.shared import AccountId, BucketId, PortfolioId, StrategyId


class DuckDBPortfolioRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def add(self, portfolio: Portfolio) -> None:
        self._con.execute(
            "INSERT INTO portfolio (id, name) VALUES (?, ?)", [str(portfolio.id), portfolio.name]
        )
        for account_id in portfolio.accounts:
            self.link_account(portfolio.id, account_id)

    def get(self, portfolio_id: PortfolioId) -> Portfolio:
        row = self._con.execute(
            "SELECT id, name FROM portfolio WHERE id = ?", [str(portfolio_id)]
        ).fetchone()
        if row is None:
            raise KeyError(f"no portfolio {portfolio_id}")
        return Portfolio(
            id=PortfolioId(UUID(row[0])), name=row[1], accounts=self.accounts_of(portfolio_id)
        )

    def link_account(self, portfolio_id: PortfolioId, account_id: AccountId) -> None:
        self._con.execute(
            "INSERT INTO portfolio_account (portfolio_id, account_id) VALUES (?, ?)",
            [str(portfolio_id), str(account_id)],
        )

    def accounts_of(self, portfolio_id: PortfolioId) -> tuple[AccountId, ...]:
        rows = self._con.execute(
            "SELECT account_id FROM portfolio_account WHERE portfolio_id = ?", [str(portfolio_id)]
        ).fetchall()
        return tuple(AccountId(UUID(row[0])) for row in rows)

    def all(self) -> tuple[Portfolio, ...]:
        rows = self._con.execute("SELECT id, name FROM portfolio ORDER BY id").fetchall()
        return tuple(
            Portfolio(
                id=PortfolioId(UUID(row[0])),
                name=row[1],
                accounts=self.accounts_of(PortfolioId(UUID(row[0]))),
            )
            for row in rows
        )


class DuckDBBucketRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def add(self, bucket: Bucket) -> None:
        self._con.execute(
            "INSERT INTO bucket (id, portfolio_id, strategy_id, name) VALUES (?, ?, ?, ?)",
            [str(bucket.id), str(bucket.portfolio_id), str(bucket.strategy_id), bucket.name],
        )

    def get(self, bucket_id: BucketId) -> Bucket:
        row = self._con.execute(
            "SELECT id, portfolio_id, strategy_id, name FROM bucket WHERE id = ?",
            [str(bucket_id)],
        ).fetchone()
        if row is None:
            raise KeyError(f"no bucket {bucket_id}")
        return Bucket(
            id=BucketId(UUID(row[0])),
            portfolio_id=PortfolioId(UUID(row[1])),
            strategy_id=StrategyId(UUID(row[2])),
            name=row[3],
        )

    def all_ids(self) -> tuple[BucketId, ...]:
        rows = self._con.execute("SELECT id FROM bucket ORDER BY id").fetchall()
        return tuple(BucketId(UUID(row[0])) for row in rows)

    def for_portfolio(self, portfolio_id: PortfolioId) -> tuple[BucketId, ...]:
        rows = self._con.execute(
            "SELECT id FROM bucket WHERE portfolio_id = ? ORDER BY id", [str(portfolio_id)]
        ).fetchall()
        return tuple(BucketId(UUID(row[0])) for row in rows)
