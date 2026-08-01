"""Repository ports (Protocols only — RFC-0005 §4).

One Protocol per aggregate the write side touches. Concrete implementations live in
`financeos.adapters.duckdb.repositories`; `financeos.app` depends on these Protocols, never on
the concrete classes, so a use case is testable against an in-memory fake.

`Account` has no domain aggregate (RFC-0005 §8.2 keeps Cash Flow out of the skeleton); it is
represented here as the plain `AccountInfo` DTO the cash-leg writer needs, not a `core` type.

Every write method takes its row's `id` (and `recorded_at`/`effective_from` where the table
carries one) as an explicit argument supplied by the caller through `IdGen`/`Clock` — a
repository never mints an id or reads a clock, matching the posture `core.engines` already
holds for the same reason (I-7, generalized to the boundary that actually owns the ports).
"""

from collections.abc import Collection, Mapping, Sequence
from datetime import date, datetime
from typing import NamedTuple, Protocol
from uuid import UUID

from financeos.core.decision import Alert, EvaluationRun, Recommendation, Snapshot
from financeos.core.market import PriceView
from financeos.core.portfolio import (
    ApportionmentRecord,
    Asset,
    Bucket,
    Operation,
    Portfolio,
    VirtualHolding,
)
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    Currency,
    PortfolioId,
    Quantity,
    StrategyId,
    StrategyVersionId,
)
from financeos.core.strategy import StrategyVersion


class AccountInfo(NamedTuple):
    """The minimal shape the cash-leg writer needs from `account` (ADR-0026)."""

    id: AccountId
    cash_asset_id: AssetId
    currency: Currency


class AssetRepository(Protocol):
    """`asset` — definition, mutable in place (ADR-0012)."""

    def add(self, asset: Asset) -> None: ...
    def get(self, asset_id: AssetId) -> Asset: ...
    def get_many(self, asset_ids: Collection[AssetId]) -> Mapping[AssetId, Asset]: ...
    def all(self) -> tuple[Asset, ...]: ...


class AccountRepository(Protocol):
    """`account` — definition (ADR-0026); no core aggregate, see module docstring."""

    def add(self, info: AccountInfo, *, name: str, type_: str) -> None: ...
    def get(self, account_id: AccountId) -> AccountInfo: ...


class PortfolioRepository(Protocol):
    """`portfolio` and its `portfolio_account` link (ERR-8)."""

    def add(self, portfolio: Portfolio) -> None: ...
    def get(self, portfolio_id: PortfolioId) -> Portfolio: ...
    def link_account(self, portfolio_id: PortfolioId, account_id: AccountId) -> None: ...
    def accounts_of(self, portfolio_id: PortfolioId) -> tuple[AccountId, ...]: ...


class BucketRepository(Protocol):
    """`bucket` — thin container, both `portfolio_id`/`strategy_id` required (ERR-9)."""

    def add(self, bucket: Bucket) -> None: ...
    def get(self, bucket_id: BucketId) -> Bucket: ...
    def all_ids(self) -> tuple[BucketId, ...]: ...

    def for_portfolio(self, portfolio_id: PortfolioId) -> tuple[BucketId, ...]:
        """Every Bucket belonging to `portfolio_id` (review MAJOR 3).

        `all_ids` is unfiltered across the whole store; `evaluate_strategy`'s apportionment
        fold must never pull in another Portfolio's `bucket_apportionment` chain.
        """
        ...


class ApportionmentRepository(Protocol):
    """`bucket_apportionment` — temporal append-only supersession (ADR-0025)."""

    def apportion(
        self,
        id: UUID,
        bucket_id: BucketId,
        asset_id: AssetId,
        quantity: Quantity,
        *,
        effective_from: date,
        recorded_at: datetime,
        supersedes_id: UUID | None = None,
    ) -> None: ...

    def virtual_holdings(
        self, bucket_id: BucketId, *, as_of: date
    ) -> tuple[VirtualHolding, ...]: ...

    def full_history(self, bucket_id: BucketId) -> tuple[ApportionmentRecord, ...]:
        """Every `bucket_apportionment` row for `bucket_id`, superseded rows included.

        Ordered so supersession chains are reconstructable (RFC-0009 §7.1) — used by
        `export --authored`, which is the only recovery path for this fact table.
        """
        ...


class PriceRepository(Protocol):
    """`price` — bitemporal append-only (ADR-0031)."""

    def add(
        self,
        id: UUID,
        asset_id: AssetId,
        *,
        valid_date: date,
        close: str,
        currency: Currency,
        source: str,
        recorded_at: datetime,
    ) -> None: ...

    def as_of(
        self, asset_ids: Collection[AssetId], *, as_of: date
    ) -> Mapping[AssetId, PriceView]: ...


class OperationRepository(Protocol):
    """`operation` — the one true fact table (I-10), written through ADR-L01's shapes.

    `write` is the single entry point: the caller constructs the correct row set up front
    (E-2 — no probing by catching a `ConstraintException`), and the repository validates the
    cross-row invariants W1-W10 before inserting, atomically, under one `import_batch_id`.
    """

    def write(self, operations: Sequence[Operation], *, import_batch_id: UUID) -> None: ...

    def for_accounts(
        self, account_ids: Collection[AccountId], *, as_of: date
    ) -> tuple[Operation, ...]: ...


class StrategyRepository(Protocol):
    """`strategy` + `strategy_version` (ERR-8, ADR-0027)."""

    def ensure_strategy(
        self, strategy_id: StrategyId, *, name: str, description: str | None = None
    ) -> None: ...

    def freeze_version(self, version: StrategyVersion) -> None: ...
    def current_version(self, strategy_id: StrategyId) -> StrategyVersion: ...
    def get_version(self, version_id: StrategyVersionId) -> StrategyVersion: ...
    def all_ids(self) -> tuple[StrategyId, ...]: ...

    def all_versions(self, strategy_id: StrategyId) -> tuple[StrategyVersion, ...]:
        """Every frozen `StrategyVersion` of `strategy_id`, oldest first.

        Each version is itself an authored fact (RFC-0009 §7.1): used by `export --authored`
        to walk the full lineage, not just `current_version`.
        """
        ...


class EvaluationRepository(Protocol):
    """`evaluation_run` + `alert` + `recommendation` + `snapshot` — one evaluation's
    artifacts (E4/E5, RFC-0009 §5.1)."""

    def save(
        self,
        run: EvaluationRun,
        alerts: Sequence[Alert],
        recommendations: Sequence[Recommendation],
        snapshot: Snapshot | None = None,
    ) -> None: ...
