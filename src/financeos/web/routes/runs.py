"""Run health at `/runs`, `/runs/{id}` — screen 7 (RFC-0006 §5, ADR-0016, RFC-0008 §8).

Built first among the deferred screens (UX-0001 §9.3): it makes a broken configuration visible
while the rest of V1.0 is still being built, and it is cheap because `runs.py`'s query module
already carries most of what it needs from the skeleton.

**`SKIPPED != NOT_FIRED` (ADR-0016).** Every alert row on `/runs/{id}` carries its own outcome
chip, and every `SKIPPED`/`ERROR` row carries its reason beside it — never a bare count. The
persistent skip notice from the findings list is reused here unchanged (same partial, same
load-bearing sentence), because a run that skipped rules is exactly the state this screen exists
to surface.

**Both `ACTUAL` and `HYPOTHETICAL` runs are listed.** A hypothetical run persists alerts and
traces and produces zero Recommendations (RFC-0008 §8); its own configuration errors are exactly
what this screen is for, so excluding it from the list would hide the one place they are visible.
`mode` renders as its own chip on every row so the two are never confused.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.runs import (
    get_run,
    latest_actual_run,
    list_alerts,
    list_runs,
    run_outcome_counts,
)
from financeos.web.chrome import nav_of, provenance_of, skip_notice_context
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/runs", response_class=HTMLResponse, include_in_schema=False)
def runs_list(con: Store) -> HTMLResponse:
    """Every evaluation run, most recent first."""
    runs = list_runs(con)
    rows = []
    for run in runs:
        counts = run_outcome_counts(con, run.id)
        rows.append({"run": run, "counts": counts})

    context = {
        "static": "/static",
        "title": "Stato delle valutazioni",
        "page_title": "Stato delle valutazioni",
        "page_lede": (
            "Ogni valutazione registrata, con i suoi quattro esiti. Non valutato non significa "
            "conforme: una regola saltata o interrotta non dice nulla sul rispetto della tua "
            "strategia."
        ),
        "provenance": provenance_of(latest_actual_run(con)),
        "nav": nav_of("runs"),
        "rows": rows,
    }
    template = build_environment().get_template("runs.html")
    return HTMLResponse(template.render(**context))


@router.get("/runs/{run_id}", response_class=HTMLResponse, include_in_schema=False)
def run_detail(run_id: str, con: Store) -> HTMLResponse:
    """One evaluation run: every alert, all four outcomes, every reason named."""
    run = get_run(con, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Valutazione non trovata.")

    counts = run_outcome_counts(con, run_id)
    alerts = list_alerts(con, run_id)

    context = {
        "static": "/static",
        "title": f"Valutazione run:{run.id[:8]}",
        "page_title": "Valutazione",
        "page_lede": (
            "Ogni regola valutata in questa run, con il proprio esito. Un esito SKIPPED o "
            "ERROR porta sempre il proprio motivo accanto."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("runs"),
        "run": run,
        "counts": counts,
        "skip": skip_notice_context(counts, run) if counts.skipped or counts.error else None,
        "alerts": alerts,
    }
    template = build_environment().get_template("run_detail.html")
    return HTMLResponse(template.render(**context))
