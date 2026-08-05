"""Allocation & Net Worth at `/allocation` — screen 3 (UX-0001 §2, RFC-0007 §2/§4.1).

**This is where Net Worth lives, and it is the only screen that shows it.** The findings list
deliberately has no hero number (UX-0001 §5.3); one click away, on a screen whose subject *is*
what you hold, a total is the right thing to lead with.

**Two charts, no hex.** Every colour a mark needs is named as a role — `"token:--name"` — and
`static/js/charts.js` resolves it from the chart element's computed style, which is why one
server-assembled option renders correctly in both schemes. Series identity comes from the chart
theme's categorical array via `colorBy: "data"`, so the option carries no palette at all. The
cased cane's three marks name their roles (`casing` / `core` / `edge`) and the untargeted cane
names `void`; the helper supplies each role's geometry, so this module never states an opacity
or an offset.

**Polarity is carried by geometry, not hue.** A core short of its casing is a shortfall; a core
past the target tick is an overshoot. That is what lets the palette carry identity only, and it
is why an untargeted class is drawn with no casing rather than with a zero-width one — no shape
was ever declared for it.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.allocation import AllocationView, portfolio_allocation
from financeos.adapters.duckdb.queries.it_locale import (
    format_money_it,
    format_number_it,
    format_percent_it,
)
from financeos.adapters.duckdb.queries.runs import latest_actual_run
from financeos.core.shared import Percentage
from financeos.web.charts import bucket_chart, bucket_legend, bucket_rows
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.labels import label_short
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/allocation", response_class=HTMLResponse, include_in_schema=False)
def allocation_view(con: Store) -> HTMLResponse:
    """The portfolio's allocation against its declared targets, plus Net Worth."""
    run = latest_actual_run(con)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Nessuna valutazione registrata: esegui «financeos evaluate» prima di leggere "
                "l'allocazione."
            ),
        )

    view = portfolio_allocation(
        con, run.portfolio_id, as_of=run.as_of, strategy_version_id=run.strategy_version_id
    )
    if view is None:  # pragma: no cover - the run's own FK guarantees the portfolio exists
        raise HTTPException(status_code=404, detail="Portfolio non trovato.")

    context = {
        "static": "/static",
        "title": "Allocazione e patrimonio",
        "page_title": "Allocazione e patrimonio",
        "page_lede": (
            "Quanto vale il portafoglio alla data di valutazione, come è distribuito fra le "
            "classi di attivo e quanto si scosta dalla forma che la strategia congelata "
            "dichiara. La serie è quella registrata, non una ricomputazione."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("allocation"),
        "v": view,
        "alloc_chart": _allocation_chart(view),
        "alloc_legend": _allocation_legend(view),
        "alloc_rows": _allocation_rows(view),
        "bucket_chart": bucket_chart(view),
        "bucket_legend": bucket_legend(view),
        "bucket_rows": bucket_rows(view),
    }
    template = build_environment().get_template("allocation.html")
    return HTMLResponse(template.render(**context))


def _pct_points(ratio: Decimal) -> float:
    """A stored ratio as percentage points, for a chart datum.

    The conversion is `Percentage.from_ratio`'s, so an axis reads at the same scale as the
    `current_pct` binding the same weight produced in a trace. `float` is acceptable *here and
    only here*: this is a plotted pixel, downstream of every decision, and ECharts takes JSON
    numbers. No evaluation ever reads it (RFC-0009 §3 forbids float where it would).
    """
    return float(Percentage.from_ratio(ratio).value)


def _allocation_chart(view: AllocationView) -> dict[str, Any] | None:
    """The cased cane: declared target as casing, actual as core, with a luminous edge.

    `None` when the portfolio holds nothing — `partials/chart.html` then renders a state block
    instead of an empty plot frame, because an empty frame reads as a zero.
    """
    if not view.lines:
        return None

    labels = [label_short(line.asset_class) for line in view.lines]
    targets: list[float | None] = [
        None if line.target is None else _pct_points(line.target) for line in view.lines
    ]
    core: list[float | None] = [
        _pct_points(line.weight) if line.targeted else None for line in view.lines
    ]
    void: list[float | None] = [
        None if line.targeted else _pct_points(line.weight) for line in view.lines
    ]
    ceiling = max(
        [*(t for t in targets if t is not None), *(_pct_points(x.weight) for x in view.lines)]
    )

    return {
        "caneWidth": 22,
        "grid": {"left": 8, "right": 34, "top": 12, "bottom": 8, "containLabel": True},
        "tooltip": {"trigger": "item"},
        "xAxis": {
            "type": "value",
            "max": round(ceiling * 1.15, 2),
            "axisLabel": {"formatter": "{value}%"},
            "splitLine": {"show": True},
        },
        "yAxis": {
            "type": "category",
            "inverse": True,
            "data": labels,
            "splitLine": {"show": False},
            # Wrapped rather than truncated: a truncated class name is not an identity, and
            # identity may never rest on hue alone.
            "axisLabel": {"width": 168, "overflow": "break", "lineHeight": 14},
        },
        "series": [
            {
                "mark": "casing",
                "name": "target",
                "colorBy": "data",
                "data": targets,
                # The declared value also gets a tick in ink, on the SAME axis — one scale
                # only. The casing shows the extent; the tick makes the number readable.
                "markPoint": {
                    "symbol": "rect",
                    "symbolSize": [2, 30],
                    "silent": True,
                    "itemStyle": {"color": "token:--ink-2"},
                    "label": {"show": False},
                    "data": [
                        {"coord": [t, i], "name": f"target {t}%"}
                        for i, t in enumerate(targets)
                        if t is not None
                    ],
                },
            },
            {"mark": "core", "name": "attuale", "colorBy": "data", "data": core},
            {"mark": "edge", "name": "attuale", "data": core},
            {
                "mark": "void",
                "name": "non compreso nella strategia",
                "barGap": "-100%",
                "data": void,
            },
        ],
    }


def _allocation_legend(view: AllocationView) -> list[dict[str, Any]]:
    """A legend is always present, and every class is also direct-labelled on the axis.

    Both, mandatorily: no five-hue set clears all-pairs CVD, so identity may never rest on hue
    alone. The first three entries name the cased cane's three marks, because a reader who has
    not been told which cane is the target cannot use the geometry.
    """
    legend: list[dict[str, Any]] = [
        {"label": "target dichiarato (la cassa)", "swatch": "casing", "value": None},
        {"label": "attuale (il nucleo)", "swatch": "core", "value": None},
        {"label": "valore letto sul bordo di luce", "swatch": "edge", "value": None},
    ]
    for index, line in enumerate(view.lines):
        legend.append(
            {
                "label": label_short(line.asset_class)
                + ("" if line.targeted else " · senza target"),
                "swatch": "void" if not line.targeted else str((index % 5) + 1),
                "value": format_percent_it(line.weight),
            }
        )
    return legend


def _allocation_rows(view: AllocationView) -> list[list[str]]:
    """The as-recorded series as a real table, always in the document (ADR-L03 §4)."""
    rows: list[list[str]] = []
    for line in view.lines:
        drift = line.drift
        rows.append(
            [
                label_short(line.asset_class),
                format_money_it(line.value),
                format_percent_it(line.weight),
                "—" if line.target is None else format_percent_it(line.target),
                (
                    "nessun target"
                    if drift is None
                    else f"{format_number_it(Percentage.from_ratio(drift).value)}pp"
                ),
            ]
        )
    return rows
