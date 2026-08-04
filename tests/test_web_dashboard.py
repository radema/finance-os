"""`/dashboard` — «Il patrimonio annotato», variation C (task #12, W2 plan doc, ADR-0029)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.cli import app as cli
from financeos.web.main import create_app

NET_WORTH = "€54.000,00"

OPTION_RE = re.compile(r'<script type="application/json" id="([^"]+)">([\s\S]*?)</script>')
TOKEN_RE = re.compile(r'"token:(--[a-z0-9-]+)"')
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
TOKENS_CSS = (
    Path(__file__).resolve().parents[1] / "src" / "financeos" / "web" / "static" / "css"
    / "tokens.css"
)


def _seed(tmp_path: Path, *, evaluate: bool = True) -> Path:
    db_path = tmp_path / "financeos.duckdb"
    runner = CliRunner()
    seeded = runner.invoke(cli, ["--db-path", str(db_path), "seed", "demo"])
    assert seeded.exit_code == 0, seeded.output
    if evaluate:
        evaluated = runner.invoke(
            cli, ["--db-path", str(db_path), "evaluate", "--as-of", "2026-07-24"]
        )
        assert evaluated.exit_code == 0, evaluated.output
    return db_path


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_seed(tmp_path)))


def test_dashboard_carries_net_worth_and_composition(client: TestClient) -> None:
    body = client.get("/dashboard").text
    assert NET_WORTH in body
    assert "Patrimonio netto" in body
    # ADR-0029: the residual closes the reconciliation and is shown even at zero.
    assert "Non assegnato" in body


def test_dashboard_bucket_card_never_shows_open_findings_without_unevaluated(
    client: TestClient,
) -> None:
    """The guard variation C stands or falls on (W2 plan doc)."""
    body = client.get("/dashboard").text
    assert "Pensione" in body
    assert "Rilievi aperti" in body
    assert "Regole con un esito" in body
    assert "Regole non valutate" in body
    assert "Severità più alta" in body


def test_dashboard_ledger_is_mv_finding_order_never_resorted(client: TestClient) -> None:
    body = client.get("/dashboard").text
    assert "Sviluppati" in body
    assert "Pensione" in body
    # The outcome chip reads from CHROME_LABELS, same as the findings list.
    assert "Scattata" in body


def test_dashboard_skip_notice_absent_when_nothing_was_skipped(client: TestClient) -> None:
    """The demo run leaves no SKIPPED/ERROR alert, so the notice renders nothing (ADR-0016)."""
    body = client.get("/dashboard").text
    assert "non sono state valutate" not in body
    assert "si sono interrotte con un errore" not in body


def test_dashboard_nav_entry_present(client: TestClient) -> None:
    assert 'href="/dashboard"' in client.get("/").text


def test_findings_landing_page_is_untouched(client: TestClient) -> None:
    """`/` stays findings-first (P1, UX-0001 §5.3) — this route is a sibling, not a replacement."""
    body = client.get("/").text
    assert NET_WORTH not in body
    assert "Patrimonio netto" not in body


def test_seeded_but_unevaluated_store_is_a_404(tmp_path: Path) -> None:
    client = TestClient(create_app(_seed(tmp_path, evaluate=False)))
    assert client.get("/dashboard").status_code == 404


def test_design_preview_still_serves_and_prototype_route_is_gone(client: TestClient) -> None:
    assert client.get("/design").status_code == 200
    assert client.get("/design/dashboard").status_code == 404


def _options(body: str) -> list[tuple[str, str]]:
    return OPTION_RE.findall(body)


def _declared_tokens() -> set[str]:
    return set(re.findall(r"(--[a-z0-9-]+)\s*:", TOKENS_CSS.read_text(encoding="utf-8")))


def test_dashboard_chart_options_carry_no_hex_and_only_real_tokens(client: TestClient) -> None:
    body = client.get("/dashboard").text
    options = _options(body)
    assert options, "/dashboard carries no chart options at all"

    declared = _declared_tokens()
    for chart_id, raw in options:
        assert not HEX_RE.findall(raw), f"{chart_id}: hex colour in a server option"
        json.loads(raw)
        for token in TOKEN_RE.findall(raw):
            assert token in declared, f"{chart_id}: {token} is not declared in tokens.css"


def test_dashboard_references_nothing_off_origin(client: TestClient) -> None:
    body = client.get("/dashboard").text
    off_origin = re.findall(r'(?:src|href)\s*=\s*["\'](?:https?:)?//[^"\']*', body)
    assert not off_origin
