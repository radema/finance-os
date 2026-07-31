"""Finance OS command-line interface (RFC-0005 §8.1 walking-skeleton commands)."""

from __future__ import annotations

import csv
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import click

from financeos.adapters.duckdb.connection import connect, default_db_path
from financeos.adapters.importers.csv_operations import read_csv
from financeos.adapters.importers.yaml_strategy import read_yaml
from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app import (
    DuckDBUnitOfWork,
    apportion_bucket,
    evaluate_strategy,
    export_authored,
    import_operations,
    import_strategy,
)
from financeos.core.portfolio import Asset, Bucket, Portfolio
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    PortfolioId,
    Quantity,
    Scope,
    StrategyId,
)
from financeos.ports import AccountInfo

REPO_ROOT = Path(__file__).resolve().parents[2]


@click.group()
@click.option(
    "--db-path",
    type=click.Path(path_type=Path),
    default=None,
    help="Percorso del file DuckDB (default: posizione standard dell'applicazione).",
)
@click.pass_context
def app(ctx: click.Context, db_path: Path | None) -> None:
    """Finance OS: un sistema di supporto alle decisioni finanziarie, locale e spiegabile."""
    ctx.ensure_object(dict)
    ctx.obj["db_path"] = db_path or default_db_path()


@app.command()
@click.argument("fixture", default="demo")
@click.pass_context
def seed(ctx: click.Context, fixture: str) -> None:
    """Semina il negozio locale DuckDB con il dataset FIXTURE (default: demo)."""
    fixture_dir = REPO_ROOT / fixture
    if not fixture_dir.is_dir():
        raise click.ClickException(f"fixture non trovata: {fixture_dir}")

    db_path: Path = ctx.obj["db_path"]
    if db_path.exists():
        db_path.unlink()

    con = connect(db_path)
    uow = DuckDBUnitOfWork(con)
    id_gen = UUIDv7IdGen()
    clock = SystemClock()

    for row in _read_csv_dicts(fixture_dir / "assets.csv"):
        uow.assets.add(
            Asset(
                id=AssetId(UUID(row["id"])),
                name=row["name"],
                asset_class=row["asset_class"],
                currency=row["currency"],
            )
        )

    for row in _read_csv_dicts(fixture_dir / "accounts.csv"):
        uow.accounts.add(
            AccountInfo(
                id=AccountId(UUID(row["id"])),
                cash_asset_id=AssetId(UUID(row["cash_asset_id"])),
                currency=row["currency"],
            ),
            name=row["name"],
            type_=row["type"],
        )

    for row in _read_csv_dicts(fixture_dir / "portfolios.csv"):
        uow.portfolios.add(Portfolio(id=PortfolioId(UUID(row["id"])), name=row["name"]))

    for row in _read_csv_dicts(fixture_dir / "portfolio_accounts.csv"):
        uow.portfolios.link_account(
            PortfolioId(UUID(row["portfolio_id"])), AccountId(UUID(row["account_id"]))
        )

    # Strategy first: `bucket.strategy_id` carries a REFERENCES strategy(id) (ERR-9).
    strategy_path = fixture_dir / "strategy.yaml"
    if strategy_path.exists():
        import_strategy(uow, id_gen, clock, read_yaml(strategy_path))

    for row in _read_csv_dicts(fixture_dir / "buckets.csv"):
        uow.buckets.add(
            Bucket(
                id=BucketId(UUID(row["id"])),
                portfolio_id=PortfolioId(UUID(row["portfolio_id"])),
                strategy_id=StrategyId(UUID(row["strategy_id"])),
                name=row["name"],
            )
        )

    for row in _read_csv_dicts(fixture_dir / "prices.csv"):
        uow.prices.add(
            id_gen(),
            AssetId(UUID(row["asset_id"])),
            valid_date=date.fromisoformat(row["valid_date"]),
            close=row["close"],
            currency=row["currency"],
            source=row["source"],
            recorded_at=clock.now(),
        )

    operations_path = fixture_dir / "operations.csv"
    if operations_path.exists():
        import_operations(uow, id_gen, clock, read_csv(operations_path))

    for row in _read_csv_dicts(fixture_dir / "apportionment.csv"):
        apportion_bucket(
            uow,
            id_gen,
            clock,
            BucketId(UUID(row["bucket_id"])),
            AssetId(UUID(row["asset_id"])),
            Quantity(amount=Decimal(row["quantity"])),
            effective_from=date.fromisoformat(row["effective_from"]),
        )

    click.echo(f"Seme «{fixture}» caricato in {db_path}.")


@app.command("import-operations")
@click.argument("csv_path", type=click.Path(exists=True, path_type=Path))
@click.pass_context
def import_operations_cmd(ctx: click.Context, csv_path: Path) -> None:
    """Importa Operation da un file CSV nel contesto Portfolio."""
    con = connect(ctx.obj["db_path"])
    uow = DuckDBUnitOfWork(con)
    batch_id = import_operations(uow, UUIDv7IdGen(), SystemClock(), read_csv(csv_path))
    click.echo(f"Importate le operazioni del lotto {batch_id}.")


@app.command("import-strategy")
@click.argument("yaml_path", type=click.Path(exists=True, path_type=Path))
@click.pass_context
def import_strategy_cmd(ctx: click.Context, yaml_path: Path) -> None:
    """Importa un file YAML di Strategy, creando una nuova StrategyVersion."""
    con = connect(ctx.obj["db_path"])
    uow = DuckDBUnitOfWork(con)
    version = import_strategy(uow, UUIDv7IdGen(), SystemClock(), read_yaml(yaml_path))
    click.echo(f"Congelata la versione {version.id} della strategia {version.strategy_id}.")


@app.command()
@click.option(
    "--authored",
    is_flag=True,
    required=True,
    help=(
        "Esporta i dati «authored» (RFC-0009 §7.1): apportionment (storia completa, incluse "
        "le righe superate), Strategy+Rule (ogni versione congelata), asset (righe correnti). "
        "Decisions e Categories sono esclusi: non hanno implementazione (RFC-0004 §schema "
        "solo di design; ADR-0024 rinvia Categories a V1.1) — nessun file per loro non è un "
        "bug. Layout: apportionment/<bucket_id>.yaml, strategies/<slug>/NNN_<version_id>.yaml "
        "(un file per versione, in ordine di congelamento — reimportabile in sequenza con "
        "«import-strategy»), assets.yaml (righe correnti, nessuna storia di riclassificazione: "
        "non esiste un reclassify() che la scriva). Apportionment e asset sono export-only: "
        "non esiste ancora un importer che li legga."
    ),
)
@click.option(
    "--out-dir",
    type=click.Path(path_type=Path),
    default=None,
    help="Cartella di destinazione (default: export/authored nella radice del repository).",
)
@click.pass_context
def export(ctx: click.Context, authored: bool, out_dir: Path | None) -> None:
    """Esporta un bundle YAML canonico dei dati authored (RFC-0009 §7.1, l'unico recovery path)."""
    del authored  # is_flag=True, required=True: presence is the only thing that matters
    con = connect(ctx.obj["db_path"])
    uow = DuckDBUnitOfWork(con)
    result = export_authored(uow, out_dir or (REPO_ROOT / "export" / "authored"))
    click.echo(
        f"Esportati {len(result.apportionment_files)} file di apportionment, "
        f"{len(result.strategy_files)} versioni di strategy, e {result.asset_file}."
    )


@app.command()
@click.option("--bucket-id", default=None, help="Bucket da valutare (default: tutti).")
@click.option("--as-of", default=None, type=str, help="Data di valutazione ISO (default: oggi).")
@click.option("--currency", default="EUR", help="Valuta di rendicontazione.")
@click.pass_context
def evaluate(ctx: click.Context, bucket_id: str | None, as_of: str | None, currency: str) -> None:
    """Esegue la pipeline di valutazione Strategy/Rule e materializza le Recommendation."""
    con = connect(ctx.obj["db_path"])
    uow = DuckDBUnitOfWork(con)
    id_gen = UUIDv7IdGen()
    clock = SystemClock()
    eval_date = date.fromisoformat(as_of) if as_of else date.today()

    bucket_ids = (BucketId(UUID(bucket_id)),) if bucket_id else uow.buckets.all_ids()
    if not bucket_ids:
        raise click.ClickException("nessun bucket trovato: esegui prima «financeos seed».")

    total_recommendations = 0
    for one_bucket_id in bucket_ids:
        result = evaluate_strategy(
            uow,
            id_gen,
            clock,
            scope=Scope.for_bucket(one_bucket_id),
            as_of=eval_date,
            currency=currency,
        )
        total_recommendations += len(result.recommendations)

    click.echo(f"Valutazione completata: {total_recommendations} Recommendation generate.")


@app.command()
@click.pass_context
def serve(ctx: click.Context) -> None:
    """Avvia l'applicazione web FastAPI."""
    try:
        from financeos.web.main import create_app  # type: ignore[import-untyped]
    except ImportError as exc:
        raise click.ClickException(
            "l'interfaccia web non è ancora disponibile (in attesa di W1d)."
        ) from exc

    import uvicorn

    uvicorn.run(create_app(ctx.obj["db_path"]), host="127.0.0.1", port=8000)


def _read_csv_dicts(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


if __name__ == "__main__":
    app()
