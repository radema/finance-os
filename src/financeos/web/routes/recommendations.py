"""The explanation surface at `/recommendations/{id}` — screen 2 (RFC-0008 §6).

This URL is the entire P3/P7 user interface, and RFC-0005 §5.4 argued it is closer to a domain
requirement than a convenience. Its nine blocks and their order are corpus-specified and taken
literally (UX-0001 §5.1):

    1 Finding · 2 Motivation · 3 Bindings · 4 Computation · 5 Provenance
    6 History · 7 Reconcile · 8 Portfolio state · 9 Decision

**Blocks 3 and 4 are one lazy fragment.** `GET /recommendations/{id}/trace`, pulled in by
`hx-trigger="revealed"`. RFC-0005 §5.4 calls this out by name: the trace is the expensive part of
the page and the part most reads never need, and HTMX's unit of work is exactly one
server-rendered fragment behind one endpoint (ADR-0007). The fragment renders
`partials/trace_ladder.html` — the same partial the design preview uses, so the served
derivation cannot drift from the component contract.

**Three blocks report an absence rather than being omitted.** Reconcile has no recomputation
behind it, Portfolio state has no `snapshot` row, and Decision has no `decision` table. Each one
says so. Dropping a block would be indistinguishable from a block that had nothing to report,
and under ADR-0016 that difference is the whole point.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.it_locale import format_date_short_it, format_number_it
from financeos.adapters.duckdb.queries.recommendations import (
    SeverityPoint,
    get_recommendation,
    severity_history,
)
from financeos.adapters.duckdb.queries.runs import get_run
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/recommendations/{recommendation_id}", response_class=HTMLResponse,
            include_in_schema=False)
def explanation_surface(
    recommendation_id: str, con: Store
) -> HTMLResponse:
    """One Recommendation, permalinked, with all nine blocks."""
    detail = get_recommendation(con, recommendation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Recommendation non trovata.")

    run = get_run(con, detail.run_id)
    history = severity_history(con, detail.finding_key)

    context = {
        "static": "/static",
        "title": "Spiegazione del rilievo",
        "provenance": provenance_of(run),
        "nav": nav_of("findings"),
        "r": detail,
        "history": history,
        "severity_chart": _severity_chart(history),
        "severity_rows": [
            [format_date_short_it(point.as_of), _severity_cell(point)] for point in history
        ],
    }
    template = build_environment().get_template("recommendation.html")
    return HTMLResponse(template.render(**context))


@router.get("/recommendations/{recommendation_id}/trace", response_class=HTMLResponse,
            include_in_schema=False)
def trace_fragment(
    recommendation_id: str, con: Store
) -> HTMLResponse:
    """Blocks 3 and 4 — the bindings and the computation, as one HTMX fragment.

    Returns a fragment, not a page: no layout, no `<html>`. HTMX swaps it into the placeholder
    the parent page rendered, and `charts.js` binds `htmx:load` so anything drawn inside a
    swapped fragment still initialises.
    """
    detail = get_recommendation(con, recommendation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Recommendation non trovata.")
    template = build_environment().get_template("partials/trace_fragment.html")
    return HTMLResponse(template.render(r=detail))


def _severity_chart(history: tuple[SeverityPoint, ...]) -> dict[str, Any] | None:
    """The History block's series, or `None` when there is nothing to plot.

    `None` makes `partials/chart.html` render its empty *state* rather than an empty plot frame,
    because a blank frame reads as a zero and a zero is a measurement.

    Colours are named as roles, never as hex: the in-tolerance band is `token:--band` and the
    helper resolves it from the computed style, so one option is correct in both schemes. A
    single reading is left as a single reading — `charts.js` forces a labelled dot instead of a
    line, since a slope drawn through one datum is invented.
    """
    points = [(p.as_of, p.severity) for p in history if p.severity is not None]
    if not points:
        return None
    return {
        "grid": {"left": 8, "right": 20, "top": 28, "bottom": 8, "containLabel": True},
        "tooltip": {"trigger": "axis"},
        "xAxis": {
            "type": "category",
            "data": [format_date_short_it(as_of) for as_of, _ in points],
            "boundaryGap": len(points) == 1,
            "splitLine": {"show": False},
        },
        "yAxis": {"type": "value", "splitNumber": 4, "minInterval": 1},
        "series": [
            {
                "type": "line",
                "name": "severità",
                "data": [float(severity) for _, severity in points],
                "smooth": False,
                "markArea": {
                    "silent": True,
                    "itemStyle": {"color": "token:--band"},
                    "label": {
                        "show": True,
                        "position": "insideBottomLeft",
                        "formatter": "entro tolleranza",
                        "color": "token:--ink-3",
                        "fontSize": 10,
                    },
                    "data": [[{"yAxis": 0}, {"yAxis": 1}]],
                },
            }
        ],
    }


def _severity_cell(point: SeverityPoint) -> str:
    """The as-recorded severity, it-IT punctuated, or an em dash for a legal null (ERR-1).

    This is a chart's data table, not the trace ladder: `partials/chart.html` documents its
    `table_rows` as already-formatted it-IT strings, and only the trace is exempt from
    formatting (UX-0001 §4.2 rule 2).
    """
    return "—" if point.severity is None else format_number_it(point.severity)
