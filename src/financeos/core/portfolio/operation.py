"""`Operation` — the atomic financial fact (RFC-0004 §2.2, I-10).

Immutable and append-only: there are no setters and no repository update path. Corrections
are compensating rows of type `CORRECTION` (ADR-0028), never mutations.

The constructor enforces exactly the row-local rules migration `001_init.sql` encodes as
`CHECK` constraints (the ADR-L01 truth table over `corrects_id`, `transfer_pair_id` and
`cash_leg_of`). Cross-row invariants — leg totality, pair cardinality, no correction chains
— are repository-enforced by design, because a single `Operation` cannot see its sibling.
"""

from datetime import date
from enum import StrEnum
from uuid import UUID

from pydantic import model_validator

from financeos.core.shared import (
    AccountId,
    AssetId,
    Currency,
    DomainModel,
    Instant,
    MoneyAmount,
    OperationId,
    PriceAmount,
    Quantity,
)
from financeos.core.shared.errors import InvariantViolationError


class OperationType(StrEnum):
    """The seven `Operation` types (E10, ratified; ADR-0028).

    `TRANSFER` is deliberately absent: a transfer is two-sided by nature and is represented
    as a `TRANSFER_OUT`/`TRANSFER_IN` pair sharing one `transfer_pair_id`.
    """

    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    COUPON = "COUPON"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    CORRECTION = "CORRECTION"


_TRANSFER_TYPES = frozenset({OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT})
_POSITIVE_TYPES = frozenset({OperationType.BUY, OperationType.TRANSFER_IN})
_NEGATIVE_TYPES = frozenset({OperationType.SELL, OperationType.TRANSFER_OUT})


class Operation(DomainModel):
    """Aggregate root: one account's side of one financial event.

    Attributes:
        quantity: Signed change in the units of `asset_id` — securities for a primary row,
            currency units for an auto-emitted cash leg (ADR-0026).
        price: `None` on `DIVIDEND`/`COUPON` primaries, which carry `quantity = 0`; gross
            income is reconstructed as ``leg.quantity + parent.fees`` (ADR-L01).
        cash_leg_of: Set only on an auto-emitted cash leg, which carries its parent's type
            and is exempt from that type's sign check.
    """

    id: OperationId
    type: OperationType
    account_id: AccountId
    asset_id: AssetId
    trade_date: date
    quantity: Quantity
    price: PriceAmount | None = None
    fees: MoneyAmount
    currency: Currency
    import_batch_id: UUID | None = None
    corrects_id: OperationId | None = None
    transfer_pair_id: UUID | None = None
    cash_leg_of: OperationId | None = None
    recorded_at: Instant

    @model_validator(mode="after")
    def _row_local_invariants(self) -> "Operation":
        self._check_sign()
        self._check_links()
        return self

    def _check_sign(self) -> None:
        if self.cash_leg_of is not None or self.type is OperationType.CORRECTION:
            return  # legs keep their parent's type; corrections carry signed deltas
        if self.type in _POSITIVE_TYPES and self.quantity.amount <= 0:
            raise InvariantViolationError(f"{self.type} requires quantity > 0")
        if self.type in _NEGATIVE_TYPES and self.quantity.amount >= 0:
            raise InvariantViolationError(f"{self.type} requires quantity < 0")

    def _check_links(self) -> None:
        is_correction = self.type is OperationType.CORRECTION
        if is_correction and self.corrects_id is None:
            raise InvariantViolationError("CORRECTION requires corrects_id")
        if not is_correction and self.corrects_id is not None:
            raise InvariantViolationError("corrects_id is only valid on a CORRECTION")
        if self.transfer_pair_id is not None:
            if self.cash_leg_of is not None or self.corrects_id is not None:
                raise InvariantViolationError(
                    "transfer_pair_id is exclusive with cash_leg_of and corrects_id"
                )
            if self.type not in _TRANSFER_TYPES:
                raise InvariantViolationError("transfer_pair_id requires a TRANSFER_IN/OUT type")
        elif self.type in _TRANSFER_TYPES and self.cash_leg_of is None:
            raise InvariantViolationError(
                "a TRANSFER_IN/OUT row must be a pair side or a cash leg, never neither"
            )
        if self.corrects_id == self.id or self.cash_leg_of == self.id:
            raise InvariantViolationError("an Operation may not reference itself")
