"""Ports — interfaces only (RFC-0005 §4). No implementation, no I/O.

`financeos.core.engines` may never import this package (contract C2); the rest of `core`
holds to the same posture by convention. `financeos.app` is the only layer that holds ports.
"""

from financeos.ports.clock import Clock
from financeos.ports.ids import IdGen
from financeos.ports.market import PriceProvider, PriceQuote
from financeos.ports.repositories import (
    AccountInfo,
    AccountRecord,
    AccountRepository,
    ApportionmentRepository,
    AssetRepository,
    BucketRepository,
    EvaluationRepository,
    OperationRepository,
    PortfolioRepository,
    PriceRecord,
    PriceRepository,
    StrategyRepository,
)

__all__ = [
    "AccountInfo",
    "AccountRecord",
    "AccountRepository",
    "ApportionmentRepository",
    "AssetRepository",
    "BucketRepository",
    "Clock",
    "EvaluationRepository",
    "IdGen",
    "OperationRepository",
    "PortfolioRepository",
    "PriceProvider",
    "PriceQuote",
    "PriceRecord",
    "PriceRepository",
    "StrategyRepository",
]
