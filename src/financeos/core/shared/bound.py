"""`Bound` facts: value, source and observation time (RFC-0006 §4).

Every fact entering an evaluation is a `Bound`. That is the mechanism which makes the trace
unavoidable rather than diligent: `value` is what Stage A replays, `source` is what Stage B
resolves (ADR-0004), and `observed_at` is the staleness input. A fact with no source cannot
be constructed, so a binding can never appear in a trace without provenance.
"""

from collections.abc import Sequence
from datetime import date, timedelta

from financeos.core.shared.base import DomainModel
from financeos.core.shared.numbers import Instant


class SourceRef(DomainModel):
    """Where a bound value came from.

    Attributes:
        kind: ``"strategy_version"``, ``"derived"``, ``"seed"``, ``"price"``, ...
        ref: The identifier of a single originating row, when there is exactly one.
        engine: For derived values, the engine that computed them.
        path: The path of the value inside its origin, e.g. ``"drift.current_weight"``.
        inputs: The references a derived value was computed from (Stage B resolution).
    """

    kind: str
    ref: str | None = None
    engine: str | None = None
    path: str | None = None
    inputs: tuple[str, ...] = ()

    @classmethod
    def derived(cls, *, engine: str, inputs: Sequence[str] = ()) -> "SourceRef":
        """A value computed by an engine from the given input references."""
        return cls(kind="derived", engine=engine, inputs=tuple(inputs))

    def at_path(self, path: str) -> "SourceRef":
        """The same source, narrowed to one path inside the origin."""
        return self.model_copy(update={"path": path})


class Bound[T](DomainModel):
    """A fact: its value, its source, and when it was observed."""

    value: T
    source: SourceRef
    observed_at: Instant | None = None

    def age(self, as_of: date) -> timedelta | None:
        """Age of the observation at `as_of`, or `None` when the fact carries no time.

        Ages are measured against the run's domain date rather than a wall clock: the core
        holds no `Clock` (I-7), and a replay must not depend on when it is replayed.
        """
        if self.observed_at is None:
            return None
        return as_of - self.observed_at.date()
