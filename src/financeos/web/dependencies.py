"""The one request-scoped dependency every route shares: the store.

Separate from `web.main` so that routes do not import the module that imports *them* — the
app factory includes the routers, and a router reaching back into it for a dependency is a
cycle. This module imports nothing from `financeos.web`, which is what keeps it acyclic.

`Store` is an `Annotated` alias rather than a `Depends()` default. Two reasons, and the second
is the operative one: it is FastAPI's current idiom, and a call in an argument default is
evaluated once at import time, which ruff's B008 flags because it is a real footgun for
anything stateful.
"""

from __future__ import annotations

from typing import Annotated

import duckdb
from fastapi import Depends, Request


def connection_of(request: Request) -> duckdb.DuckDBPyConnection:
    """A cursor over the application's store, for the duration of one request.

    A `duckdb` connection object is not safe to use from several threads at once, and uvicorn
    runs sync path operations in a threadpool, so each request gets its own cursor rather than
    sharing the connection. `.cursor()` is cheap: it shares the buffer manager and the catalog
    with its parent, so this is not a second open of the database file.

    The `TimeZone` is re-set on every cursor because a cursor does **not** inherit its parent's
    session settings, and the `CAST(TIMESTAMPTZ AS VARCHAR)` convention that `_time.py`
    documents reads a *local*-time string without it. That would be a silently wrong timestamp
    rather than an error, which is the worst available failure mode.
    """
    shared: duckdb.DuckDBPyConnection = request.app.state.connection
    cursor = shared.cursor()
    cursor.execute("SET TimeZone='UTC'")
    return cursor


#: The request-scoped store, as a type. Every route annotates its parameter with this.
Store = Annotated[duckdb.DuckDBPyConnection, Depends(connection_of)]
