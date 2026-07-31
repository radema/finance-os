"""Read-side shaping of a stored `alert.trace` into what the display partials accept.

Only `financeos.web` may import this module (contract C4).

This module reads the persisted trace JSON and nothing else. It performs **no arithmetic on
domain quantities**: the numbers it emits are the strings the trace already holds, and the one
derived value it produces — the *sign* of the severity — is taken from the sign of the stored
`drift` step rather than by re-dividing anything. That distinction matters, because the whole
value of the explanation surface is that a reader can replay it: a read path that recomputed a
number would be showing something the run never recorded.

Two rules from UX-0001 §4.2 are enforced here rather than left to a template:

1. **Decimals pass through as the stored strings.** `ladder_bindings` and `ladder_steps` never
   touch a locale filter, and `partials/trace_ladder.html` deliberately applies none either.
   The it-IT re-rendering of ADR-L03 §5.2 applies to the *observation*, never to the trace.
2. **A source is a link only where it resolves.** The skeleton ships no `/operations`,
   `/prices` or `/strategies` route, so `source_url` is `None` for every binding today and the
   partial renders the source as plain text. That is deliberate: the partial's contract calls a
   dead link worse than no link.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any

from financeos.adapters.duckdb.queries.it_locale import render_observation_it
from financeos.core.engines.rule_engine import REGISTRY
from financeos.core.shared.errors import UnknownConditionKindError

#: The step output name whose sign makes the severity signed. `severity` as stored is
#: `|drift| / effective_band` (RFC-0007 §3.1) — an absolute ratio — while the tolerance rail
#: needs to know which side of the target the position sits on (UX-0001 §4.1).
_DRIFT_STEP = "drift"


def observation_it(
    message: str, message_bindings: Mapping[str, str], kind: str, kind_version: int
) -> str:
    """Re-render a frozen `observation` for it-IT display (L05 §7.3).

    `message` is the rule's frozen template and `message_bindings` the trace's frozen bindings;
    the kind's registered `numeric_bindings` decide which of them are parsed as `Decimal` and
    reformatted (C-L05-3). Nothing is inferred from a binding's name or its stored value, which
    is what makes it impossible for a locale filter to corrupt an ISIN or a scope ref.

    An unregistered kind falls back to the stored string. A trace is never migrated
    (RFC-0009 §7.2), so a store can legitimately hold a kind this build no longer registers,
    and the honest reading of such a row is the sentence it froze — not an exception on a
    read path.
    """
    try:
        spec = REGISTRY.get(kind, kind_version)
    except UnknownConditionKindError:
        return message.format(**message_bindings)
    return render_observation_it(message, message_bindings, spec.numeric_bindings)


def signed_severity(severity: Decimal | None, steps: Sequence[Mapping[str, Any]]) -> Decimal | None:
    """`severity`, carrying the sign of the stored `drift` step (UX-0001 §4.1).

    Returns `None` when the kind declares no severity (ADR-L02's `allocation_absent`) or the
    outcome was `SKIPPED`/`ERROR` (ERR-1) — a legal null the rail renders as its unbanded
    state, and which RFC-0008 §3 sorts `NULLS LAST` on purpose.

    Also returns `None` when no `drift` step exists: a kind that records no drift has no side
    to be on, and inventing `+` would put a marker on the wrong half of the gauge.
    """
    if severity is None:
        return None
    for step in steps:
        if step.get("out") != _DRIFT_STEP:
            continue
        value = step.get("value")
        if not isinstance(value, str):
            return None
        return -severity if Decimal(value) < 0 else severity
    return None


def _binding_value(value: Any) -> str:
    """The stored value as one string, never reformatted.

    A structured binding (a `Tolerance`, whose value is a flat mapping) renders as its fields
    joined by a space — ``"ABSOLUTE 0.02000000"`` — because the ladder is one value per row.
    The component strings are the stored ones; only the join is added.
    """
    if isinstance(value, Mapping):
        return " ".join(str(v) for v in value.values())
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _source_text(source: Mapping[str, Any]) -> str:
    """A binding's source as the ladder's `name · detail` line.

    Reads the `SourceRef` fields (kind, ref, engine, path, inputs) in the same shape the
    design preview's fixture uses, so the served page and the design system read alike.
    """
    parts: list[str] = [str(source.get("kind", "?"))]
    ref = source.get("ref")
    if ref:
        parts.append(str(ref))
    engine = source.get("engine")
    if engine:
        parts.append(f"engine={engine}")
    path = source.get("path")
    if path:
        parts.append(str(path))
    inputs = source.get("inputs") or ()
    if inputs:
        parts.append(f"inputs {', '.join(str(i) for i in inputs)}")
    return " · ".join(parts)


def ladder_bindings(trace: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every binding as `partials/trace_ladder.html` wants it, in stored order.

    `source_url` is always `None` today: the skeleton has no route that resolves a
    `strategy_version`, an `operation` or a `price`, and the partial's contract is explicit
    that a source with nowhere to go renders as text rather than as a dead link. When those
    screens land (UX-0001 §2, screens 5 and 6) this is where the URL is attached, and the
    P7 chain becomes clickable without any template changing.
    """
    return [
        {
            "name": str(binding.get("name", "")),
            "value": _binding_value(binding.get("value")),
            "source": _source_text(binding.get("source") or {}),
            "source_url": None,
        }
        for binding in trace.get("bindings") or ()
    ]


def ladder_steps(trace: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every step as an ordered derivation, with the terminal step marked as held.

    The ordinal is the position in the stored sequence: `Step` carries no ordinal of its own
    because the tuple's order *is* the order (RFC-0009 §4.1 property 2).

    The last step's result is rendered as the run's `outcome` when its value is the boolean
    that decided the firing, because ``breached = true`` is a less useful thing to read than
    ``FIRED`` — and the boolean is still visible in the operands column above it.
    """
    steps = list(trace.get("steps") or ())
    outcome = str(trace.get("outcome", ""))
    rows: list[dict[str, Any]] = []
    for index, step in enumerate(steps, start=1):
        held = index == len(steps)
        value = step.get("value")
        out = str(step.get("out", ""))
        if held and isinstance(value, bool):
            result = outcome
        elif value is None:
            # `divide_safe` over a zero denominator: a skip marker, not an error
            # (RFC-0006 §4.1). Said in words, because a blank cell reads as a zero.
            result = f"{out} = non calcolabile"
        else:
            result = f"{out} = {_binding_value(value)}"
        rows.append(
            {
                "ordinal": index,
                "op": str(step.get("op", "")),
                "operands": ", ".join(str(i) for i in step.get("inputs") or ()),
                "result": result,
                "held": held,
            }
        )
    return rows
