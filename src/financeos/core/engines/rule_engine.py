"""Rule Engine — condition evaluation, the trace algebra, and replay (RFC-0006).

Three things live here and they are deliberately one module, because splitting them is how
the replay contract rots:

* **`TraceRecorder`** — the trace is not emitted, it is *accumulated*. Reading a fact appends
  a binding; every arithmetic step goes through the recorder and appends a step. There is no
  code path that evaluates without producing a trace, because the values being evaluated
  *are* the trace bindings. I-6 therefore cannot decay into decoration: decoration would
  require a second, untraced arithmetic path, and one does not exist.
* **The step algebra** — small, total, `Decimal`-exact, and executed under a fixed decimal
  context so that a replay on another machine cannot diverge. One implementation serves both
  recording and replay, so the two cannot drift apart.
* **`replay_trace`** — the executable form of RFC-0009 §4.1's contract: given `condition`
  plus each binding's `value`, and **ignoring every `source`**, re-executing `steps`
  reproduces `outcome` exactly.

`evaluate(rules, facts)` is pure: the recorder is local mutable state returned as part of the
output, so no port is held (I-7 / contract C2) and a re-run is byte-reproducible.
"""

from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta
from decimal import Context, Decimal, localcontext
from typing import Any, Final

from pydantic import BaseModel, Field, ValidationError, model_validator

from financeos.core.decision import (
    Binding,
    ConditionRef,
    EvaluationTrace,
    FactUnavailable,
    RuleFiring,
    StaleFactNote,
    Step,
    StepOp,
    TraceValue,
)
from financeos.core.portfolio import AllocationLine
from financeos.core.shared import (
    AssetClass,
    Bound,
    Currency,
    DomainModel,
    Money,
    MoneyAmount,
    Outcome,
    Percentage,
    Role,
    Scope,
    SeverityAmount,
    SkipReason,
    SourceRef,
    WeightAmount,
    canonical_decimal,
    copula,
    label,
    priority_rank,
)
from financeos.core.shared.errors import (
    InvariantViolationError,
    RegistryError,
    ReplayMismatchError,
    UnknownConditionKindError,
)
from financeos.core.shared.numbers import ROUNDING
from financeos.core.strategy import DriftLine, Rule

ENGINE_VERSION: Final = "1.0.0"
ENGINE_NAME: Final = "rule"

#: The name of the drift fact family (RFC-0006 §4).
FACT_DRIFT: Final = "drift"

#: The name of the allocation fact family (RFC-0006 §4): one `AllocationLine` per held
#: `AssetClass`, targeted or not — unlike `drift`, which carries only targeted leaves.
FACT_ALLOCATION: Final = "allocation"

#: The name of the residual fact family (RFC-0006 §4, ADR-0029): the `UNASSIGNED` pseudo-
#: bucket's weight, relative to total portfolio value. Portfolio-scoped by nature.
FACT_RESIDUAL: Final = "residual"

#: The name of the bucket-value fact family (RFC-0006 §3, ERR-4): a scope's total valued
#: holdings, for `bucket_below_target_value`. ERR-4 removed the phantom `prices` fact this
#: kind's catalog row once carried; this is `allocation`'s scope-level total, not a per-class
#: mapping, so it is named separately from `FACT_ALLOCATION`.
FACT_BUCKET_VALUE: Final = "bucket_value"

#: The algebra runs under a fixed decimal context, so neither the ambient context of a caller
#: nor the machine a replay happens on can change a recorded value.
_ALGEBRA_CONTEXT: Final = Context(prec=28, rounding=ROUNDING)


# --------------------------------------------------------------------------------------
# Facts: the input contract (RFC-0006 §4)
# --------------------------------------------------------------------------------------


class FactSet(DomainModel):
    """A frozen, fully-materialized set of facts for one scope at one date.

    No lazy loading is possible — engines hold no repository (I-7) — so the application
    service assembles everything first (RFC-0005 §3).

    Attributes:
        drift: One `Bound[DriftLine]` per targeted `AssetClass`, from the Strategy Engine.
        unavailable: Why a whole fact family could not be computed, e.g.
            ``{"drift": SkipReason.ZERO_PORTFOLIO_VALUE}``. The reason reaches the trace, so a
            rule that could not be evaluated never reads as `NOT_FIRED` (ADR-0016).
        labels: Display labels for `AssetClass` codes, supplied by the caller that owns the
            taxonomy. Falls back to a deterministic rendering of the code.
    """

    as_of: date
    scope: Scope
    drift: Mapping[AssetClass, Bound[DriftLine]] = Field(default_factory=dict)
    allocation: Mapping[AssetClass, Bound[AllocationLine]] = Field(default_factory=dict)
    residual: Bound[WeightAmount] | None = None
    bucket_value: Bound[Money] | None = None
    unavailable: Mapping[str, SkipReason] = Field(default_factory=dict)
    labels: Mapping[AssetClass, str] = Field(default_factory=dict)

    def drift_for(self, asset_class: AssetClass) -> Bound[DriftLine] | None:
        """The drift fact for one class, or `None` if that class is not targeted."""
        return self.drift.get(asset_class)

    def allocation_for(self, asset_class: AssetClass) -> Bound[AllocationLine] | None:
        """The allocation fact for one held class, or `None` if it is not held at all."""
        return self.allocation.get(asset_class)

    def unavailable_reason(self, family: str) -> SkipReason | None:
        """Why `family` could not be computed at all, if it could not."""
        return self.unavailable.get(family)

    def label_for(self, asset_class: AssetClass) -> str:
        """The display label of an `AssetClass` (L05 §6.2).

        `self.labels`, when the caller supplies an override, wins first; otherwise the L05
        label registry supplies the noun, which itself degrades to the mechanical
        `asset_class_label` rendering for a class the registry does not yet know (E12: the
        taxonomy is open, so this is not a defect in either lookup).
        """
        return self.labels.get(asset_class) or label(asset_class)


# --------------------------------------------------------------------------------------
# The step algebra (RFC-0006 §4.1)
# --------------------------------------------------------------------------------------

_ARITHMETIC: Final = frozenset(
    {
        StepOp.SUBTRACT,
        StepOp.ADD,
        StepOp.MULTIPLY,
        StepOp.DIVIDE_SAFE,
        StepOp.ABS,
        StepOp.RATIO_TO,
    }
)


def _as_decimal(value: TraceValue) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, str):
        raise ReplayMismatchError(f"expected a decimal operand, got {value!r}")
    return Decimal(value)


def _as_bool(value: TraceValue) -> bool:
    if not isinstance(value, bool):
        raise ReplayMismatchError(f"expected a boolean operand, got {value!r}")
    return value


def _ratio(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    """Division that returns the skip marker on a zero denominator (RFC-0006 §4.1).

    A zero-value portfolio is a legitimate state during onboarding, not an error, so this
    never raises. The quotient is left at the algebra context's precision rather than
    quantized to a storage scale: the algebra must be *total*, and clamping a ratio to
    `DECIMAL(19,8)` would make a large one raise exactly where a kind is most urgent.
    Determinism comes from the fixed context, not from quantization.
    """
    if denominator == 0:
        return None
    return numerator / denominator


def apply_op(op: StepOp, operands: Sequence[TraceValue]) -> TraceValue | None:
    """Execute one algebra operation. `None` is the skip marker of a zero denominator.

    Used by both the recorder and `replay_trace`, so the semantics of a step cannot differ
    between the two.
    """
    with localcontext(_ALGEBRA_CONTEXT):
        if op in _ARITHMETIC:
            numbers = [_as_decimal(operand) for operand in operands]
            result = _arithmetic(op, numbers)
            return None if result is None else canonical_decimal(result)
        return _predicate(op, operands)


def _arithmetic(op: StepOp, numbers: Sequence[Decimal]) -> Decimal | None:
    match op:
        case StepOp.SUBTRACT:
            return numbers[0] - numbers[1]
        case StepOp.ADD:
            return sum(numbers, start=Decimal(0))
        case StepOp.MULTIPLY:
            product = Decimal(1)
            for number in numbers:
                product *= number
            return product
        case StepOp.ABS:
            return abs(numbers[0])
        case _:  # DIVIDE_SAFE | RATIO_TO
            return _ratio(numbers[0], numbers[1])


def _predicate(op: StepOp, operands: Sequence[TraceValue]) -> bool:
    match op:
        case StepOp.GT:
            return _as_decimal(operands[0]) > _as_decimal(operands[1])
        case StepOp.GTE:
            return _as_decimal(operands[0]) >= _as_decimal(operands[1])
        case StepOp.LT:
            return _as_decimal(operands[0]) < _as_decimal(operands[1])
        case StepOp.LTE:
            return _as_decimal(operands[0]) <= _as_decimal(operands[1])
        case StepOp.EQ:
            return _as_decimal(operands[0]) == _as_decimal(operands[1])
        case StepOp.ABS_GT:
            return abs(_as_decimal(operands[0])) > _as_decimal(operands[1])
        case StepOp.ALL:
            return all(_as_bool(operand) for operand in operands)
        case StepOp.ANY:
            return any(_as_bool(operand) for operand in operands)
        case _:  # NOT
            return not _as_bool(operands[0])


def _canonical(value: Decimal | bool | Mapping[str, str]) -> TraceValue:
    """The canonical trace form of a value (RFC-0006 §10)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return canonical_decimal(value)
    return dict(value)


def resolve(environment: Mapping[str, TraceValue], name: str) -> TraceValue:
    """Look a name up in an evaluation environment, following one dotted path segment.

    ``"tolerance.band"`` addresses a member of a structured binding value. A name that is
    not present is a broken trace: it means a step consumed a value that was never bound.
    """
    head, _, tail = name.partition(".")
    if head not in environment:
        raise ReplayMismatchError(f"step references unbound name {name!r}")
    value = environment[head]
    if not tail:
        return value
    if not isinstance(value, Mapping):
        raise ReplayMismatchError(f"{head!r} is not a structured value; cannot read {tail!r}")
    if tail not in value:
        raise ReplayMismatchError(f"{head!r} has no member {tail!r}")
    return value[tail]


# --------------------------------------------------------------------------------------
# The recorder
# --------------------------------------------------------------------------------------


class SkipSignal(Exception):  # noqa: N818 - control flow, not an error condition
    """Raised by the recorder when a fact or a divisor makes the rule unevaluable.

    Control flow, not a defect: `evaluate` catches it and records `SKIPPED` with the reason.
    An evaluator must never swallow it — doing so would turn an unevaluable rule into a
    reassuring `NOT_FIRED`, which is the inverted failure ADR-0016 exists to prevent.
    """

    def __init__(
        self,
        reason: SkipReason,
        *,
        unavailable: Sequence[FactUnavailable] = (),
        stale: Sequence[StaleFactNote] = (),
    ) -> None:
        super().__init__(reason.value)
        self.reason = reason
        self.unavailable = tuple(unavailable)
        self.stale = tuple(stale)


class FactHandle[T]:
    """A fact opened for reading: binds its members with the fact's own provenance."""

    def __init__(self, recorder: "TraceRecorder", fact: Bound[T]) -> None:
        self._recorder = recorder
        self._fact = fact

    @property
    def value(self) -> T:
        """The fact's payload."""
        return self._fact.value

    def bind(self, name: str, value: Decimal | bool | Mapping[str, str]) -> TraceValue:
        """Record one member of this fact as a named binding.

        Returns:
            The value in its canonical trace form — exactly what a replay will read, so an
            evaluator can never compute on more precision than it recorded.
        """
        return self._recorder.bind(
            name,
            value,
            source=self._fact.source.at_path(name),
            observed_at=self._fact.observed_at,
        )


class TraceRecorder:
    """Accumulates the trace of one rule evaluation.

    Local mutable state, returned as output: `evaluate` stays a pure function of its inputs.
    """

    def __init__(
        self,
        *,
        condition: ConditionRef,
        as_of: date,
        max_staleness: timedelta | None = None,
    ) -> None:
        self._condition = condition
        self._as_of = as_of
        self._max_staleness = max_staleness
        self._bindings: list[Binding] = []
        self._steps: list[Step] = []
        self._environment: dict[str, TraceValue] = {}
        self._message_bindings: dict[str, str] = {}

    # -- facts ---------------------------------------------------------------------

    def open_fact[T](self, name: str, fact: Bound[T] | None) -> FactHandle[T]:
        """Open a required fact for reading.

        Raises:
            SkipSignal: With `missing_fact` when the fact is absent, or `stale_fact` when it is
                older than the condition's `max_staleness`. Both are recorded in the trace,
                so the resulting `Alert` says *why* it could not be evaluated rather than
                reporting a reassuring `NOT_FIRED`.
        """
        if fact is None:
            raise SkipSignal(
                SkipReason.MISSING_FACT,
                unavailable=(FactUnavailable(name=name, reason=SkipReason.MISSING_FACT),),
            )
        age = fact.age(self._as_of)
        if (
            self._max_staleness is not None
            and age is not None
            and fact.observed_at is not None
            and age > self._max_staleness
        ):
            raise SkipSignal(
                SkipReason.STALE_FACT,
                stale=(
                    StaleFactNote(
                        name=name,
                        observed_at=fact.observed_at,
                        age_days=age.days,
                        max_staleness_days=self._max_staleness.days,
                    ),
                ),
            )
        return FactHandle(self, fact)

    def bind(
        self,
        name: str,
        value: Decimal | bool | Mapping[str, str],
        *,
        source: SourceRef,
        observed_at: datetime | None = None,
    ) -> TraceValue:
        """Record a named binding and make it available to subsequent steps."""
        canonical = _canonical(value)
        self._bindings.append(
            Binding(name=name, value=canonical, source=source, observed_at=observed_at)
        )
        self._environment[name] = canonical
        return canonical

    def message_bindings(self, bindings: Mapping[str, str]) -> None:
        """Capture the bindings a `MessageTemplate` may interpolate (RFC-0009 §4.1).

        Captured rather than re-derived at render time, so the message seen in March is
        reproducible verbatim in October.
        """
        self._message_bindings.update(bindings)

    # -- algebra -------------------------------------------------------------------

    def subtract(self, out: str, left: str, right: str) -> Decimal:
        """`left − right`."""
        return self._decimal_step(StepOp.SUBTRACT, out, (left, right))

    def add(self, out: str, *names: str) -> Decimal:
        """The sum of the named values."""
        return self._decimal_step(StepOp.ADD, out, names)

    def multiply(self, out: str, *names: str) -> Decimal:
        """The product of the named values."""
        return self._decimal_step(StepOp.MULTIPLY, out, names)

    def absolute(self, out: str, name: str) -> Decimal:
        """`|value|`."""
        return self._decimal_step(StepOp.ABS, out, (name,))

    def divide_safe(self, out: str, numerator: str, denominator: str) -> Decimal:
        """`numerator / denominator`, skipping on a zero denominator rather than raising."""
        return self._decimal_step(StepOp.DIVIDE_SAFE, out, (numerator, denominator))

    def ratio_to(self, out: str, numerator: str, denominator: str) -> Decimal:
        """A dimensionless ratio, skipping on a zero denominator."""
        return self._decimal_step(StepOp.RATIO_TO, out, (numerator, denominator))

    def gt(self, out: str, left: str, right: str) -> bool:
        """`left > right`."""
        return self._bool_step(StepOp.GT, out, (left, right))

    def gte(self, out: str, left: str, right: str) -> bool:
        """`left >= right`."""
        return self._bool_step(StepOp.GTE, out, (left, right))

    def lt(self, out: str, left: str, right: str) -> bool:
        """`left < right`."""
        return self._bool_step(StepOp.LT, out, (left, right))

    def lte(self, out: str, left: str, right: str) -> bool:
        """`left <= right`."""
        return self._bool_step(StepOp.LTE, out, (left, right))

    def eq(self, out: str, left: str, right: str) -> bool:
        """`left == right`."""
        return self._bool_step(StepOp.EQ, out, (left, right))

    def abs_gt(self, out: str, value: str, bound: str) -> bool:
        """`|value| > bound` — the breach test of every band-based condition."""
        return self._bool_step(StepOp.ABS_GT, out, (value, bound))

    def all_of(self, out: str, *names: str) -> bool:
        """Conjunction of the named booleans."""
        return self._bool_step(StepOp.ALL, out, names)

    def any_of(self, out: str, *names: str) -> bool:
        """Disjunction of the named booleans."""
        return self._bool_step(StepOp.ANY, out, names)

    def negate(self, out: str, name: str) -> bool:
        """Negation of the named boolean."""
        return self._bool_step(StepOp.NOT, out, (name,))

    # -- output --------------------------------------------------------------------

    def trace(
        self,
        outcome: Outcome,
        *,
        skip_reason: SkipReason | None = None,
        unavailable_facts: Sequence[FactUnavailable] = (),
        stale_facts: Sequence[StaleFactNote] = (),
        error: str | None = None,
    ) -> EvaluationTrace:
        """Seal what was recorded into an `EvaluationTrace`."""
        return EvaluationTrace(
            condition=self._condition,
            bindings=tuple(self._bindings),
            steps=tuple(self._steps),
            outcome=outcome,
            skip_reason=skip_reason,
            unavailable_facts=tuple(unavailable_facts),
            stale_facts=tuple(stale_facts),
            error=error,
            message_bindings=dict(self._message_bindings),
        )

    # -- internals -----------------------------------------------------------------

    def _step(self, op: StepOp, out: str, names: Sequence[str]) -> TraceValue:
        """Execute one operation, record it, and return its value.

        The step is appended *before* the zero-denominator check, so the null-valued step
        survives in the trace and a replay can read the skip from the evidence.
        """
        operands = [resolve(self._environment, name) for name in names]
        result = apply_op(op, operands)
        self._steps.append(Step(op=op, inputs=tuple(names), out=out, value=result))
        if result is None:
            raise SkipSignal(SkipReason.ZERO_DENOMINATOR)
        self._environment[out] = result
        return result

    def _decimal_step(self, op: StepOp, out: str, names: Sequence[str]) -> Decimal:
        return _as_decimal(self._step(op, out, names))

    def _bool_step(self, op: StepOp, out: str, names: Sequence[str]) -> bool:
        return _as_bool(self._step(op, out, names))


# --------------------------------------------------------------------------------------
# The catalog: a closed, versioned registry of typed kinds (ADR-0014)
# --------------------------------------------------------------------------------------


class ConditionResult(DomainModel):
    """What an evaluator concluded: whether the predicate held, and how badly."""

    fired: bool
    severity: SeverityAmount | None = None


class SeverityDeclaration(DomainModel):
    """How a kind expresses urgency, or its explicit refusal to (RFC-0007 §3.1).

    `formula` has no default, so a kind cannot be registered without deciding: either a
    formula in domain terms — dimensionless, reading 1.0 at the kind's own firing threshold —
    or an explicit `None`.
    """

    formula: str | None


class ConditionKindSpec[P: BaseModel](DomainModel):
    """One entry of the condition catalog.

    Every field is required, so omitting any of the seven mandatory registration components —
    kind and version, params model, `required_facts`, evaluator, severity declaration,
    explanation template, numeric bindings — is a construction failure, which is RFC-0006 §12's
    completeness test enforced by the type system as well as by a test. `default_max_staleness`
    is the eighth, added by ERR-10; `None` declares that the kind reads no time-sensitive fact.

    `numeric_bindings` (L05 §7.3, C-L05-3) declares which of this kind's `message_bindings`
    names carry a locale-formattable `Decimal`. It is declared, never inferred: a naming
    convention silently misses a future binding, and regexing the stored *value* would happily
    "localise" an opaque identifier (an ISIN, a scope ref). Every binding not named here — asset
    class codes, labels, scope refs, currency codes — passes through display re-rendering
    untouched.
    """

    kind: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    kind_version: int = Field(ge=1)
    params_model: type[P]
    required_facts: frozenset[str]
    default_max_staleness: timedelta | None
    severity: SeverityDeclaration
    explanation_template: str = Field(min_length=1)
    numeric_bindings: frozenset[str]
    evaluate: Callable[[P, FactSet, TraceRecorder], ConditionResult]

    @model_validator(mode="after")
    def _declares_everything(self) -> "ConditionKindSpec[P]":
        if not self.required_facts:
            raise InvariantViolationError(f"{self.kind}: a kind must declare the facts it consumes")
        return self

    def render_explanation(self, message_bindings: Mapping[str, str]) -> str:
        """Render this kind's explanation in domain terms from captured bindings."""
        return self.explanation_template.format(**message_bindings)


class ConditionRegistry:
    """The closed catalog. Adding a kind is a code change, deliberately (ADR-0014)."""

    def __init__(self) -> None:
        self._specs: dict[tuple[str, int], ConditionKindSpec[Any]] = {}

    def register(self, spec: ConditionKindSpec[Any]) -> ConditionKindSpec[Any]:
        """Register a kind.

        Raises:
            RegistryError: If the same `(kind, kind_version)` is already registered. A kind's
                semantics never change — a new meaning is a new kind (RFC-0006 §8).
        """
        key = (spec.kind, spec.kind_version)
        if key in self._specs:
            raise RegistryError(f"{spec.kind} v{spec.kind_version} is already registered")
        self._specs[key] = spec
        return spec

    def get(self, kind: str, kind_version: int) -> ConditionKindSpec[Any]:
        """Look up a kind.

        Raises:
            UnknownConditionKindError: If the kind or version is not in the catalog.
        """
        try:
            return self._specs[(kind, kind_version)]
        except KeyError as exc:
            raise UnknownConditionKindError(
                f"unknown condition kind {kind} v{kind_version}"
            ) from exc

    def all_kinds(self) -> tuple[ConditionKindSpec[Any], ...]:
        """Every registered kind, ordered by kind then version."""
        return tuple(spec for _, spec in sorted(self._specs.items()))


REGISTRY: Final = ConditionRegistry()


# --------------------------------------------------------------------------------------
# The skeleton's single kind: drift_outside_tolerance v1 (RFC-0006 §12)
# --------------------------------------------------------------------------------------


class DriftOutsideToleranceParams(BaseModel):
    """Params of `drift_outside_tolerance`: which class, in which scope."""

    model_config = {"frozen": True, "extra": "forbid"}

    asset_class: AssetClass
    scope: str


def evaluate_drift_outside_tolerance(
    params: DriftOutsideToleranceParams, facts: FactSet, recorder: TraceRecorder
) -> ConditionResult:
    """Fire when a targeted class's drift exceeds its effective band.

    The predicate is `|current_weight − effective_target| > effective_band`. `drift` is
    recomputed here as a *step* rather than read as a value, because the intermediate
    computation is what the explanation surface shows and what replay re-executes
    (RFC-0009 §4.1). `severity` and `effective_band` arrive pre-computed from the Strategy
    Engine: the Rule Engine performs no financial computation (RFC-0006 §3.1).
    """
    fact = recorder.open_fact(
        f"{FACT_DRIFT}:{params.asset_class}", facts.drift_for(params.asset_class)
    )
    line = fact.value
    fact.bind("current_weight", line.current_weight)
    fact.bind("effective_target", line.effective_target)
    fact.bind("tolerance", line.tolerance.as_binding())
    fact.bind("effective_band", line.effective_band)
    if line.severity is not None:
        fact.bind("severity", line.severity)

    drift = recorder.subtract("drift", "current_weight", "effective_target")
    breached = recorder.abs_gt("breached", "drift", "effective_band")

    recorder.message_bindings(_drift_message_bindings(params, facts, line, drift))
    return ConditionResult(fired=breached, severity=line.severity)


def _drift_message_bindings(
    params: DriftOutsideToleranceParams, facts: FactSet, line: DriftLine, drift: Decimal
) -> dict[str, str]:
    bindings = {
        "asset_class": params.asset_class,
        "asset_class_label": facts.label_for(params.asset_class),
        # L05 §4.2's role bindings, append-only: a MessageTemplate is frozen, and `str.format`
        # ignores surplus keys, so an old template keeps rendering unchanged against these.
        "asset_class_label_the": label(params.asset_class, role=Role.THE),
        "asset_class_label_the_cap": label(
            params.asset_class, role=Role.THE, sentence_initial=True
        ),
        "asset_class_label_of": label(params.asset_class, role=Role.OF),
        "asset_class_label_in": label(params.asset_class, role=Role.IN),
        "asset_class_copula": copula(params.asset_class),
        "scope": params.scope,
        "currency": line.current_value.currency,
        "current_pct": Percentage.from_ratio(line.current_weight).canonical(),
        "target_pct": Percentage.from_ratio(line.effective_target).canonical(),
        "drift_pct": Percentage.from_ratio(drift).canonical(),
        "tolerance_pct": Percentage.from_ratio(line.effective_band).canonical(),
        "current_value": line.current_value.canonical(),
        "target_value": line.target_value.canonical(),
        "drift_value": line.drift_value.canonical(),
    }
    if line.severity is not None:
        bindings["severity"] = canonical_decimal(line.severity)
    return bindings


DRIFT_OUTSIDE_TOLERANCE: Final = REGISTRY.register(
    ConditionKindSpec(
        kind="drift_outside_tolerance",
        kind_version=1,
        params_model=DriftOutsideToleranceParams,
        required_facts=frozenset({FACT_DRIFT}),
        default_max_staleness=timedelta(days=7),
        severity=SeverityDeclaration(formula="|drift| / effective_band"),
        # D-L05-5 / L05 §4.3(A): the previous template hardcoded "è", wrong for the four
        # fixture classes that are feminine plural ("Azioni" wants "sono"). The role bindings
        # above carry the agreement so one template is grammatical for every class.
        explanation_template=(
            "{asset_class_label_the_cap} {asset_class_copula} al {current_pct}% contro un "
            "target del {target_pct}% (tolleranza ±{tolerance_pct}pp): scostamento di "
            "{drift_pct}pp ({drift_value} {currency})."
        ),
        numeric_bindings=frozenset(
            {
                "current_pct",
                "target_pct",
                "drift_pct",
                "tolerance_pct",
                "current_value",
                "target_value",
                "drift_value",
                "severity",
            }
        ),
        evaluate=evaluate_drift_outside_tolerance,
    )
)


# --------------------------------------------------------------------------------------
# untargeted_allocation v1 (RFC-0007 §4.2, ADR-L04 §4.7 D6)
# --------------------------------------------------------------------------------------


class UntargetedAllocationParams(BaseModel):
    """Params of `untargeted_allocation`: the held-but-untargeted class, its scope, and the
    weight threshold above which untargeted capital is worth a finding.

    D6 (ADR-L04 §4.7, ratified P30): `threshold_weight <= 0` is rejected here, at construction,
    rather than left to `SKIPPED(zero_denominator)` — the `divide_safe` skip path — at exactly
    the state (untargeted capital exists) this kind exists to explain.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    asset_class: AssetClass
    scope: str
    threshold_weight: WeightAmount

    @model_validator(mode="after")
    def _threshold_is_positive(self) -> "UntargetedAllocationParams":
        if self.threshold_weight <= 0:
            raise InvariantViolationError(
                "untargeted_allocation: threshold_weight must be > 0; "
                f"got {self.threshold_weight}"
            )
        return self


def evaluate_untargeted_allocation(
    params: UntargetedAllocationParams, facts: FactSet, recorder: TraceRecorder
) -> ConditionResult:
    """Fire when a held `AssetClass` with no target exceeds `threshold_weight` of the scope.

    Reads `allocation`, not `drift`: `compute_drift` iterates only the target tree's leaves
    (RFC-0007 §4), so an untargeted class never gets a `DriftLine` — `allocation` is the fact
    family that carries a weight for it at all. `severity = current_weight / threshold_weight`
    (RFC-0007 §4.2), anchored at `1.0` on the authored threshold.
    """
    fact = recorder.open_fact(
        f"{FACT_ALLOCATION}:{params.asset_class}", facts.allocation_for(params.asset_class)
    )
    line = fact.value
    fact.bind("current_weight", line.weight.value)
    recorder.bind(
        "threshold_weight",
        params.threshold_weight,
        source=SourceRef(kind="params", path="threshold_weight"),
    )
    severity = recorder.ratio_to("severity", "current_weight", "threshold_weight")
    breached = recorder.gt("breached", "current_weight", "threshold_weight")

    recorder.message_bindings(
        _untargeted_allocation_message_bindings(params, facts, line, severity)
    )
    return ConditionResult(fired=breached, severity=severity)


def _untargeted_allocation_message_bindings(
    params: UntargetedAllocationParams,
    facts: FactSet,
    line: AllocationLine,
    severity: Decimal,
) -> dict[str, str]:
    return {
        "asset_class": params.asset_class,
        "asset_class_label": facts.label_for(params.asset_class),
        "asset_class_label_the": label(params.asset_class, role=Role.THE),
        "asset_class_label_the_cap": label(
            params.asset_class, role=Role.THE, sentence_initial=True
        ),
        "asset_class_label_of": label(params.asset_class, role=Role.OF),
        "asset_class_copula": copula(params.asset_class),
        "scope": params.scope,
        "currency": line.value.currency,
        "current_pct": Percentage.from_ratio(line.weight.value).canonical(),
        "threshold_pct": Percentage.from_ratio(params.threshold_weight).canonical(),
        "current_value": line.value.canonical(),
        "severity": canonical_decimal(severity),
    }


UNTARGETED_ALLOCATION: Final = REGISTRY.register(
    ConditionKindSpec(
        kind="untargeted_allocation",
        kind_version=1,
        params_model=UntargetedAllocationParams,
        required_facts=frozenset({FACT_ALLOCATION}),
        default_max_staleness=timedelta(days=7),
        severity=SeverityDeclaration(formula="current_weight / threshold_weight"),
        explanation_template=(
            "{asset_class_label_the_cap} {asset_class_copula} al {current_pct}% del "
            "portafoglio ({current_value} {currency}), priva di un target nella strategia "
            "in vigore: soglia di attenzione {threshold_pct}%."
        ),
        numeric_bindings=frozenset(
            {"current_pct", "threshold_pct", "current_value", "severity"}
        ),
        evaluate=evaluate_untargeted_allocation,
    )
)


# --------------------------------------------------------------------------------------
# unassigned_residual_above v1 (ADR-L02 §4.2, ADR-0029)
# --------------------------------------------------------------------------------------


class UnassignedResidualAboveParams(BaseModel):
    """Params of `unassigned_residual_above`: only the authored threshold.

    ADR-0029: `threshold_weight` is relative to total portfolio value and the rule is
    portfolio-scoped by nature, so `scope` is not a param here (it was never meaningful).
    The params model rejects `threshold_weight <= 0` (ADR-L02 §4.2), the same guard D6 later
    requires of `untargeted_allocation`.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    threshold_weight: WeightAmount

    @model_validator(mode="after")
    def _threshold_is_positive(self) -> "UnassignedResidualAboveParams":
        if self.threshold_weight <= 0:
            raise InvariantViolationError(
                "unassigned_residual_above: threshold_weight must be > 0; "
                f"got {self.threshold_weight}"
            )
        return self


def evaluate_unassigned_residual_above(
    params: UnassignedResidualAboveParams, facts: FactSet, recorder: TraceRecorder
) -> ConditionResult:
    """Fire when the `UNASSIGNED` residual weight exceeds `threshold_weight`.

    `severity = residual_weight / threshold_weight` (ADR-L02 §4.2), with **no `abs()`** on the
    numerator: a negative residual is a legal deficit (ADR-0025) and never fires this kind
    (the comparison is signed), so the deficit case stays owned by `over_apportioned`. The
    negative severity that can therefore persist on a `NOT_FIRED` row is deliberate — wrapping
    the numerator in `abs()` would report high urgency under a rule that did not fire.
    """
    fact = recorder.open_fact(FACT_RESIDUAL, facts.residual)
    residual_weight = fact.value
    fact.bind("residual_weight", residual_weight)
    recorder.bind(
        "threshold_weight",
        params.threshold_weight,
        source=SourceRef(kind="params", path="threshold_weight"),
    )
    severity = recorder.ratio_to("severity", "residual_weight", "threshold_weight")
    breached = recorder.gt("breached", "residual_weight", "threshold_weight")

    recorder.message_bindings(
        _unassigned_residual_above_message_bindings(params, residual_weight, severity)
    )
    return ConditionResult(fired=breached, severity=severity)


def _unassigned_residual_above_message_bindings(
    params: UnassignedResidualAboveParams, residual_weight: Decimal, severity: Decimal
) -> dict[str, str]:
    return {
        "residual_pct": Percentage.from_ratio(residual_weight).canonical(),
        "threshold_pct": Percentage.from_ratio(params.threshold_weight).canonical(),
        "severity": canonical_decimal(severity),
    }


UNASSIGNED_RESIDUAL_ABOVE: Final = REGISTRY.register(
    ConditionKindSpec(
        kind="unassigned_residual_above",
        kind_version=1,
        params_model=UnassignedResidualAboveParams,
        required_facts=frozenset({FACT_RESIDUAL}),
        default_max_staleness=timedelta(days=7),
        severity=SeverityDeclaration(formula="residual_weight / threshold_weight"),
        explanation_template=(
            "Il capitale non apportionato è al {residual_pct}% del portafoglio, sopra la "
            "soglia di attenzione del {threshold_pct}%."
        ),
        numeric_bindings=frozenset({"residual_pct", "threshold_pct", "severity"}),
        evaluate=evaluate_unassigned_residual_above,
    )
)


# --------------------------------------------------------------------------------------
# allocation_absent v1 (ADR-L02 §4.3)
# --------------------------------------------------------------------------------------


class AllocationAbsentParams(BaseModel):
    """Params of `allocation_absent`: which targeted class, in which scope."""

    model_config = {"frozen": True, "extra": "forbid"}

    asset_class: AssetClass
    scope: str


def evaluate_allocation_absent(
    params: AllocationAbsentParams, facts: FactSet, recorder: TraceRecorder
) -> ConditionResult:
    """Fire when a targeted `AssetClass` is held at zero.

    Reads `drift`, not a separate `targets`/`allocation` pair: `compute_drift` emits a
    `DriftLine` for every targeted leaf regardless of whether it is held (`current_weight = 0`
    when unallocated), which is exactly `effective_target` and `current_weight` — the two
    bindings ADR-L02 §4.1's sketch names. `severity = None` always (ADR-L02 §4.3): there is no
    magnitude of absence, and the only commensurable denominator (`effective_band`) is optional
    per ADR-0017, so any formula built from it would be partial.

    The predicate is literal-free (D8's constraint, applied here too): `current_weight == 0`
    is tested as ``(current_weight + effective_target) == effective_target`` — both operands
    of the final `eq` are bound facts, never a fabricated zero.
    """
    fact = recorder.open_fact(
        f"{FACT_DRIFT}:{params.asset_class}", facts.drift_for(params.asset_class)
    )
    line = fact.value
    fact.bind("current_weight", line.current_weight)
    fact.bind("effective_target", line.effective_target)

    recorder.add("current_weight_plus_target", "current_weight", "effective_target")
    absent = recorder.eq("absent", "current_weight_plus_target", "effective_target")

    recorder.message_bindings(_allocation_absent_message_bindings(params, facts, line))
    return ConditionResult(fired=absent, severity=None)


def _allocation_absent_message_bindings(
    params: AllocationAbsentParams, facts: FactSet, line: DriftLine
) -> dict[str, str]:
    return {
        "asset_class": params.asset_class,
        "asset_class_label": facts.label_for(params.asset_class),
        "asset_class_label_the": label(params.asset_class, role=Role.THE),
        "asset_class_label_the_cap": label(
            params.asset_class, role=Role.THE, sentence_initial=True
        ),
        "asset_class_copula": copula(params.asset_class),
        "scope": params.scope,
        "target_pct": Percentage.from_ratio(line.effective_target).canonical(),
    }


ALLOCATION_ABSENT: Final = REGISTRY.register(
    ConditionKindSpec(
        kind="allocation_absent",
        kind_version=1,
        params_model=AllocationAbsentParams,
        required_facts=frozenset({FACT_DRIFT}),
        default_max_staleness=timedelta(days=7),
        severity=SeverityDeclaration(formula=None),
        explanation_template=(
            "{asset_class_label_the_cap} {asset_class_copula} completamente assente dal "
            "portafoglio, contro un target del {target_pct}%."
        ),
        numeric_bindings=frozenset({"target_pct"}),
        evaluate=evaluate_allocation_absent,
    )
)


# --------------------------------------------------------------------------------------
# bucket_below_target_value v1 (ADR-L02 §4.4, ADR-L04 §4.7 D8)
# --------------------------------------------------------------------------------------


class BucketBelowTargetValueParams(BaseModel):
    """Params of `bucket_below_target_value`: the bucket, and its authored Money target.

    RFC-0006 catalog states this kind's target as a single `Money`, but `LeafCondition.params`
    is a flat `Mapping[str, str]` (RFC-0006 §2: params are canonical strings, validated at
    authoring time) — there is no nested-object slot, so the target is carried as two flat
    fields, `target_amount`/`target_currency`, rather than a nested `Money`.

    The params model rejects `target_amount <= 0` (ADR-L02 §4.4): the `severity` denominator
    must never vanish.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    bucket: str
    target_amount: MoneyAmount
    target_currency: Currency

    @model_validator(mode="after")
    def _target_is_positive(self) -> "BucketBelowTargetValueParams":
        if self.target_amount <= 0:
            raise InvariantViolationError(
                f"bucket_below_target_value: target_amount must be > 0; got {self.target_amount}"
            )
        return self


def evaluate_bucket_below_target_value(
    params: BucketBelowTargetValueParams, facts: FactSet, recorder: TraceRecorder
) -> ConditionResult:
    """Fire when a Bucket's total value falls below its authored `target` (ADR-L02 §4.4).

    `severity = 1 + shortfall_value / target_value` = `2 − coverage`, anchored at `1.0` when
    the bucket's value equals the target. ADR-L02 §4.4's own registration sketch
    (``b.add(1, b.ratio_to(...))``) is not expressible: `TraceRecorder.add` takes bound
    *names*, not values, and a literal `1` has no `SourceRef` (D8). This uses the
    literal-free form ADR-L04 §4.7 gives instead — `target_doubled = target_value +
    target_value`, `numerator = target_doubled − current_value`, `severity = numerator /
    target_value` — which is the same number with no unsourced binding anywhere in the trace.
    """
    fact = recorder.open_fact(FACT_BUCKET_VALUE, facts.bucket_value)
    current_value = fact.value.amount
    fact.bind("current_value", current_value)
    target_value = params.target_amount
    recorder.bind(
        "target_value", target_value, source=SourceRef(kind="params", path="target_amount")
    )
    recorder.subtract("shortfall_value", "target_value", "current_value")
    recorder.add("target_doubled", "target_value", "target_value")
    recorder.subtract("numerator", "target_doubled", "current_value")
    severity = recorder.ratio_to("severity", "numerator", "target_value")
    below = recorder.lt("below", "current_value", "target_value")

    recorder.message_bindings(
        _bucket_below_target_value_message_bindings(
            params, current_value, target_value, severity
        )
    )
    return ConditionResult(fired=below, severity=severity)


def _bucket_below_target_value_message_bindings(
    params: BucketBelowTargetValueParams,
    current_value: Decimal,
    target_value: Decimal,
    severity: Decimal,
) -> dict[str, str]:
    coverage_pct = Percentage.from_ratio(current_value / target_value).canonical()
    return {
        "bucket": params.bucket,
        "currency": params.target_currency,
        "current_value": canonical_decimal(current_value),
        "target_value": canonical_decimal(target_value),
        "shortfall_value": canonical_decimal(target_value - current_value),
        "coverage_pct": coverage_pct,
        "severity": canonical_decimal(severity),
    }


BUCKET_BELOW_TARGET_VALUE: Final = REGISTRY.register(
    ConditionKindSpec(
        kind="bucket_below_target_value",
        kind_version=1,
        params_model=BucketBelowTargetValueParams,
        required_facts=frozenset({FACT_BUCKET_VALUE}),
        default_max_staleness=timedelta(days=7),
        severity=SeverityDeclaration(
            formula="1 + shortfall_value / target_value  (= 2 - coverage)"
        ),
        explanation_template=(
            "Il capitale accumulato è di {current_value} {currency} contro un target di "
            "{target_value} {currency} (copertura {coverage_pct}%): mancano {shortfall_value} "
            "{currency}."
        ),
        numeric_bindings=frozenset(
            {"current_value", "target_value", "shortfall_value", "coverage_pct", "severity"}
        ),
        evaluate=evaluate_bucket_below_target_value,
    )
)


# --------------------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------------------


def evaluate(
    rules: Sequence[Rule], facts: FactSet, *, registry: ConditionRegistry = REGISTRY
) -> tuple[RuleFiring, ...]:
    """Evaluate every rule against `facts`, in deterministic order.

    Rules are mutually independent — no rule reads another's outcome (ADR-0015) — so the
    ordering exists only so that a re-run produces byte-identical output, which is what makes
    `input_digest` comparisons meaningful: `(priority DESC, rule_id ASC)`.

    Args:
        rules: The frozen rules of the governing `StrategyVersion`.
        facts: Every fact the rules may read, each one `Bound`.
        registry: The condition catalog. Injectable so a test can register a kind.

    Returns:
        One `RuleFiring` per rule, each carrying its trace (RFC-0004 §4.1). All four outcomes
        are returned; nothing is filtered here.
    """
    return tuple(_evaluate_rule(rule, facts, registry) for rule in _in_order(rules))


def _in_order(rules: Sequence[Rule]) -> list[Rule]:
    return sorted(rules, key=lambda rule: (-priority_rank(rule.priority), str(rule.id)))


def _evaluate_rule(rule: Rule, facts: FactSet, registry: ConditionRegistry) -> RuleFiring:
    condition = rule.condition
    reference = ConditionRef(
        kind=condition.kind, kind_version=condition.kind_version, params=dict(condition.params)
    )

    if not rule.enabled:
        return _skipped(rule, reference, SkipReason.DISABLED)

    try:
        spec = registry.get(condition.kind, condition.kind_version)
    except UnknownConditionKindError as exc:
        return _errored(rule, reference, str(exc))

    try:
        params = spec.params_model.model_validate(dict(condition.params))
    except ValidationError as exc:
        return _errored(rule, reference, f"invalid params: {exc}")

    for family in sorted(spec.required_facts):
        reason = facts.unavailable_reason(family)
        if reason is not None:
            return _skipped(
                rule,
                reference,
                reason,
                unavailable_facts=(FactUnavailable(name=family, reason=reason),),
            )

    recorder = TraceRecorder(
        condition=reference,
        as_of=facts.as_of,
        max_staleness=condition.max_staleness or spec.default_max_staleness,
    )
    try:
        result = spec.evaluate(params, facts, recorder)
    except SkipSignal as skip:
        return RuleFiring(
            rule_id=rule.id,
            priority=rule.priority,
            outcome=Outcome.SKIPPED,
            skip_reason=skip.reason,
            trace=recorder.trace(
                Outcome.SKIPPED,
                skip_reason=skip.reason,
                unavailable_facts=skip.unavailable,
                stale_facts=skip.stale,
            ),
        )
    except Exception as exc:  # an evaluator defect must not abort the run (RFC-0006 §5)
        message = f"{type(exc).__name__}: {exc}"
        return RuleFiring(
            rule_id=rule.id,
            priority=rule.priority,
            outcome=Outcome.ERROR,
            error=message,
            trace=recorder.trace(Outcome.ERROR, error=message),
        )

    outcome = Outcome.FIRED if result.fired else Outcome.NOT_FIRED
    return RuleFiring(
        rule_id=rule.id,
        priority=rule.priority,
        outcome=outcome,
        severity=result.severity,
        trace=recorder.trace(outcome),
    )


def _skipped(
    rule: Rule,
    reference: ConditionRef,
    reason: SkipReason,
    *,
    unavailable_facts: Sequence[FactUnavailable] = (),
) -> RuleFiring:
    return RuleFiring(
        rule_id=rule.id,
        priority=rule.priority,
        outcome=Outcome.SKIPPED,
        skip_reason=reason,
        trace=EvaluationTrace(
            condition=reference,
            outcome=Outcome.SKIPPED,
            skip_reason=reason,
            unavailable_facts=tuple(unavailable_facts),
        ),
    )


def _errored(rule: Rule, reference: ConditionRef, message: str) -> RuleFiring:
    return RuleFiring(
        rule_id=rule.id,
        priority=rule.priority,
        outcome=Outcome.ERROR,
        error=message,
        trace=EvaluationTrace(condition=reference, outcome=Outcome.ERROR, error=message),
    )


# --------------------------------------------------------------------------------------
# Replay (RFC-0009 §4.1)
# --------------------------------------------------------------------------------------


class ReplayResult(DomainModel):
    """The outcome a trace's own steps entail."""

    outcome: Outcome
    skip_reason: SkipReason | None = None


def replay_trace(trace: EvaluationTrace) -> ReplayResult | None:
    """Re-execute a trace and return the outcome its steps entail.

    The contract (RFC-0009 §4.1): given `condition` plus the `value` of every binding, and
    **ignoring every `source` field**, re-executing `steps` must reproduce `outcome` exactly.
    This function therefore reads only binding names and values, step operands and the
    recorded skip evidence — never `trace.outcome`, never `trace.skip_reason`, never a source.

    Returns:
        The entailed `ReplayResult`, or `None` when the trace records nothing re-executable.
        Only a `SKIPPED(disabled)` and an `ERROR` may legitimately be in that state: for any
        other outcome, a trace that cannot be replayed is a defect.

    Raises:
        ReplayMismatchError: If a step references an unbound name, or if re-executing a step
            does not reproduce the value the trace recorded.
    """
    environment: dict[str, TraceValue] = {binding.name: binding.value for binding in trace.bindings}
    skipped_on_zero = False
    for step in trace.steps:
        operands = [resolve(environment, name) for name in step.inputs]
        result = apply_op(step.op, operands)
        if result != step.value or (result is None) != (step.value is None):
            raise ReplayMismatchError(
                f"step {step.out!r} replayed as {result!r} but the trace recorded {step.value!r}"
            )
        if result is None:
            skipped_on_zero = True
            break
        environment[step.out] = result

    if skipped_on_zero:
        return ReplayResult(outcome=Outcome.SKIPPED, skip_reason=SkipReason.ZERO_DENOMINATOR)
    if trace.unavailable_facts:
        return ReplayResult(outcome=Outcome.SKIPPED, skip_reason=trace.unavailable_facts[0].reason)
    if trace.stale_facts:
        return ReplayResult(outcome=Outcome.SKIPPED, skip_reason=SkipReason.STALE_FACT)
    if not trace.steps:
        return None
    final = environment[trace.steps[-1].out]
    if not isinstance(final, bool):
        raise ReplayMismatchError(
            f"the final step must yield a boolean; got {final!r} for {trace.steps[-1].out!r}"
        )
    return ReplayResult(outcome=Outcome.FIRED if final else Outcome.NOT_FIRED)
