"""Operations at `/operations` — the ledger, screen 5 (ADR-0026, ADR-0028, I-10).

**Append-only, and this route is read-only by construction (I-10).** `financeos import-operations`
is the only write path (CLI-first, per `PRODUCT.md` "Operating Context"); this module imports no
write function and the template it renders carries no edit or delete control. A correction is a
new `CORRECTION` row, visible here like any other, never a change to the row it corrects.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from financeos.adapters.duckdb.queries.operations import list_operations
from financeos.adapters.duckdb.queries.runs import latest_actual_run
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/operations", response_class=HTMLResponse, include_in_schema=False)
def operations_ledger(con: Store) -> HTMLResponse:
    """Every Operation, most recent first — a register, never an editable grid."""
    run = latest_actual_run(con)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Nessuna valutazione registrata: esegui «financeos evaluate» prima di leggere "
                "il registro delle operazioni."
            ),
        )
    operations = list_operations(con, run.portfolio_id)

    context = {
        "static": "/static",
        "title": "Operazioni",
        "page_title": "Operazioni",
        "page_lede": (
            "Il registro delle operazioni: il fatto finanziario unico da cui ogni posizione è "
            "derivata (ADR-0003). È un registro, non una tabella modificabile — non esiste qui "
            "né una modifica né una cancellazione. Una rettifica è una nuova riga."
        ),
        "provenance": provenance_of(run),
        "nav": nav_of("operations"),
        "operations": operations,
    }
    template = build_environment().get_template("operations.html")
    return HTMLResponse(template.render(**context))
