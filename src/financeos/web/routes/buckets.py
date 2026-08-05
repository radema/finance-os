"""Buckets & apportionment at `/buckets` — screen 4 (ADR-0025, ADR-0001, ADR-0029).

**Over-apportionment warns, never blocks (I-9).** `bucket_apportionment` carries no write-time
`Σ apportioned <= Holding` check — `over_apportioned` is an evaluation-time finding — so this
route accepts and renders a new apportionment row unconditionally, and shows the over-apportioned
table as a warning beside it, never as a rejection.

**The `UNASSIGNED` residual is signed and stays in the reconciliation (ADR-0025).** It is
Net Worth minus every Bucket's value and may legitimately be negative — a deficit, not a bug —
so it renders as a signed row rather than being clamped or hidden.

**Write action:** `POST /buckets/{id}/apportion` — `ApportionBucket` (UX-0001 §2.2). Appends an
effective-dated row; it never updates or deletes one (I-10's append-only discipline extended to
this fact table by RFC-0009 §3.1). Redirects back to `/buckets` on success (PRG), so a reload
never resubmits the form.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from financeos.adapters.duckdb.queries.buckets import BucketsView, buckets_view
from financeos.adapters.duckdb.queries.holdings import list_holdings
from financeos.adapters.duckdb.queries.it_locale import format_money_it, format_percent_it
from financeos.adapters.duckdb.queries.runs import latest_actual_run
from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app.apportion_bucket import apportion_bucket
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.core.shared import AssetId, BucketId, Quantity
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/buckets", response_class=HTMLResponse, include_in_schema=False)
def buckets_page(con: Store, error: str | None = None) -> HTMLResponse:
    """Every Bucket's composition, the apportioned quantities, and the signed residual."""
    run = latest_actual_run(con)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Nessuna valutazione registrata: esegui «financeos evaluate» prima di leggere "
                "l'apportionment."
            ),
        )
    view = buckets_view(con, run.portfolio_id, as_of=run.as_of)
    if view is None:  # pragma: no cover - the run's own FK guarantees the portfolio exists
        raise HTTPException(status_code=404, detail="Portfolio non trovato.")

    context = {
        "static": "/static",
        "title": "Bucket e apportionment",
        "page_title": "Bucket e apportionment",
        "page_lede": (
            "Come il patrimonio è ripartito fra i Bucket: quali asset sono stati assegnati a "
            "ciascuno e in quale quantità, alla data dell'ultima valutazione. Il residuo non "
            "assegnato resta nel totale e può essere negativo."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("buckets"),
        "v": view,
        "holdings": list_holdings(con, run.portfolio_id),
        "unassigned_rows": _unassigned_row(view),
        "error": error,
        "today": run.as_of.isoformat(),
    }
    template = build_environment().get_template("buckets.html")
    return HTMLResponse(template.render(**context))


def _unassigned_row(view: BucketsView) -> list[str]:
    return [
        format_money_it(view.unassigned_value),
        format_percent_it(view.unassigned_weight),
    ]


@router.post("/buckets/{bucket_id}/apportion", include_in_schema=False)
def apportion(
    bucket_id: str,
    con: Store,
    asset_id: str = Form(...),
    quantity: str = Form(...),
    effective_from: str = Form(...),
) -> RedirectResponse:
    """`ApportionBucket`: append one effective-dated apportionment row.

    Server-side validation only — no client-side check, per this codebase's htmx/no-JS-framework
    posture. A malformed quantity or date redirects back with an inline error rather than a 500;
    the over-apportionment warning itself is never blocking (ADR-0025), so nothing here rejects a
    quantity merely for exceeding the held amount.
    """
    try:
        parsed_quantity = Quantity(amount=Decimal(quantity))
        parsed_date = date.fromisoformat(effective_from)
        parsed_asset_id = AssetId(UUID(asset_id))
        parsed_bucket_id = BucketId(UUID(bucket_id))
    except (InvalidOperation, ValueError):
        return RedirectResponse(
            url="/buckets?error=Quantità+o+data+non+valide.", status_code=303
        )

    uow = DuckDBUnitOfWork(con)
    apportion_bucket(
        uow,
        UUIDv7IdGen(),
        SystemClock(),
        parsed_bucket_id,
        parsed_asset_id,
        parsed_quantity,
        effective_from=parsed_date,
    )
    return RedirectResponse(url="/buckets", status_code=303)
