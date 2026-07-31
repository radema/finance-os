"""The findings list at `/` — screen 1, and the landing page (UX-0001 §2, RFC-0008 §4).

Three properties of this route are contractual rather than stylistic.

**It is the landing page, and it carries no net-worth hero number.** UX-0001 §5.3: Manifest P1
says the decisions are the product, so the first thing a reader sees is the list of findings and
net worth lives one click away on `/allocation`. A big-number dashboard here would contradict P1
in the first thing the product shows.

**The order is `mv_finding`'s, and is never re-sorted in Python.** RFC-0008 §3 fixes
`ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC`, and determinism there is
what `input_digest` comparison depends on. `list_findings_for_display` consumes the query's
sequence as it arrives; this module adds no `sorted()` and no `sort()`.

**"No findings" is never rendered as reassurance.** The skip notice sits above the list whenever
the latest run skipped or errored on anything, and the empty state says in words what the run
actually covered. ADR-0016 names silent false reassurance as the failure most likely to mislead,
and a UI that prints "nessun rilievo" over twenty skipped rules reintroduces it after the domain
went to trouble to prevent it.

**One known gap, and it is not this route's to close.** `rationale` is displayed as frozen, so
its decimals read in the canonical dot form (``40.00%``) inside otherwise it-IT prose.
`observation` is re-rendered it-IT because it was frozen as a template plus bindings that
`render_observation_it` can replay (L05 §7.3); `assemble_rationale` concatenated its string at
write time (ADR-0023), so there is no template and no bindings for the read side to re-render.
Closing it means freezing the rationale's bindings too, which is a write-path change — tracked as
a known limitation at `docs/features-candidates/rationale-locale-freeze.md` (blocked on read-side
aggregate hydration the flat read model doesn't provide, and on re-derivation risk under a newer
build than the one that wrote the row — not a migration).
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.findings import list_findings_for_display
from financeos.adapters.duckdb.queries.runs import latest_actual_run, run_outcome_counts
from financeos.web.chrome import nav_of, provenance_of, skip_notice_context
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def findings_list(con: Store) -> HTMLResponse:
    """Every open finding, grouped on `finding_key`, in the view's own order."""
    run = latest_actual_run(con)
    findings = list_findings_for_display(con) if run is not None else []
    counts = run_outcome_counts(con, run.id) if run is not None else None

    context = {
        "static": "/static",
        "title": "Rilievi",
        "page_title": "Rilievi",
        "page_kicker": "Decidere",
        "page_lede": (
            "Ogni rilievo è uno scostamento fra quello che hai dichiarato nella tua strategia "
            "e quello che il portafoglio detiene alla data di valutazione. L'ordine è quello "
            "della priorità che hai assegnato tu, poi della severità."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("findings", findings_count=len(findings)),
        "run": run,
        "findings": findings,
        "skip": skip_notice_context(counts) if counts is not None else None,
        "counts": counts,
    }
    template = build_environment().get_template("findings.html")
    return HTMLResponse(template.render(**context))
