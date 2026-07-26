"""Exact numeric primitives: fixed precisions, float ban, canonical serialization.

Precisions are the ones RFC-0009 §3 declares non-negotiable and are the exact shapes of
the DuckDB columns that store these values::

    money      DECIMAL(19,4)
    quantity   DECIMAL(28,10)
    price      DECIMAL(19,8)
    weight     DECIMAL(9,8)
    severity   DECIMAL(19,8)

`Decimal` only. A `float` reaching an evaluation would make replay (RFC-0009 §4.1)
impossible to guarantee, so floats are rejected at every construction boundary rather
than coerced.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Annotated, Any, Final

from pydantic import AfterValidator, BeforeValidator

from financeos.core.shared.errors import (
    FloatNotAllowedError,
    InvariantViolationError,
    PrecisionError,
)

MONEY_PRECISION: Final = 19
MONEY_SCALE: Final = 4
QUANTITY_PRECISION: Final = 28
QUANTITY_SCALE: Final = 10
PRICE_PRECISION: Final = 19
PRICE_SCALE: Final = 8
WEIGHT_PRECISION: Final = 9
WEIGHT_SCALE: Final = 8
SEVERITY_PRECISION: Final = 19
SEVERITY_SCALE: Final = 8
PERCENTAGE_PRECISION: Final = 9
PERCENTAGE_SCALE: Final = 2

#: Rounding applied when a value is quantized to its declared scale. Half-up is the
#: convention for monetary amounts; one mode is used everywhere so that a value's
#: canonical form never depends on which VO happened to hold it.
ROUNDING: Final = ROUND_HALF_UP


def reject_inexact(value: Any) -> Any:
    """Reject `float` and `bool` inputs before Pydantic can coerce them to `Decimal`."""
    if isinstance(value, float | bool):
        raise FloatNotAllowedError(
            f"float is not permitted in the domain core; got {value!r}. Use Decimal or str."
        )
    return value


def quantize(value: Decimal, *, precision: int, scale: int) -> Decimal:
    """Quantize `value` to `scale` decimal places, rejecting non-finite and oversized input.

    Args:
        value: The decimal to quantize.
        precision: Total number of digits permitted by the storage column.
        scale: Number of decimal places permitted by the storage column.

    Returns:
        The value quantized to exactly `scale` decimal places, with negative zero
        normalized to zero so that a value has one canonical form.

    Raises:
        PrecisionError: If the value is not finite, or does not fit `precision`/`scale`.
    """
    if not value.is_finite():
        raise PrecisionError(f"non-finite Decimal is not a domain value: {value!r}")
    limit = Decimal(10) ** (precision - scale)
    if value.copy_abs() >= limit:
        raise PrecisionError(f"{value} exceeds DECIMAL({precision},{scale})")
    try:
        quantized = value.quantize(Decimal(1).scaleb(-scale), rounding=ROUNDING)
    except InvalidOperation as exc:  # pragma: no cover - guarded by the limit above
        raise PrecisionError(f"{value} cannot be quantized to {scale} places") from exc
    return quantized if quantized else quantized.copy_abs()


def _quantizer(precision: int, scale: int) -> Callable[[Decimal], Decimal]:
    def _quantize(value: Decimal) -> Decimal:
        return quantize(value, precision=precision, scale=scale)

    return _quantize


_RejectFloat = BeforeValidator(reject_inexact)

#: Signed monetary amount, `DECIMAL(19,4)`.
type MoneyAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(MONEY_PRECISION, MONEY_SCALE))
]
#: Signed instrument quantity, `DECIMAL(28,10)`.
type QuantityAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(QUANTITY_PRECISION, QUANTITY_SCALE))
]
#: Unit price, `DECIMAL(19,8)`.
type PriceAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(PRICE_PRECISION, PRICE_SCALE))
]
#: Signed weight-scale decimal, `DECIMAL(9,8)`. Weights, drift and tolerance bands.
type WeightAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(WEIGHT_PRECISION, WEIGHT_SCALE))
]
#: Dimensionless breach ratio, `DECIMAL(19,8)` (RFC-0007 §3.1, ERR-1).
type SeverityAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(SEVERITY_PRECISION, SEVERITY_SCALE))
]
#: Percentage points, two decimal places. Rendering unit for message bindings.
type PercentageAmount = Annotated[
    Decimal, _RejectFloat, AfterValidator(_quantizer(PERCENTAGE_PRECISION, PERCENTAGE_SCALE))
]


def canonical_decimal(value: Decimal) -> str:
    """Serialize a `Decimal` as a fixed-point string at its own scale (RFC-0006 §10 rule 1).

    Values held by domain value objects are quantized on construction, so the string form
    carries the declared scale verbatim: ``Decimal("0.34000000")`` renders ``"0.34000000"``.
    """
    return format(value, "f")


def require_instant(value: datetime) -> datetime:
    """Require a timezone-aware datetime and normalize it to UTC (RFC-0006 §10 rule 3)."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise InvariantViolationError(f"timestamp must be timezone-aware: {value!r}")
    return value.astimezone(UTC)


#: Timezone-aware instant, normalized to UTC so its canonical form is stable.
Instant = Annotated[datetime, AfterValidator(require_instant)]
