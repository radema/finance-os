"""it-IT display formatting for numeric message bindings (gap 2, L05 §7.3).

Read-side only, and orthogonal to `core.shared.labels` (L05 §7.3's own table): this module
knows digits — decimal comma, thousands dot, an optional `€` prefix — and nothing about words,
gender or articles. It is the counterpart the label registry deliberately does not supply.

Two formatters and one re-render function:

* `format_number_it` — punctuation only, never rounding. A canonical decimal string keeps its
  own scale (a `Percentage` stays at two places, a `Money` at four); only the separators change.
  This is the `Callable[[Decimal], str]` `assemble_rationale` and `render_observation_it` both
  take, so one function meets the registry at exactly one slot in each mechanism (L05 §7.3).
* `format_money_it` — a euro amount as a reader expects it: rounded to two decimal places, `€`
  prefixed. A general-purpose utility for money values, not applied inside `observation`
  re-rendering unless a condition kind declares a binding for it (none does today; `currency`
  in `drift_outside_tolerance` is a word binding, e.g. ``"EUR"``, and stays untouched).
* `render_observation_it` — re-renders a rule's frozen `message` template over its frozen
  `message_bindings`, formatting only the kind's declared-numeric bindings (C-L05-3). Every
  other binding — asset class codes, labels, scope refs, currency codes — passes through
  verbatim, because a `.replace(".", ",")` over an opaque identifier (an ISIN, a scope ref)
  would corrupt it.

Never regex stored prose (L05 §7.3): the substitution happens binding-by-binding, before
`str.format`, never on the assembled sentence.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal


def format_number_it(value: Decimal) -> str:
    """it-IT punctuation of a canonical decimal: comma decimal, dot thousands.

    Never rounds and never changes scale — ``Decimal("40.00")`` renders ``"40,00"``,
    ``Decimal("-3240.0000")`` renders ``"-3.240,0000"``. Rounding to a display scale is
    `format_money_it`'s job, not this one's: a message binding is numeric (C-L05-3), not
    necessarily money.
    """
    sign = "-" if value < 0 else ""
    integer_part, _, fraction_part = format(abs(value), "f").partition(".")
    grouped = f"{int(integer_part):,}".replace(",", ".")
    return f"{sign}{grouped},{fraction_part}" if fraction_part else f"{sign}{grouped}"


def format_money_it(value: Decimal) -> str:
    """it-IT euro display: two decimal places, dot thousands, comma decimal, `€` prefix.

    Rounds a canonical four-scale `Money` amount to the two places a reader expects from a
    euro figure (half-up, matching `financeos.core.shared.numbers.ROUNDING`).
    """
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    formatted = format_number_it(quantized)
    if formatted.startswith("-"):
        return f"-€{formatted[1:]}"
    return f"€{formatted}"


def render_observation_it(
    message: str, message_bindings: Mapping[str, str], numeric_bindings: frozenset[str]
) -> str:
    """Re-render a frozen `observation` for it-IT display (L05 §7.3).

    `message` is the rule's frozen `message` template and `message_bindings` the trace's frozen
    bindings — both read from the persisted `alert.trace` / `strategy_version.definition`, never
    recomputed. `numeric_bindings` is the condition kind's declaration (C-L05-3): only those
    names are parsed as `Decimal` and reformatted; every other binding is substituted verbatim,
    so a word binding (an asset class label, a scope ref) can never be mangled.
    """
    localized = {
        name: format_number_it(Decimal(value)) if name in numeric_bindings else value
        for name, value in message_bindings.items()
    }
    return message.format(**localized)
