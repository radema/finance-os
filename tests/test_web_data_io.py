"""Import/export at `/data-io` — web mirrors of the three CLI commands `import-operations`,
`import-strategy`, and `export --authored` (RFC-0009 §7.1, RFC-0010 §3), unchanged use cases.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml  # type: ignore[import-untyped]
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.cli import app as cli
from financeos.web.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[1]


def _seed(tmp_path: Path) -> Path:
    db_path = tmp_path / "financeos.duckdb"
    runner = CliRunner()
    seeded = runner.invoke(cli, ["--db-path", str(db_path), "seed", "demo"])
    assert seeded.exit_code == 0, seeded.output
    evaluated = runner.invoke(
        cli, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
    )
    assert evaluated.exit_code == 0, evaluated.output
    return db_path


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_seed(tmp_path)))


@pytest.fixture
def con(client: TestClient) -> duckdb.DuckDBPyConnection:
    shared: duckdb.DuckDBPyConnection = client.app.state.connection  # type: ignore[attr-defined]
    return shared.cursor()


def _one(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> Any:
    row = con.execute(sql, params or []).fetchone()
    assert row is not None
    return row[0]


def test_nav_lists_data_io(client: TestClient) -> None:
    assert 'href="/data-io"' in client.get("/").text


def test_data_io_page_renders(client: TestClient) -> None:
    response = client.get("/data-io")
    assert response.status_code == 200
    assert 'action="/data-io/operations"' in response.text
    assert 'action="/data-io/strategy"' in response.text
    assert 'href="/data-io/export"' in response.text


# -- Operations CSV import -------------------------------------------------


def test_upload_operations_csv_imports_a_new_batch(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """A real BUY row (same shape as `demo/operations.csv`) writes a primary + cash leg under
    one fresh `import_batch_id` — the exact CSV contract `financeos import-operations` parses."""
    account_id = _one(con, "SELECT id FROM account LIMIT 1")
    asset_id = _one(con, "SELECT id FROM asset WHERE asset_class <> 'CASH' LIMIT 1")
    before = _one(con, "SELECT count(*) FROM operation")

    csv_body = (
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{account_id},{asset_id},BUY,2026-07-20,10,100.00,0,EUR,\n"
    )
    response = client.post(
        "/data-io/operations",
        files={"file": ("upload.csv", csv_body, "text/csv")},
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text
    assert response.headers["location"].startswith("/data-io?ok=")

    after = _one(con, "SELECT count(*) FROM operation")
    assert after == before + 2  # primary + cash leg


def test_upload_operations_rejects_malformed_csv_without_a_500(client: TestClient) -> None:
    """An unsupported `type` value redirects with an inline error, never a 500."""
    csv_body = (
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        "not-a-uuid,not-a-uuid,NOT_A_TYPE,2026-07-20,10,100.00,0,EUR,\n"
    )
    response = client.post(
        "/data-io/operations",
        files={"file": ("upload.csv", csv_body, "text/csv")},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=" in response.headers["location"]


# -- Strategy YAML import ---------------------------------------------------


def test_upload_strategy_yaml_freezes_a_new_version(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """Re-importing an already-known `strategy_id` freezes a new `StrategyVersion`, never
    mutates the existing one (ADR-0027)."""
    strategy_id = _one(con, "SELECT id FROM strategy LIMIT 1")
    definition = yaml.safe_load((REPO_ROOT / "demo" / "strategy.yaml").read_text())
    definition["strategy_id"] = strategy_id
    definition["change_note"] = "Ricongelata via upload web per il test."
    yaml_body = yaml.safe_dump(definition, sort_keys=False, allow_unicode=True)

    before_count = _one(con, "SELECT count(*) FROM strategy_version")
    before_version = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )

    response = client.post(
        "/data-io/strategy",
        files={"file": ("strategy.yaml", yaml_body, "application/x-yaml")},
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text
    assert response.headers["location"].startswith("/data-io?ok=")

    after_count = _one(con, "SELECT count(*) FROM strategy_version")
    after_version = _one(
        con, "SELECT current_version_id FROM strategy WHERE id = ?", [strategy_id]
    )
    assert after_count == before_count + 1
    assert after_version != before_version


def test_upload_strategy_rejects_malformed_yaml_without_a_500(client: TestClient) -> None:
    """Missing required keys (`name`, `horizon`, ...) redirect with an inline error."""
    response = client.post(
        "/data-io/strategy",
        files={"file": ("strategy.yaml", "just_one_key: true\n", "application/x-yaml")},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "error=" in response.headers["location"]


# -- Export -----------------------------------------------------------------


def test_export_downloads_a_real_zip_bundle(client: TestClient) -> None:
    """`export_authored` (RFC-0009 §7.1): the only recovery path for authored data — a zip
    with an apportionment file per Bucket, an assets file, and a file per frozen strategy
    version."""
    response = client.get("/data-io/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "financeos-authored-export.zip" in response.headers["content-disposition"]

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert any(name.startswith("apportionment/") for name in names)
    assert "assets.yaml" in names
    assert any(name.startswith("strategies/") for name in names)

    # every entry is real, parseable YAML — not an empty placeholder
    for name in names:
        yaml.safe_load(archive.read(name))


# -- Empty-state template ----------------------------------------------------

_TEMPLATE_CSVS = (
    "accounts.csv",
    "assets.csv",
    "portfolios.csv",
    "portfolio_accounts.csv",
    "buckets.csv",
    "apportionment.csv",
    "prices.csv",
)

_TEMPLATE_HEADERS = {
    "accounts.csv": "id,name,type,currency,cash_asset_id",
    "assets.csv": "id,name,asset_class,currency",
    "portfolios.csv": "id,name",
    "portfolio_accounts.csv": "portfolio_id,account_id",
    "buckets.csv": "id,portfolio_id,strategy_id,name",
    "apportionment.csv": "bucket_id,asset_id,quantity,effective_from",
    "prices.csv": "asset_id,valid_date,close,currency,source",
}


def test_template_download_has_header_only_csvs_and_a_strategy_skeleton(
    client: TestClient,
) -> None:
    response = client.get("/data-io/template")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "financeos-template.zip" in response.headers["content-disposition"]

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert names == {*_TEMPLATE_CSVS, "strategy.yaml"}

    for name in _TEMPLATE_CSVS:
        lines = archive.read(name).decode("utf-8").splitlines()
        assert lines == [_TEMPLATE_HEADERS[name]]  # header only, zero data rows

    strategy_doc = yaml.safe_load(archive.read("strategy.yaml"))
    assert strategy_doc["rules"], "template must satisfy I-4 (>=1 Rule)"
    weights = sum(float(t["weight"]) for t in strategy_doc["targets"])
    assert weights == pytest.approx(1.0), "template must satisfy I-13 (siblings sum to 1)"


def test_template_actually_seeds(tmp_path: Path, client: TestClient) -> None:
    """The real proof: fill the downloaded template with one minimal real row per structural
    file and feed it through the actual `financeos seed <dir>` command, unmodified strategy.yaml
    placeholders included — if this doesn't seed cleanly, the template is lying about its own
    shape."""
    archive = zipfile.ZipFile(io.BytesIO(client.get("/data-io/template").content))
    fixture_dir = tmp_path / "my-data"
    fixture_dir.mkdir()
    archive.extractall(fixture_dir)

    account_id = "b0000000-0000-0000-0000-000000000001"
    cash_asset_id = "a0000000-0000-0000-0000-000000000001"
    portfolio_id = "c0000000-0000-0000-0000-000000000001"
    bucket_id = "d0000000-0000-0000-0000-000000000001"
    strategy_id = "00000000-0000-0000-0000-000000000000"  # the template's own placeholder

    (fixture_dir / "assets.csv").write_text(
        f"id,name,asset_class,currency\n{cash_asset_id},Contanti,CASH,EUR\n"
    )
    (fixture_dir / "accounts.csv").write_text(
        f"id,name,type,currency,cash_asset_id\n{account_id},Conto,CASH,EUR,{cash_asset_id}\n"
    )
    (fixture_dir / "portfolios.csv").write_text(f"id,name\n{portfolio_id},Il mio portafoglio\n")
    (fixture_dir / "portfolio_accounts.csv").write_text(
        f"portfolio_id,account_id\n{portfolio_id},{account_id}\n"
    )
    (fixture_dir / "buckets.csv").write_text(
        f"id,portfolio_id,strategy_id,name\n{bucket_id},{portfolio_id},{strategy_id},Principale\n"
    )
    (fixture_dir / "apportionment.csv").write_text(
        f"bucket_id,asset_id,quantity,effective_from\n{bucket_id},{cash_asset_id},1000,2026-01-01\n"
    )

    runner = CliRunner()
    result = runner.invoke(
        cli, ["--db-path", str(tmp_path / "my.duckdb"), "seed", str(fixture_dir)]
    )
    assert result.exit_code == 0, result.output
