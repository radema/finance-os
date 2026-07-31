"""it-IT display filters for Jinja (ADR-L03 §5.2, L05 §7.3).

The counterpart of `financeos.web.labels` for digits rather than words, and it exists for the
same reason: so that **no template contains formatting logic and no view contains locale
logic**. A template says `{{ line.value | money_it }}` and the decision about what a euro
amount looks like stays in exactly one module —
`financeos.adapters.duckdb.queries.it_locale`, which this file only *exposes*. Nothing here
implements a format; every filter is a one-line delegation, and that is the point. A
`.replace(".", ",")` in a template, or a `strftime` in a route, is the drift this prevents.

Registered names, and the type each one accepts:

    num_it     Decimal   punctuation only, scale preserved  -> "3.240,0000"
    money_it   Decimal   euro, two places, € prefixed       -> "-€3.240,00"
    pct_it     Decimal   a stored *ratio*                   -> "34,00%"
    date_it    date      dd/mm/yyyy                         -> "24/07/2026"

`num_it` never rounds, so it is the correct filter for a value whose scale carries meaning.
It is still **not** for a trace value: UX-0001 §4.2 rule 2 requires bindings and steps to
render exactly as stored, and `partials/trace_ladder.html` deliberately applies no filter at
all. Passing a trace value through any filter here breaks the replay guarantee that surface
exists to demonstrate.
"""

from __future__ import annotations

from jinja2 import Environment

from financeos.adapters.duckdb.queries.it_locale import (
    format_date_it,
    format_money_it,
    format_number_it,
    format_percent_it,
)


def register_locale_filters(env: Environment) -> None:
    """Register `num_it`, `money_it`, `pct_it`, `date_it`."""
    env.filters["num_it"] = format_number_it
    env.filters["money_it"] = format_money_it
    env.filters["pct_it"] = format_percent_it
    env.filters["date_it"] = format_date_it
