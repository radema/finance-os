"""Finance OS command-line interface (RFC-0005 §8.1 walking-skeleton commands)."""

import click


@click.group()
def app() -> None:
    """Finance OS: a local-first personal finance decision support system."""


@app.command()
def seed() -> None:
    """Seed the local DuckDB store with the demo dataset."""
    click.echo("not implemented")


@app.command("import-operations")
def import_operations() -> None:
    """Import Operations from a CSV file into the Portfolio context."""
    click.echo("not implemented")


@app.command("import-strategy")
def import_strategy() -> None:
    """Import a Strategy YAML file, creating a new StrategyVersion."""
    click.echo("not implemented")


@app.command()
def evaluate() -> None:
    """Run the Strategy/Rule evaluation pipeline and materialize Recommendations."""
    click.echo("not implemented")


@app.command()
def serve() -> None:
    """Start the FastAPI web application."""
    click.echo("not implemented")


if __name__ == "__main__":
    app()
