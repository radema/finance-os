"""The dashboard at `/dashboard` — «Il patrimonio annotato», variation C (task #12, W2 plan doc).

**Aggregate first, findings as annotation.** Net worth and the composition of the whole lead
the page; findings hang off it as an annotation layer, one card per Bucket. This is exactly the
page `UX-0001 §5.3` argued against — see `docs/seed/ux/UX-0001-ui-reference.md §5.3`, now a
pointer to this route and to the product-owner decision this route implements
(`docs/plans/adr/ADR-L08-dashboard-landing-page.md`). `/` (screen 1, `web/routes/findings.py`) is
untouched and stays the findings-first landing page: this is a second, sibling route, not a
replacement.

**Two guards, held for real rather than merely stated (the plan doc's own "why it might survive
anyway"):**

1. **No Bucket card shows an open-findings count without its unevaluated count beside it.** A
   Bucket that was never evaluated at all (`BucketFindingsState.run_id is None`) — or one that
   was evaluated but has literally zero rules gated to it at all (`rules_measured == 0` and
   `rules_unevaluated == 0`) — renders neither count as a zero — that would be exactly the
   silent false reassurance `ADR-0016` forbids at the presentation layer (review BLOCKING). A
   Bucket with a recorded run whose rules were all `SKIPPED` (`rules_measured == 0` but
   `rules_unevaluated > 0`) is a distinct, third state, with its own copy in `dashboard.html`.
   An evaluated Bucket with at least one measured rule always shows both counts together,
   whatever their values.
2. **The whole reconciles in view.** The composition chart is the identical
   `web.charts.bucket_chart`/`bucket_legend`/`bucket_rows` `/allocation` renders (`ADR-0029`):
   the segments close on the net-worth tick and the `UNASSIGNED` residual is one of them, so the
   hero number is checkable rather than asserted.

**The ledger keeps `mv_finding`'s order.** `list_findings_for_display` is consumed exactly as
`web/routes/findings.py` consumes it — no `sorted()`, no re-grouping — so `RFC-0008 §3`'s
`(priority_rank DESC, severity DESC NULLS LAST, rule_id ASC)` holds here too.

**The skip notice sits above every count claim on the page (ADR-0016).** Because a Bucket card's
own counts come from *that Bucket's own* latest run and not from one page-wide run
(`evaluate_strategy` is called once per Bucket and once more for the Portfolio scope, RFC-0007
§5), the notice sums `aggregate_outcome_counts` over every run actually feeding the page rather
than reading a single run picked arbitrarily. Both the cards and the notice are restricted to
this page's own `as_of` (review SHOULD-FIX 2): a scope's run at a different `as_of` counts as no
run for this page, rather than reporting stale numbers beside a newer provenance date.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.allocation import BucketLine, portfolio_allocation
from financeos.adapters.duckdb.queries.dashboard import (
    BucketFindingsState,
    aggregate_outcome_counts,
    bucket_findings_states,
)
from financeos.adapters.duckdb.queries.findings import FindingDisplayRow, list_findings_for_display
from financeos.adapters.duckdb.queries.it_locale import format_money_it, format_percent_it
from financeos.adapters.duckdb.queries.runs import latest_actual_run, latest_actual_run_for_scope
from financeos.web.charts import bucket_chart, bucket_label, bucket_legend, bucket_rows
from financeos.web.chrome import nav_of, provenance_of, skip_notice_context
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
def dashboard(con: Store) -> HTMLResponse:
    """Net worth and composition first; findings hang off each Bucket as an annotation."""
    run = latest_actual_run(con)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Nessuna valutazione registrata: esegui «financeos evaluate» prima di leggere "
                "il patrimonio."
            ),
        )

    view = portfolio_allocation(
        con, run.portfolio_id, as_of=run.as_of, strategy_version_id=run.strategy_version_id
    )
    if view is None:  # pragma: no cover - the run's own FK guarantees the portfolio exists
        raise HTTPException(status_code=404, detail="Portfolio non trovato.")

    real_buckets = [b for b in view.buckets if not b.residual]
    residual = next((b for b in view.buckets if b.residual), None)
    states = bucket_findings_states(con, [b.id for b in real_buckets], as_of=run.as_of)

    run_ids = [s.run_id for s in states.values() if s.run_id is not None]
    portfolio_run = latest_actual_run_for_scope(con, "PORTFOLIO", run.portfolio_id)
    # Restricted to the page's own `as_of` (review SHOULD-FIX 2): a Portfolio-scope run at a
    # different `as_of` is not this page's run, so its counts do not belong in this page's
    # skip notice.
    if portfolio_run is not None and portfolio_run.as_of == run.as_of:
        run_ids.append(portfolio_run.id)
    counts = aggregate_outcome_counts(con, run_ids) if run_ids else None

    bucket_names = {b.id: b.name for b in real_buckets}

    context = {
        "static": "/static",
        "title": "Patrimonio",
        "page_title": "Patrimonio",
        "page_lede": (
            "Il patrimonio netto come registrato dall'ultima valutazione, e in quale parte di "
            "esso stanno gli scostamenti. Ogni Bucket dichiara insieme quanti rilievi sono "
            "aperti e quante delle sue regole non hanno raggiunto un esito."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("dashboard"),
        "v": view,
        "comp_chart": bucket_chart(view),
        "comp_legend": bucket_legend(view),
        "comp_rows": bucket_rows(view),
        "skip": skip_notice_context(counts) if counts is not None else None,
        "cards": [_card(b, states[b.id]) for b in real_buckets],
        "residual": _residual_card(residual) if residual is not None else None,
        "findings": [
            _ledger_row(f, bucket_names, view.portfolio_name)
            for f in list_findings_for_display(con)
        ],
    }
    template = build_environment().get_template("dashboard.html")
    return HTMLResponse(template.render(**context))


def _card(bucket: BucketLine, state: BucketFindingsState) -> dict[str, Any]:
    return {
        "id": bucket.id,
        "name": bucket.name,
        "value_it": format_money_it(bucket.value),
        "share_it": format_percent_it(bucket.weight),
        # A Bucket that was evaluated but has literally zero rules gated to it at all
        # (`rules_measured == 0` AND `rules_unevaluated == 0`) gets the same "no measure"
        # notice as one never evaluated at all (`run_id is None`) — otherwise it would render
        # "0 / 0 / 0" with no caveat, which is exactly the silent false reassurance ADR-0016
        # forbids (review BLOCKING). A Bucket with a recorded run whose rules were all SKIPPED
        # (`rules_measured == 0` but `rules_unevaluated > 0`) is a *different* state — a run
        # was recorded, it just settled nothing — and gets its own copy in the template rather
        # than reusing "mai stato valutato" (task #12/#dashboard review BLOCKING-1).
        "never_evaluated": (
            state.run_id is None or (state.rules_measured == 0 and state.rules_unevaluated == 0)
        ),
        "open_findings": state.open_findings,
        "breach": bool(state.open_findings),
        "rules_measured": state.rules_measured,
        "rules_unevaluated": state.rules_unevaluated,
        "worst_severity": state.worst_severity,
    }


def _residual_card(residual: BucketLine) -> dict[str, Any]:
    return {
        "name": bucket_label(residual.name),
        "value_it": format_money_it(residual.value),
        "share_it": format_percent_it(residual.weight),
        "negative": residual.value < 0,
    }


def _ledger_row(
    f: FindingDisplayRow, bucket_names: dict[str, str], portfolio_name: str
) -> dict[str, Any]:
    scope_name = (
        bucket_names.get(f.finding.scope_id, f.finding.scope_id)
        if f.scope_kind == "BUCKET"
        else portfolio_name
    )
    return {
        "designation": f.asset_class,
        "rule_name": f.rule_name,
        "scope_name": scope_name,
        "outcome": f.outcome,
        "current_severity": f.finding.current_severity,
        "recommendation_url": f"/recommendations/{f.finding.latest_recommendation_id}",
        "observation_it": f.observation_it,
    }
