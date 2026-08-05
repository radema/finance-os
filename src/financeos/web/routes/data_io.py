"""Data import/export at `/data-io` — web mirrors of three existing CLI commands (RFC-0010 §3
"Data: `financeos export --authored` (RFC-0009 §7.1) — required before migration 002").

**Scope, stated rather than silently widened (product-owner decision, this session):** this
screen wires the *existing* `import_operations`, `import_strategy` and `export_authored` use
cases as web actions, unchanged. It adds no domain logic of its own. Explicitly out of scope,
deferred to V1.1: any create/edit form for Portfolio/Bucket/Account/Asset, and `financeos seed`
(a destructive full-DB wipe, not an import). PRODUCT.md's "Operating Context" calls importing
operations and Strategies "CLI-first... for the unglamorous half" for V1.0 (a paraphrase of the
non-normative UX-0001 §5.1); this route is a deliberate, explicit override of that stance for
this session only, not a silent drift — see the commit message for the product-owner citation.

**Server-side-only validation, no client JS** — the same posture `routes/buckets.py`'s
`apportion` and `routes/strategies.py`'s `freeze` already use. A malformed CSV/YAML redirects
back to this page with an inline error instead of a 500; nothing here adds a validation rule
the domain constructors and repository `write()` do not already enforce themselves.

**Export as a zip.** `ExportResult` names a *tree* of YAML files (one per Bucket's
apportionment history, one per frozen `StrategyVersion`, one for asset classifications) — there
is no single artifact to stream. A zip bundle is the one download a browser can retrieve in one
request without the operator picking files off a served directory listing one at a time.

**`/data-io/backup`: a second, separate export action (product-owner decision, 2026-08-05).**
`export_authored`'s bundle round-trips through nothing but itself (apportionment/assets are
export-only); this one is a zip mirroring `demo/`'s fixture-directory shape — CSV/YAML the
*existing* `financeos seed <dir>` command already reads back, unchanged. See
`app.export_backup`'s module docstring for what it covers that `export --authored` does not
(and the reverse), and PRODUCT.md's "One DuckDB file; backup is `cp`" line this adds an
alternative to.
"""

from __future__ import annotations

import io
import tempfile
import zipfile
from decimal import InvalidOperation
from pathlib import Path

import yaml  # type: ignore[import-untyped]
from fastapi import APIRouter, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import ValidationError

from financeos.adapters.duckdb.queries.runs import latest_actual_run
from financeos.adapters.exporters.csv_backup import (
    write_accounts_csv,
    write_apportionment_csv,
    write_assets_csv,
    write_buckets_csv,
    write_portfolio_accounts_csv,
    write_portfolios_csv,
    write_prices_csv,
)
from financeos.adapters.importers.csv_operations import read_csv
from financeos.adapters.importers.yaml_strategy import read_yaml
from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app.export_authored import export_authored
from financeos.app.export_backup import export_backup
from financeos.app.import_operations import import_operations
from financeos.app.import_strategy import import_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()

#: A documented, minimally-valid Strategy skeleton — `strategy.yaml` has no meaningful "empty"
#: shape (I-4 requires >=1 Rule, I-13 requires target weights summing to 1), so the template
#: ships one placeholder target and one placeholder Rule instead of an empty file. Every
#: `TODO` marks something the operator must replace before `financeos seed`/`import-strategy`
#: will accept it; the two ids are placeholders, not real UUIDs to reuse.
_TEMPLATE_STRATEGY_YAML = """\
# TODO: replace strategy_id with a UUID you generate yourself (e.g. `python -c "import uuid; \\
# print(uuid.uuid4())"`) -- this one is a placeholder, not a real identifier to reuse.
strategy_id: "00000000-0000-0000-0000-000000000000"
name: "TODO: name your Strategy"
description: null
objective: "TODO: one sentence, why this Strategy exists"
horizon:
  years: 10
risk:
  level: BALANCED  # one of: CONSERVATIVE, BALANCED, GROWTH
  principles:
    - "TODO: a short guiding principle"
# Target tree (I-13): every list of siblings must sum to exactly 1. This template has one leaf
# (CASH at 100%) -- replace with your real allocation. Valid AssetClass leaves in the current
# label registry: EQUITY, EQUITY_DEVELOPED, EQUITY_GLOBAL, EQUITY_EMERGING, BONDS,
# BOND_GOV_EUR, BOND_CORP_IG, CASH (L05). An unlisted code still works, it just renders as its
# raw code instead of an Italian label.
targets:
  - key: CASH
    weight: "1.0000"
    tolerance:
      kind: ABSOLUTE      # ABSOLUTE (band is a weight, e.g. 0.05 = +/-5pp) or RELATIVE
      band: "0.0500"
# At least one Rule is required (I-4). This is `drift_outside_tolerance` at Bucket scope
# (ADR-L06 SS6.2) -- fires once per Bucket this Strategy governs. See
# docs/seed/rfcs/RFC-0006-rule-engine.md SS3 for the full catalog (allocation_absent,
# untargeted_allocation, unassigned_residual_above, bucket_below_target_value, over_apportioned).
rules:
  - id: "00000000-0000-0000-0000-000000000001"  # TODO: replace with a UUID you generate
    name: "TODO: name this Rule"
    enabled: true
    priority: HIGH  # CRITICAL, HIGH, MEDIUM, LOW, or INFO
    suggestion_class: CONSIDER_REBALANCE
    message: >-
      {asset_class_label_the_cap} {asset_class_copula} al {current_pct}% contro un target del
      {target_pct}% (tolleranza +/-{tolerance_pct}pp): scostamento di {drift_pct}pp
      ({drift_value} {currency}).
    condition:
      kind: drift_outside_tolerance
      kind_version: 1
      params:
        asset_class: CASH
        scope: "any_bucket"
    scope_gate:
      kind: BUCKET
change_note: "Prima versione."
"""


def _template_bundle() -> bytes:
    """8 of `demo/`'s 9 fixture files, header-only (zero rows), plus one documented Strategy
    skeleton in place of real data — the empty state to fill in with a real
    Portfolio/Bucket/Account/Asset/Strategy structure before the first `financeos seed
    <your-dir>`. No `UnitOfWork`: unlike the backup export, this reads nothing from the store.

    `operations.csv` is deliberately absent, not header-only: `cli.py`'s `seed` command treats
    it as optional via `.exists()`, but `import_operations` itself refuses an empty batch
    (`ValueError: no rows to import`) — a *present-but-empty* file would break the very first
    seed. Add the file yourself once you have real Operations to import (or use `/data-io`'s
    Operations upload after the first seed instead).
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_dir = Path(tmp_dir)
            csv_files = (
                write_accounts_csv((), out_dir),
                write_assets_csv((), out_dir),
                write_portfolios_csv((), out_dir),
                write_portfolio_accounts_csv((), out_dir),
                write_buckets_csv((), out_dir),
                write_apportionment_csv((), out_dir),
                write_prices_csv((), out_dir),
            )
            for path in csv_files:
                zf.write(path, arcname=path.relative_to(out_dir))
        zf.writestr("strategy.yaml", _TEMPLATE_STRATEGY_YAML)
    return buffer.getvalue()

#: Errors a malformed upload can legitimately raise before/at the domain boundary. `ValueError`
#: also catches every `DomainValueError` subclass (`InvariantViolationError` included) since
#: that class inherits from it (`core/shared/errors.py`); `InvalidOperation` (bad Decimal
#: literals) and `KeyError`/`yaml.YAMLError` (missing columns/keys, unparsable YAML) do not
#: subclass `ValueError` and need to be named separately.
_IMPORT_ERRORS = (ValueError, KeyError, InvalidOperation, ValidationError, yaml.YAMLError)


@router.get("/data-io", response_class=HTMLResponse, include_in_schema=False)
def data_io_page(
    con: Store, error: str | None = None, ok: str | None = None
) -> HTMLResponse:
    """Two upload forms (Operations CSV, Strategy YAML) and two export triggers."""
    context = {
        "static": "/static",
        "title": "Importa ed esporta dati",
        "page_title": "Importa ed esporta dati",
        "page_lede": (
            "Le operazioni di scrittura da file offerte finora solo dalla riga di comando: "
            "importare un file CSV di Operation, importare un file YAML di Strategy (congela "
            "una nuova versione), esportare i dati authored — l'unico percorso di recupero "
            "per apportionment e Strategy (RFC-0009 §7.1) — ed esportare un backup completo, "
            "ricaricabile con «financeos seed»."
        ),
        "provenance": provenance_of(latest_actual_run(con)),
        "nav": nav_of("data-io"),
        "error": error,
        "ok": ok,
    }
    template = build_environment().get_template("data_io.html")
    return HTMLResponse(template.render(**context))


@router.post("/data-io/operations", include_in_schema=False)
async def upload_operations(con: Store, file: UploadFile) -> RedirectResponse:
    """`import_operations`: parse the uploaded CSV and write its rows under one fresh batch.

    Written to a temporary file rather than parsed in memory because `read_csv` takes a
    `Path` — the exact CSV contract `financeos import-operations` already parses, unchanged
    here, so there is no second copy of that contract to drift from the CLI's.
    """
    if not file.filename:
        return RedirectResponse(
            url="/data-io?error=Seleziona+un+file+CSV+da+importare.", status_code=303
        )

    body = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".csv") as tmp:
        tmp.write(body)
        tmp.flush()
        try:
            rows = read_csv(Path(tmp.name))
            uow = DuckDBUnitOfWork(con)
            batch_id = import_operations(uow, UUIDv7IdGen(), SystemClock(), rows)
        except _IMPORT_ERRORS as exc:
            return RedirectResponse(url=f"/data-io?error={_short(exc)}", status_code=303)

    return RedirectResponse(
        url=f"/data-io?ok={len(rows)}+operazioni+importate+nel+lotto+{batch_id}.",
        status_code=303,
    )


@router.post("/data-io/strategy", include_in_schema=False)
async def upload_strategy(con: Store, file: UploadFile) -> RedirectResponse:
    """`import_strategy`: parse the uploaded YAML and freeze it as a new `StrategyVersion`."""
    if not file.filename:
        return RedirectResponse(
            url="/data-io?error=Seleziona+un+file+YAML+da+importare.", status_code=303
        )

    body = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".yaml") as tmp:
        tmp.write(body)
        tmp.flush()
        try:
            imported = read_yaml(Path(tmp.name))
            uow = DuckDBUnitOfWork(con)
            version = import_strategy(uow, UUIDv7IdGen(), SystemClock(), imported)
        except _IMPORT_ERRORS as exc:
            return RedirectResponse(url=f"/data-io?error={_short(exc)}", status_code=303)

    return RedirectResponse(
        url=f"/data-io?ok=Congelata+la+versione+{version.id}+della+strategia+"
        f"{version.strategy_id}.",
        status_code=303,
    )


@router.get("/data-io/template", include_in_schema=False)
def template_bundle() -> Response:
    """The empty-state fixture template: header-only CSVs plus a documented Strategy skeleton,
    in the same shape `financeos seed <dir>` reads. No DB access -- this is static structure,
    not a snapshot of the current store (see `_template_bundle`)."""
    return Response(
        content=_template_bundle(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="financeos-template.zip"'},
    )


@router.get("/data-io/export", include_in_schema=False)
def export_bundle(con: Store) -> Response:
    """`export_authored`: run it into a scratch directory, then zip the tree for download."""
    uow = DuckDBUnitOfWork(con)
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = Path(tmp_dir)
        result = export_authored(uow, out_dir)
        all_files = (*result.apportionment_files, result.asset_file, *result.strategy_files)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in all_files:
                zf.write(path, arcname=path.relative_to(out_dir))
        content = buffer.getvalue()

    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="financeos-authored-export.zip"'},
    )


@router.get("/data-io/backup", include_in_schema=False)
def backup_bundle(con: Store) -> Response:
    """`export_backup`: the whole store, zipped in `demo/`'s fixture-directory shape —
    reloadable with the existing `financeos seed <unzipped-dir>` command, unchanged."""
    uow = DuckDBUnitOfWork(con)
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = Path(tmp_dir)
        result = export_backup(uow, out_dir)
        all_files = (
            result.accounts_file,
            result.assets_file,
            result.portfolios_file,
            result.portfolio_accounts_file,
            result.buckets_file,
            result.apportionment_file,
            result.prices_file,
            result.operations_file,
            *result.strategy_files,
        )

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in all_files:
                zf.write(path, arcname=path.relative_to(out_dir))
        content = buffer.getvalue()

    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="financeos-backup.zip"'},
    )


def _short(exc: Exception) -> str:
    """A one-line, URL-safe error summary — mirrors `routes/strategies.py`'s `_short`: the raw
    exception text may contain `&`/`#`, which would corrupt the redirect's query string."""
    text = str(exc).splitlines()[0][:180]
    return text.replace("&", "e").replace("#", "n.").replace("\n", " ")
