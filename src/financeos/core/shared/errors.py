"""Domain error types for the Finance OS core (RFC-0004 §6).

Two families, deliberately distinguished:

* Errors raised *inside* Pydantic validators subclass :class:`ValueError` as well as
  :class:`DomainError`, so Pydantic wraps them into a ``ValidationError`` and constructor
  validation stays the enforcement point for the invariants that live there.
* Errors raised by explicit domain operations (``Money`` arithmetic, registry lookups,
  trace replay) subclass :class:`DomainError` only and propagate unwrapped.
"""


class DomainError(Exception):
    """Base class for every error raised by the domain core."""


class CurrencyMismatchError(DomainError):
    """Arithmetic between two `Money` values of different currencies (I-15)."""


class TemplateRenderError(DomainError):
    """A `MessageTemplate` referenced a binding that the trace does not carry."""


class UnknownConditionKindError(DomainError):
    """A `Rule` referenced a `Condition` kind/version absent from the catalog."""


class RegistryError(DomainError):
    """A `Condition` kind registration is incomplete or duplicated (RFC-0006 §12)."""


class ReplayMismatchError(DomainError):
    """Re-executing a trace's steps did not reproduce a recorded value (RFC-0009 §4.1)."""


class RuleNotInVersionError(DomainError):
    """A firing's `rule_id` is absent from the pinned `StrategyVersion` (ADR-0027)."""


class DomainValueError(DomainError, ValueError):
    """Base for errors raised inside constructor validation.

    Subclassing `ValueError` is what makes Pydantic wrap these into a `ValidationError`,
    so constructor validation remains the enforcement point (RFC-0004 §6).
    """


class FloatNotAllowedError(DomainValueError):
    """A `float` was offered where an exact `Decimal` is required (RFC-0005 §5.1)."""


class PrecisionError(DomainValueError):
    """A `Decimal` is non-finite or exceeds its declared precision (RFC-0009 §3)."""


class InvariantViolationError(DomainValueError):
    """A declared domain invariant was violated at construction time."""
