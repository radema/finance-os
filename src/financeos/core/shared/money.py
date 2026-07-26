"""The monetary and proportional value objects of the shared kernel (RFC-0004 §2.1)."""

from decimal import Decimal

from pydantic import model_validator

from financeos.core.shared.base import DomainModel
from financeos.core.shared.errors import (
    CurrencyMismatchError,
    FloatNotAllowedError,
    InvariantViolationError,
)
from financeos.core.shared.ids import Currency
from financeos.core.shared.numbers import (
    MoneyAmount,
    PercentageAmount,
    QuantityAmount,
    WeightAmount,
    canonical_decimal,
)


def _reject_float_factor(factor: object) -> None:
    if isinstance(factor, float | bool):
        raise FloatNotAllowedError(f"float is not permitted as a factor; got {factor!r}")


class Money(DomainModel):
    """An exact monetary amount in one currency.

    Arithmetic between differing currencies is a domain error (I-15): there is no implicit
    conversion anywhere in the core, because a silent conversion would produce a
    plausible-looking wrong number.
    """

    amount: MoneyAmount
    currency: Currency

    @classmethod
    def zero(cls, currency: str) -> "Money":
        """The zero amount in `currency`."""
        return cls(amount=Decimal(0), currency=currency)

    def _same_currency(self, other: "Money") -> None:
        if self.currency != other.currency:
            raise CurrencyMismatchError(
                f"cannot combine {self.currency} and {other.currency} without an explicit rate"
            )

    def __add__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(amount=self.amount + other.amount, currency=self.currency)

    def __sub__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(amount=self.amount - other.amount, currency=self.currency)

    def __neg__(self) -> "Money":
        return Money(amount=-self.amount, currency=self.currency)

    def __abs__(self) -> "Money":
        return Money(amount=abs(self.amount), currency=self.currency)

    def __mul__(self, factor: Decimal) -> "Money":
        _reject_float_factor(factor)
        return Money(amount=self.amount * factor, currency=self.currency)

    @property
    def is_zero(self) -> bool:
        """Whether the amount is exactly zero."""
        return self.amount == 0

    def canonical(self) -> str:
        """The amount as a fixed-scale string, e.g. ``"-3240.0000"`` (RFC-0006 §10)."""
        return canonical_decimal(self.amount)


class Quantity(DomainModel):
    """A signed instrument quantity. Fractional units are permitted; scale is fixed at 10."""

    amount: QuantityAmount

    @classmethod
    def zero(cls) -> "Quantity":
        """The zero quantity."""
        return cls(amount=Decimal(0))

    def __add__(self, other: "Quantity") -> "Quantity":
        return Quantity(amount=self.amount + other.amount)

    def __sub__(self, other: "Quantity") -> "Quantity":
        return Quantity(amount=self.amount - other.amount)

    def __neg__(self) -> "Quantity":
        return Quantity(amount=-self.amount)

    @property
    def is_zero(self) -> bool:
        """Whether the quantity is exactly zero."""
        return self.amount == 0

    def canonical(self) -> str:
        """The quantity as a fixed-scale string (RFC-0006 §10)."""
        return canonical_decimal(self.amount)


class Weight(DomainModel):
    """A proportion in ``[0, 1]``, at weight scale.

    Used for a `TargetAllocation` node's weight relative to its parent (ADR-0017) and for a
    class's share of a scope's value. Signed deviations (drift, tolerance bands) are plain
    weight-scale decimals, not `Weight`, because they legitimately fall outside ``[0, 1]``.
    """

    value: WeightAmount

    @model_validator(mode="after")
    def _within_unit_interval(self) -> "Weight":
        if not Decimal(0) <= self.value <= Decimal(1):
            raise InvariantViolationError(f"weight must lie in [0, 1]; got {self.value}")
        return self

    def canonical(self) -> str:
        """The weight as a fixed-scale string, e.g. ``"0.40000000"`` (RFC-0006 §10)."""
        return canonical_decimal(self.value)


class Percentage(DomainModel):
    """A value in percentage points, at two decimal places.

    The rendering unit of `message_bindings`: a weight of ``0.34000000`` is captured in the
    trace as a `current_pct` of ``"34.00"``.
    """

    value: PercentageAmount

    @classmethod
    def from_ratio(cls, ratio: Decimal) -> "Percentage":
        """Convert a ratio (``0.34``) into percentage points (``34.00``)."""
        _reject_float_factor(ratio)
        return cls(value=ratio * Decimal(100))

    def canonical(self) -> str:
        """The value as a fixed-scale string, e.g. ``"-6.00"`` (RFC-0006 §10)."""
        return canonical_decimal(self.value)
