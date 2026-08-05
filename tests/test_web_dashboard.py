"""`/dashboard` — «Il patrimonio annotato», variation C (task #12, W2 plan doc, ADR-0029)."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.cli import app as cli
from financeos.core.portfolio import Bucket
from financeos.core.shared import BucketId, PortfolioId, Scope, StrategyId
from financeos.web.main import create_app

NET_WORTH = "€54.000,00"

#: The demo fixture's own Portfolio/Strategy (`demo/portfolios.csv`, `demo/strategy.yaml`) —
#: read here as fixed ids rather than queried, exactly as `test_queries.py`'s `DEMO_BUCKET_ID`
#: does. `DEMO_AS_OF` is `_seed`'s own `--as-of`.
DEMO_PORTFOLIO_ID = "a8283d57-9cc4-5376-8952-1cf4208fcbd7"
DEMO_STRATEGY_ID = "237f27fd-8230-53be-8a8c-f30e6d53812c"
#: "Preservazione del capitale" (`demo/strategy-capital-preservation.yaml`) — its 3 rules are
#: all Bucket-specific to Emergenza by id, with no `scope_gate` (unlike `DEMO_STRATEGY_ID`'s 7
#: generic `scope_gate: {kind: BUCKET}` rules, which apply to *every* Bucket the growth
#: Strategy governs — including a new one). A synthetic Bucket placed under this Strategy is
#: genuinely ungated: zero alerts of any outcome, not the 7 `SKIPPED(zero_portfolio_value)`
#: `DEMO_STRATEGY_ID` would produce (task #12/#dashboard review BLOCKING-1 — that 7-skip state
#: is Personale's own, tested separately below, and is not "never evaluated").
DEMO_STRATEGY_ID_UNGATED = "337f27fd-8230-53be-8a8c-f30e6d53812d"
DEMO_AS_OF = date(2026, 7, 24)

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


@pytest.fixture
def con(client: TestClient) -> duckdb.DuckDBPyConnection:
    shared: duckdb.DuckDBPyConnection = client.app.state.connection  # type: ignore[attr-defined]
    return shared.cursor()


def _add_bucket_with_no_rules_gated(con: duckdb.DuckDBPyConnection) -> str:
    """A synthetic 2nd Bucket ("Libero"), sharing the demo Portfolio but placed under the
    "Preservazione del capitale" Strategy (`DEMO_STRATEGY_ID_UNGATED`) — whose rules all name
    Emergenza specifically, none of them — built directly against the already-seeded store
    rather than by mutating `demo/` (task #12 review SHOULD-FIX 4). `demo/` is a shared,
    product-owner-pinned fixture (the six-class growth, pinned against `demo/expected/`) and
    must not carry test-only Buckets.

    Placing it under the growth Strategy (`DEMO_STRATEGY_ID`) instead would not do this: that
    Strategy's 7 rules are `scope_gate: {kind: BUCKET}` and apply to *every* Bucket it governs,
    so a new Bucket there gets the same 7 `SKIPPED(zero_portfolio_value)` alerts Personale
    carries — a run that settled nothing, not a run with zero rules gated to it at all (task
    #12/#dashboard review BLOCKING-1; the former is exercised by
    `test_dashboard_bucket_with_all_rules_skipped_is_not_reported_never_evaluated` below).

    `evaluate_strategy` runs directly against this one Bucket's scope, at the same `as_of` the
    seeded demo run used, reproducing "a run but zero rules gated to it" (review BLOCKING)
    without a second `financeos evaluate` pass over every Bucket.
    """
    uow = DuckDBUnitOfWork(con)
    bucket_id = BucketId(uuid4())
    uow.buckets.add(
        Bucket(
            id=bucket_id,
            portfolio_id=PortfolioId(UUID(DEMO_PORTFOLIO_ID)),
            strategy_id=StrategyId(UUID(DEMO_STRATEGY_ID_UNGATED)),
            name="Libero",
        )
    )
    evaluate_strategy(
        uow,
        UUIDv7IdGen(),
        SystemClock(),
        scope=Scope.for_bucket(bucket_id),
        as_of=DEMO_AS_OF,
        currency="EUR",
    )
    return str(bucket_id)


def test_dashboard_carries_net_worth_and_composition(client: TestClient) -> None:
    body = client.get("/dashboard").text
    assert NET_WORTH in body
    assert "Patrimonio netto" in body
    # ADR-0029: the residual closes the reconciliation and is shown even at zero.
    assert "Non assegnato" in body


def test_dashboard_composition_chart_segments_reconcile_to_net_worth(client: TestClient) -> None:
    """Guard 2 (ADR-0029), verified from the chart option's own JSON rather than a raw
    "€54.000,00" substring that happens to appear twice in the page (task #12 review SHOULD-FIX
    4): the Bucket segments (Pensione, the unassigned residual) sum to the same net worth the
    chart's own `markLine` states."""
    body = client.get("/dashboard").text
    options = dict(_options(body))
    option = json.loads(options["chart-dashboard-comp-option"])
    segments = [series["data"][0] for series in option["series"]]
    mark_line_value = option["series"][0]["markLine"]["data"][0]["xAxis"]
    assert sum(segments) == pytest.approx(mark_line_value)
    assert mark_line_value == option["xAxis"]["max"]


def test_dashboard_bucket_card_never_shows_open_findings_without_unevaluated(
    client: TestClient, con: duckdb.DuckDBPyConnection
) -> None:
    """The guard variation C stands or falls on (W2 plan doc).

    Both branches of the guard actually render here: Pensione has a run and one measured rule
    (the full counts branch), a synthetic "Libero" Bucket (built in-test, not via `demo/`) has a
    run but zero rules gated to it (task #12 review BLOCKING) — and each card's own markup is
    checked in isolation, not "somewhere in the page", so a bug that renders the two counts in
    *different* cards would still fail this."""
    _add_bucket_with_no_rules_gated(con)
    body = client.get("/dashboard").text
    blocks = _card_blocks(body)
    assert blocks, "no Bucket card markup found on /dashboard"

    measured = [b for b in blocks if "Pensione" in b]
    assert measured, "the Pensione card is missing"
    for block in measured:
        assert "Rilievi aperti" in block
        assert "Regole con un esito" in block
        assert "Regole non valutate" in block
        assert "Severità più alta" in block
        assert "non è mai stato valutato" not in block

    no_measure = [b for b in blocks if "Libero" in b]
    assert no_measure, "the Libero card (zero rules gated to it) is missing"
    for block in no_measure:
        assert "non è mai stato valutato" in block
        # ADR-0016: the caveat, never a bare zero beside it in the same card.
        assert "Rilievi aperti" not in block
        assert "Regole con un esito" not in block
        assert "Regole non valutate" not in block


def test_dashboard_bucket_with_all_rules_skipped_is_not_reported_never_evaluated(
    client: TestClient,
) -> None:
    """The demo fixture's own "Personale" Bucket (`demo/buckets.csv`) is empty and every one of
    its 7 rules is `SKIPPED(zero_portfolio_value)` (task #12/#dashboard review BLOCKING-1) — a
    run *was* recorded, unlike a Bucket that was truly never evaluated. The old
    `not state.rules_measured` condition conflated the two and rendered the false "mai stato
    valutato" / "nessuna esecuzione registrata" copy, silently dropping the
    `rules_unevaluated == 7` count ADR-0016's guard-1 exists to surface."""
    body = client.get("/dashboard").text
    blocks = _card_blocks(body)
    personale = [b for b in blocks if "Personale" in b]
    assert personale, "the Personale card is missing"
    for block in personale:
        assert "non è mai stato valutato" not in block
        assert "Nessuna esecuzione registrata" not in block
        assert "nessuna regola ha raggiunto un esito" in block
        assert "Regole non valutate" in block
        assert "7" in block


def test_dashboard_ledger_is_mv_finding_order_never_resorted(client: TestClient) -> None:
    body = client.get("/dashboard").text
    assert "Sviluppati" in body
    assert "Pensione" in body
    # The outcome chip reads from CHROME_LABELS, same as the findings list.
    assert "Scattata" in body


def test_dashboard_skip_notice_present_when_something_was_skipped(client: TestClient) -> None:
    """The six-class demo fixture (task #2) now carries real SKIPPED/ERROR outcomes, so the
    notice must render rather than stay silent (ADR-0016). This test used to assert the
    opposite — the pre-growth demo had no SKIPPED/ERROR alert — and was updated when the
    fixture grew. The "absent when nothing was skipped" branch is untested here; it would
    need its own isolated no-skip fixture (see `single_governance_con` in test_queries.py for
    the pattern) rather than reusing the shared demo/, which is deliberately not skip-free."""
    body = client.get("/dashboard").text
    assert "non sono state valutate" in body
    assert "si è interrotta con un errore" in body


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


#: One Bucket card's own `<article class="record...">...</article>` markup, isolated so a count
#: pairing can be checked *within* one card rather than "somewhere in the page" (task #12 review
#: SHOULD-FIX 4). No HTML parser dependency: each card starts at its own `<article` tag and ends
#: exactly where the next one begins (or the region does), which holds for this template's flat,
#: unnested card grid.
def _card_blocks(body: str) -> list[str]:
    grid_start = body.index("Dove stanno gli scostamenti")
    grid_end = body.index("I rilievi registrati")
    region = body[grid_start:grid_end]
    parts = re.split(r'(?=<article class="record)', region)
    return [p for p in parts if p.startswith('<article class="record')]


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
