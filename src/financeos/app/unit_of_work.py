"""`UnitOfWork` — one connection's repositories, and the only place `app/` holds ports.

DuckDB has no real nested transactions, so the multi-row writers that need atomicity
(`OperationRepository.write` for W9, `EvaluationRepository.save`) wrap their own
`BEGIN`/`COMMIT` internally; every other repository call here is a single autocommitted
statement. `commit()` exists for call-site symmetry (`with uow: ... uow.commit()`) rather than
to open a second transaction layer.
"""

from __future__ import annotations

from types import TracebackType
from typing import Protocol, Self

import duckdb

from financeos.adapters.duckdb.repositories.account import DuckDBAccountRepository
from financeos.adapters.duckdb.repositories.apportionment import DuckDBApportionmentRepository
from financeos.adapters.duckdb.repositories.asset import DuckDBAssetRepository
from financeos.adapters.duckdb.repositories.evaluation import DuckDBEvaluationRepository
from financeos.adapters.duckdb.repositories.operation import DuckDBOperationRepository
from financeos.adapters.duckdb.repositories.portfolio import (
    DuckDBBucketRepository,
    DuckDBPortfolioRepository,
)
from financeos.adapters.duckdb.repositories.price import DuckDBPriceRepository
from financeos.adapters.duckdb.repositories.strategy import DuckDBStrategyRepository
from financeos.ports import (
    AccountRepository,
    ApportionmentRepository,
    AssetRepository,
    BucketRepository,
    EvaluationRepository,
    OperationRepository,
    PortfolioRepository,
    PriceRepository,
    StrategyRepository,
)


class UnitOfWork(Protocol):
    """Groups one connection's repositories (RFC-0005 §4)."""

    assets: AssetRepository
    accounts: AccountRepository
    portfolios: PortfolioRepository
    buckets: BucketRepository
    apportionments: ApportionmentRepository
    prices: PriceRepository
    operations: OperationRepository
    strategies: StrategyRepository
    evaluations: EvaluationRepository

    def commit(self) -> None: ...
    def __enter__(self) -> Self: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None: ...


class DuckDBUnitOfWork:
    """Concrete `UnitOfWork`: one DuckDB connection, repositories bound to it."""

    # Explicitly typed as the Protocol's own member types: Protocol attributes are checked
    # invariantly, so leaving these inferred as the concrete `DuckDB*Repository` types would
    # make `DuckDBUnitOfWork` fail structural assignability to `UnitOfWork` even though every
    # method matches (a well-known mypy Protocol-attribute-variance gotcha).
    assets: AssetRepository
    accounts: AccountRepository
    portfolios: PortfolioRepository
    buckets: BucketRepository
    apportionments: ApportionmentRepository
    prices: PriceRepository
    operations: OperationRepository
    strategies: StrategyRepository
    evaluations: EvaluationRepository

    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con
        self.assets = DuckDBAssetRepository(con)
        self.accounts = DuckDBAccountRepository(con)
        self.portfolios = DuckDBPortfolioRepository(con)
        self.buckets = DuckDBBucketRepository(con)
        self.apportionments = DuckDBApportionmentRepository(con)
        self.prices = DuckDBPriceRepository(con)
        self.operations = DuckDBOperationRepository(con)
        self.strategies = DuckDBStrategyRepository(con)
        self.evaluations = DuckDBEvaluationRepository(con)

    def commit(self) -> None:
        """No-op under autocommit; kept for call-site symmetry with `__enter__`/`__exit__`."""

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        pass
