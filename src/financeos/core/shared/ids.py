"""Identity types and the opaque taxonomy/scope keys of the shared kernel (RFC-0004 §4.1).

Identifiers are UUIDs (UUIDv7 in practice — generated behind the `IdGen` port, RFC-0009 §3,
so the core never mints one). `NewType` keeps them mutually unassignable under mypy at zero
runtime cost.

`AssetClass` is *owned* by the Portfolio context and consumed by Strategy as an opaque
taxonomy key. It lives here rather than in `core.portfolio` because contract C3 forbids one
bounded context from importing another; a shared opaque key is what makes I-14 enforceable
without an import edge.
"""

from typing import Annotated, Final, NewType
from uuid import UUID

from pydantic import StringConstraints

from financeos.core.shared.base import DomainModel
from financeos.core.shared.enums import ScopeKind

AccountId = NewType("AccountId", UUID)
AlertId = NewType("AlertId", UUID)
AssetId = NewType("AssetId", UUID)
BucketId = NewType("BucketId", UUID)
EvaluationRunId = NewType("EvaluationRunId", UUID)
OperationId = NewType("OperationId", UUID)
PortfolioId = NewType("PortfolioId", UUID)
PriceId = NewType("PriceId", UUID)
RecommendationId = NewType("RecommendationId", UUID)
RuleId = NewType("RuleId", UUID)
SnapshotId = NewType("SnapshotId", UUID)
StrategyId = NewType("StrategyId", UUID)
StrategyVersionId = NewType("StrategyVersionId", UUID)

#: ISO 4217 alphabetic currency code.
type Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]

#: A node of the `AssetClass` taxonomy, e.g. ``"EQUITY_DEVELOPED"``. Never an `AssetId` (I-14).
type AssetClass = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$")]

#: Reference kinds used in `SourceRef.inputs` and `Provenance.input_refs`.
REF_OPERATION: Final = "op"
REF_PRICE: Final = "price"
REF_APPORTIONMENT: Final = "apportionment"
REF_STRATEGY_VERSION: Final = "sv"


def entity_ref(kind: str, identifier: UUID | str) -> str:
    """Render a compact reference string, e.g. ``"op:019460a1-..."`` (RFC-0009 §4.1)."""
    return f"{kind}:{identifier}"


def asset_class_label(asset_class: str) -> str:
    """Render an `AssetClass` code as a display label: ``EQUITY_DEVELOPED`` → ``Equity/Developed``.

    A deterministic default so that `message_bindings` can be captured inside the trace
    without a taxonomy lookup. A real label table is a V1.0 taxonomy concern.
    """
    return "/".join(part.capitalize() for part in asset_class.split("_"))


class Scope(DomainModel):
    """The unit a `Rule` is evaluated against: one `Bucket`, or the whole `Portfolio`.

    Bucket scope is the normal case (ADR-0020: a Strategy is a policy, applied per Bucket).
    """

    kind: ScopeKind
    id: UUID

    @classmethod
    def for_bucket(cls, bucket_id: BucketId) -> "Scope":
        """Scope an evaluation to one `Bucket`."""
        return cls(kind=ScopeKind.BUCKET, id=bucket_id)

    @classmethod
    def for_portfolio(cls, portfolio_id: PortfolioId) -> "Scope":
        """Scope an evaluation to a whole `Portfolio`."""
        return cls(kind=ScopeKind.PORTFOLIO, id=portfolio_id)

    @property
    def ref(self) -> str:
        """The scope's canonical reference form, e.g. ``"bucket:8f3a..."``."""
        return entity_ref(self.kind.value.lower(), self.id)
