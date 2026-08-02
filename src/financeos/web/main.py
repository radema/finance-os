"""The FastAPI application (ADR-0007, RFC-0005 §5.4 / §8.1).

    uv run financeos serve

`create_app(db_path)` is the one assembly point: it opens the store, mounts the static tree,
and includes every screen's router plus the design preview. `cli.py`'s `serve` imports this
symbol by name, which is why its signature is fixed.

**Why the connection is opened once and shared.** ADR-0008 is a single process on one local
DuckDB file, with no worker pool and no connection pool. Opening per request would run the
migration runner per request; keeping one connection matches the process topology the
architecture actually chose. Every GET route is read-only; the two write actions (apportion,
freeze) go through `app/`'s use cases over the same shared connection.

**Why routes take the connection through `request.app.state`.** A router that reached for a
module-level global could not be tested against a temporary store, and `TestClient` is the only
way this app gets verified in an environment with no browser. The dependency itself lives in
`web.dependencies` rather than here, so a router does not import the module that includes it.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from financeos.adapters.duckdb.connection import connect
from financeos.web.preview import STATIC_DIR
from financeos.web.routes import allocation, design, findings, recommendations, runs


def create_app(db_path: Path) -> FastAPI:
    """Assemble the application over the store at `db_path`."""
    app = FastAPI(
        title="Finance OS",
        description="Sistema di supporto alle decisioni finanziarie, locale e spiegabile.",
        docs_url=None,
        redoc_url=None,
    )
    app.state.connection = connect(db_path)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.include_router(findings.router)
    app.include_router(recommendations.router)
    app.include_router(allocation.router)
    app.include_router(runs.router)
    app.include_router(design.router)
    return app
