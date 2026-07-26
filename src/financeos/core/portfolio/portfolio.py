"""`Portfolio` and `Bucket` — the two thin containers of the Portfolio context."""

from financeos.core.shared import AccountId, BucketId, DomainModel, PortfolioId, StrategyId


class Portfolio(DomainModel):
    """Aggregate root: an identity plus the set of `Account`s in scope (RFC-0004 §2.2).

    Deliberately thin — it does not contain `Holding`s, which are derived.
    """

    id: PortfolioId
    name: str
    accounts: tuple[AccountId, ...] = ()


class Bucket(DomainModel):
    """Aggregate root: a pot of one `Portfolio`'s capital, governed by one `Strategy`.

    Thin since ADR-0025 moved apportionment out of the aggregate: `VirtualHolding` is now a
    derived read model, so the Bucket's transactional boundary contains no apportionment
    state. `portfolio_id` and `strategy_id` are both non-nullable (ERR-9, I-3).
    """

    id: BucketId
    portfolio_id: PortfolioId
    strategy_id: StrategyId
    name: str
