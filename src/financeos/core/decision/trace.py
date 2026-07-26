"""`EvaluationTrace` — the P3 carrier and the object the replay contract quantifies over.

RFC-0009 §4.1 fixes the schema and the contract:

> Given `condition` plus the `value` of every binding, and **ignoring all `source` fields**,
> re-executing `steps` must reproduce `outcome` exactly.

Four properties are load-bearing and nothing may weaken them:

1. Every binding carries both `value` (what Stage A replays) and `source` (what Stage B
   resolves) — the whole A ⊂ B mechanism of ADR-0004.
2. `steps` are explicit and ordered: a small algebra of named operations over named values,
   which is what makes replay mechanical rather than interpretive.
3. Decimals are serialized as strings. A trace that round-trips ``0.4`` as
   ``0.4000000000000001`` is not an audit artifact.
4. `message_bindings` are captured, not re-derived at render time: the message seen in March
   must be reproducible verbatim in October.

One deliberate deviation from RFC-0009 §4.1's illustrative JSON: a step's operand list is
named `inputs`, not `in`, because `in` is a Python keyword and a serialization alias for it
would be a permanent footgun at the persistence boundary.
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Final

from pydantic import Field

from financeos.core.shared import DomainModel, Instant, Outcome, SkipReason, SourceRef

#: Schema version of this document. Stored traces are never migrated (RFC-0009 §7.2): a
#: change bumps this and the reader for every prior version is retained.
TRACE_VERSION: Final = 1


class StepOp(StrEnum):
    """The step algebra (RFC-0006 §4.1) — deliberately tiny, total and `Decimal`-exact.

    Additions require an ADR: the list growing is the signal that a general expression
    language is being reinvented by accident.
    """

    SUBTRACT = "subtract"
    ADD = "add"
    MULTIPLY = "multiply"
    DIVIDE_SAFE = "divide_safe"
    ABS = "abs"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EQ = "eq"
    ABS_GT = "abs_gt"
    RATIO_TO = "ratio_to"
    ALL = "all"
    ANY = "any"
    NOT = "not"


#: What a binding or step may hold: a canonical decimal string, a boolean, or a flat
#: mapping of canonical strings (a `Tolerance`, for instance).
type TraceValue = str | bool | Mapping[str, str]


class Binding(DomainModel):
    """One fact read during evaluation: its name, its value, and where it came from."""

    name: str
    value: TraceValue
    source: SourceRef
    observed_at: Instant | None = None


class Step(DomainModel):
    """One recorded operation over named values.

    Attributes:
        inputs: Names of bindings or of previous step outputs. A dotted name addresses a
            field of a structured binding value, e.g. ``"tolerance.band"``.
        value: The result. `None` records a `divide_safe` over a zero denominator, which is
            a skip marker rather than an error (RFC-0006 §4.1).
    """

    op: StepOp
    inputs: tuple[str, ...]
    out: str
    value: TraceValue | None = None


class ConditionRef(DomainModel):
    """The condition as evaluated: catalog kind, its version, and its canonical params."""

    kind: str
    kind_version: int
    params: Mapping[str, str] = Field(default_factory=dict)


class StaleFactNote(DomainModel):
    """Why a fact was too old to evaluate against (RFC-0006 §5: the trace records the age)."""

    name: str
    observed_at: Instant
    age_days: int
    max_staleness_days: int


class EvaluationTrace(DomainModel):
    """The complete, self-contained record of one rule evaluation (I-6)."""

    trace_version: int = TRACE_VERSION
    condition: ConditionRef
    bindings: tuple[Binding, ...] = ()
    steps: tuple[Step, ...] = ()
    outcome: Outcome
    skip_reason: SkipReason | None = None
    missing_facts: tuple[str, ...] = ()
    stale_facts: tuple[StaleFactNote, ...] = ()
    error: str | None = None
    message_bindings: Mapping[str, str] = Field(default_factory=dict)
