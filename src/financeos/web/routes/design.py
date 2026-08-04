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

from financeos.web.design_fixture import preview_context
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/design", response_class=HTMLResponse, include_in_schema=False)
def design_preview() -> HTMLResponse:
    """Every component contract, in both themes, with the canonical fixture."""
    template = build_environment().get_template("design/preview.html")
    return HTMLResponse(template.render(static="/static", fixture=preview_context()))
