"""The ``/design`` route: the design system, rendered from the real partials.

Self-contained on purpose. Mount it with one line wherever the FastAPI app is
assembled, without this module reaching into an app factory it does not own::

    from financeos.web.routes import design
    app.include_router(design.router)
    app.mount("/static", StaticFiles(directory=...), name="static")

It renders ``templates/design/preview.html`` -- the same template the file dump
uses -- so the preview can never drift from the components the screens import.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from financeos.web.chrome import nav_of
from financeos.web.design_fixture import preview_context
from financeos.web.preview import build_environment
from financeos.web.prototype_dashboard import dashboard_context, variant_of

router = APIRouter()


@router.get("/design", response_class=HTMLResponse, include_in_schema=False)
def design_preview() -> HTMLResponse:
    """Every component contract, in both themes, with the canonical fixture."""
    template = build_environment().get_template("design/preview.html")
    return HTMLResponse(template.render(static="/static", fixture=preview_context()))


@router.get("/design/dashboard", response_class=HTMLResponse, include_in_schema=False)
def dashboard_prototype(variant: str | None = None) -> HTMLResponse:
    """PROTOTYPE — three dashboard landing pages on one route (task #12, W2).

    Throwaway, and expected to be deleted once the product owner names a variation.
    Read ``docs/plans/W2-dashboard-variations.md`` first; each variation also carries
    its own question and tradeoff at the top of the page.

    It lives under ``/design`` rather than at a new top-level path for two reasons.
    The prototype renders from ``web/design_fixture.py`` — the UX-0001 §8 canonical
    numbers — and that module may only be read by the preview surface, never by the
    running application. And a landing page judged in a vacuum always looks fine, so
    the page extends ``base.html`` and takes the real index rail and the real sticky
    provenance bar with it.

    No query module is touched: nothing here reads the store, so there is no SQL to
    inline (C4 is satisfied by having no read side at all).
    """
    key = variant_of(variant)
    context = dashboard_context(key)
    template = build_environment().get_template("design/dashboard_prototype.html")
    return HTMLResponse(
        template.render(
            static="/static",
            title=f"Dashboard · variante {key} (prototipo)",
            page_kicker="Prototipo · task #12",
            page_title="Tre varianti di una pagina di avvio",
            page_lede=(
                "Tre architetture dell'informazione diverse sulla stessa rotta, "
                "ciascuna con la domanda a cui risponde per prima e il suo "
                "compromesso. Le frecce ← e → alternano le varianti."
            ),
            nav=nav_of("design"),
            provenance=context["fixture"]["provenance"],
            **context,
        )
    )
