"""The three skeleton views, exercised end to end through `TestClient` (RFC-0005 §8.3).

There is no browser in this environment, so "the pages render" is verified the only honest way
available: by seeding the demo store, running a real evaluation, and asking the real app for
every route. A template that references a missing key, a filter that is not registered or a
query whose columns moved all fail here rather than in front of a reader.

Two checks earn their place beyond "it returns 200", and both close gaps that nothing else
covers:

* **`docs/design/audit_offline.mjs` never sees these pages.** It audits the dumped design
  preview and the world proofs. So the "no hex, `token:--name` only" rule is enforced here for
  the options the *served* routes assemble, including that every token named actually exists in
  `tokens.css` — an unresolvable token silently renders a mark with no colour.
* **Absence is asserted, not assumed.** The findings list must *not* carry the net-worth number
  (UX-0001 §5.3) and `/allocation` must carry it. A test that only checks for presence would
  pass just as happily with a hero number bolted onto the landing page.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import duckdb
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from financeos.adapters.duckdb.queries.findings import list_findings
from financeos.app.evaluate_strategy import evaluate_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.cli import app as cli
from financeos.core.portfolio import Asset, Bucket, Operation, OperationType, Portfolio
from financeos.core.shared import (
    AccountId,
    AssetId,
    BucketId,
    OperationId,
    PortfolioId,
    Priority,
    Quantity,
    RuleId,
    Scope,
    StrategyId,
    StrategyVersionId,
    SuggestionClass,
)
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskLevel,
    RiskProfile,
    Rule,
    StrategyDefinition,
    StrategyVersion,
)
from financeos.ports import AccountInfo
from financeos.web.main import create_app
from tests import factories as f
from tests.test_evaluate_strategy import MIGRATION_PATH


class _FixedTestClock:
    def now(self) -> datetime:
        return datetime(2026, 7, 24, 12, 0, tzinfo=UTC)


class _CountingIdGen:
    def __init__(self, start: int) -> None:
        self._n = start

    def __call__(self) -> UUID:
        self._n += 1
        return UUID(int=self._n)

REPO_ROOT = Path(__file__).resolve().parents[1]
TOKENS_CSS = REPO_ROOT / "src" / "financeos" / "web" / "static" / "css" / "tokens.css"

#: UX-0001 §8.3: the six-class fixture's Portfolio-wide net worth.
NET_WORTH = "€107.586,33"

#: UX-0001 §8.5 row 2 / RFC-0005 §8.3: the canonical finding — Pensione's Equity/Developed
#: drift, the only one at severity 3.00000000.
CANONICAL_RULE_ID = "10000000-0000-0000-0000-000000000001"

OPTION_RE = re.compile(r'<script type="application/json" id="([^"]+)">([\s\S]*?)</script>')
TOKEN_RE = re.compile(r'"token:(--[a-z0-9-]+)"')
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")


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
        assert "10 Recommendation" in evaluated.output
    return db_path


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """The app over a seeded and evaluated demo store."""
    return TestClient(create_app(_seed(tmp_path)))


@pytest.fixture
def recommendation_id(client: TestClient) -> str:
    """The canonical Recommendation (RFC-0005 §8.3): Pensione's Equity/Developed drift,
    severity 3.00000000 — the only one of the fixture's ten at that exact severity.

    Derived from the client rather than seeded separately: ids are UUIDv7 generated per seed,
    so a second store would hand out an id the app under test has never heard of.
    """
    con: duckdb.DuckDBPyConnection = client.app.state.connection  # type: ignore[attr-defined]
    row = (
        con.cursor()
        .execute(
            "SELECT r.id FROM recommendation r JOIN alert a ON a.id = r.alert_id "
            "WHERE a.rule_id = ? AND a.severity = 3"
        , [CANONICAL_RULE_ID])
        .fetchone()
    )
    assert row is not None
    return str(row[0])


# --- the three routes render -------------------------------------------------


def test_findings_list_renders_the_one_canonical_finding(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    body = response.text
    # The observation, re-rendered it-IT: decimal comma, and agreement carried by the role
    # bindings so a feminine-plural head reads "sono" and not "è" (D10, P25).
    assert "Le Azioni dei paesi sviluppati" in body
    assert "sono al 34,00%" in body
    assert "contro un target del 40,00%" in body
    # P18: "target", never "obiettivo".
    assert "obiettivo" not in body.lower()
    # The outcome chip reads from CHROME_LABELS (W1d-c), not its own hardcoded table.
    assert "Scattata" in body
    assert "RILEVATO" not in body


def test_findings_list_has_no_net_worth_hero(client: TestClient) -> None:
    """UX-0001 §5.3, asserted as an absence.

    P1 says the decisions are the product, so the landing screen is the findings list and net
    worth lives one click away. This is the test that fails if a hero number is ever added.
    """
    body = client.get("/").text
    assert NET_WORTH not in body
    assert "Patrimonio netto" not in body


def test_findings_order_is_the_views_order_never_resorted(
    client: TestClient, tmp_path: Path
) -> None:
    """The page's row order is `mv_finding`'s, position for position (RFC-0008 §3)."""
    con: duckdb.DuckDBPyConnection = client.app.state.connection  # type: ignore[attr-defined]
    expected = [f.latest_recommendation_id for f in list_findings(con.cursor())]
    body = client.get("/").text
    rendered = re.findall(r"/recommendations/([0-9a-f-]{36})\"", body)
    # Each finding links to its latest recommendation exactly once, in the view's order.
    assert list(dict.fromkeys(rendered)) == expected


def test_explanation_surface_renders_all_nine_blocks(
    client: TestClient, recommendation_id: str
) -> None:
    response = client.get(f"/recommendations/{recommendation_id}")
    assert response.status_code == 200
    body = response.text
    for designation in (
        "Motivazione",
        "Valori in ingresso e calcolo",
        "Provenienza",
        "Storia del rilievo",
        "Riconciliazione",
        "Cosa detenevi quando è comparso",
        "La decisione",
    ):
        assert designation in body, designation
    # Two blocks with no source in the skeleton report the absence rather than vanishing:
    # an omitted block is indistinguishable from a reassuring one (ADR-0016).
    assert "Nessuna ricomputazione eseguita." in body
    assert "Registra decisione" in body
    # Portfolio state now has a source: `evaluate_strategy` writes a `Snapshot` sharing this
    # run's id on every run (RFC-0009 §5.1), so the ledger renders instead of the absence note.
    assert "Nessuno snapshot per questa valutazione." not in body
    assert NET_WORTH in body
    assert "0.25496468" in body


def test_trace_is_a_lazy_htmx_fragment(client: TestClient, recommendation_id: str) -> None:
    """Blocks 3 and 4 arrive on `revealed`, from their own endpoint (UX-0001 §3)."""
    page = client.get(f"/recommendations/{recommendation_id}").text
    assert f'hx-get="/recommendations/{recommendation_id}/trace"' in page
    assert 'hx-trigger="revealed"' in page
    # The ladder itself is NOT in the page; it is what the fragment adds.
    assert "Valore vincolato" not in page

    fragment = client.get(f"/recommendations/{recommendation_id}/trace")
    assert fragment.status_code == 200
    assert "Valore vincolato" in fragment.text
    # A fragment, not a page.
    assert "<!DOCTYPE html>" not in fragment.text


def test_trace_decimals_render_exactly_as_stored(
    client: TestClient, recommendation_id: str
) -> None:
    """UX-0001 §4.2 rule 2: never format a trace value.

    The it-IT re-rendering of ADR-L03 §5.2 applies to the observation and to nothing in the
    ladder. If a locale filter is ever applied to a binding, the replay guarantee this surface
    exists to demonstrate is broken — so the localised forms are asserted absent.
    """
    body = client.get(f"/recommendations/{recommendation_id}/trace").text
    for stored in ("0.34000000", "0.40000000", "ABSOLUTE 0.02000000", "-0.06000000"):
        assert stored in body, stored
    for localised in ("0,34000000", "0,40000000", "-0,06000000"):
        assert localised not in body, localised


def test_allocation_carries_net_worth_and_reconciles(client: TestClient) -> None:
    response = client.get("/allocation")
    assert response.status_code == 200
    body = response.text
    assert NET_WORTH in body
    assert "Patrimonio netto" in body
    # Italian short forms on axis, legend and cell (P23, P24) — never English.
    assert "Sviluppati" in body
    assert "Gov. euro" in body
    assert "EQUITY_DEVELOPED" not in body
    # ADR-0025: the residual closes the reconciliation and is shown even at zero.
    assert "Capitale non assegnato" in body


def _single_strategy_portfolio_db(db_path: Path) -> None:
    """A single-Bucket, single-Strategy Portfolio, written straight to `db_path`.

    The demo Portfolio is *permanently* heterogeneous by construction (UX-0001 §8.4's two
    Strategies) — `adapters/duckdb/queries/allocation.py` determines "heterogeneous" from
    the Portfolio's *own* Bucket set, not from which scope a particular run evaluated, so no
    `--bucket-id` selection against the demo fixture can make `/allocation`'s target
    percentages observable. This builds a Portfolio where they are.
    """
    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")
    con.execute(MIGRATION_PATH.read_text())
    uow = DuckDBUnitOfWork(con)

    fund_id = AssetId(UUID(int=8001))
    cash_id = AssetId(UUID(int=8002))
    uow.assets.add(Asset(id=fund_id, name="Fund", asset_class="CASH", currency="EUR"))
    uow.assets.add(Asset(id=cash_id, name="Cash", asset_class="CASH", currency="EUR"))
    uow.prices.add(
        uuid4(), fund_id, valid_date=date(2026, 7, 24), close="1", currency="EUR",
        source="seed", recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )
    account_id = AccountId(uuid4())
    uow.accounts.add(
        AccountInfo(id=account_id, cash_asset_id=cash_id, currency="EUR"), name="Main",
        type_="BROKERAGE",
    )
    portfolio_id = PortfolioId(uuid4())
    uow.portfolios.add(Portfolio(id=portfolio_id, name="P", accounts=(account_id,)))
    strategy_id = StrategyId(uuid4())
    uow.strategies.ensure_strategy(strategy_id, name="S")
    bucket_id = BucketId(uuid4())
    uow.buckets.add(
        Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
    )
    primary_id = OperationId(uuid4())
    uow.operations.write(
        [
            Operation(
                id=primary_id, type=OperationType.BUY, account_id=account_id, asset_id=fund_id,
                trade_date=date(2026, 7, 24), quantity=Quantity(amount=Decimal("100")),
                price=Decimal("1"), fees=Decimal(0), currency="EUR",
                recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
            ),
            Operation(
                id=OperationId(uuid4()), type=OperationType.BUY, account_id=account_id,
                asset_id=cash_id, trade_date=date(2026, 7, 24),
                quantity=Quantity(amount=Decimal("-100")), price=Decimal("1"), fees=Decimal(0),
                currency="EUR", cash_leg_of=primary_id,
                recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
            ),
        ],
        import_batch_id=uuid4(),
    )
    version = StrategyVersion(
        id=StrategyVersionId(uuid4()),
        strategy_id=strategy_id,
        definition=StrategyDefinition(
            name="S",
            horizon=Horizon(years=10),
            risk=RiskProfile(level=RiskLevel.BALANCED),
            targets=f.flat_targets(("CASH", "1.0", f.absolute("0.10"))),
            rules=(
                Rule(
                    id=RuleId(UUID(int=1)),
                    name="r",
                    priority=Priority.HIGH,
                    suggestion_class=SuggestionClass.CONSIDER_REBALANCE,
                    message="m",
                    condition=LeafCondition(
                        kind="drift_outside_tolerance",
                        kind_version=1,
                        params={
                            "asset_class": "CASH",
                            "scope": Scope.for_bucket(bucket_id).ref,
                        },
                    ),
                ),
            ),
        ),
        change_note="seed",
        frozen_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )
    uow.strategies.freeze_version(version)
    evaluate_strategy(
        uow, _CountingIdGen(0), _FixedTestClock(), scope=Scope.for_bucket(bucket_id),
        as_of=date(2026, 7, 24), currency="EUR",
    )
    con.close()


def _unpriced_holding_portfolio_db(db_path: Path) -> None:
    """A Bucket holding one priced and one genuinely unpriced Asset.

    The demo fixture prices every Asset — CASH included, at par (UX-0001 §8.1) — so it no
    longer exercises `compute_allocation`'s "an unpriced holding contributes nothing and is
    reported" contract at the read side. `compute_residual` (ADR-0029) also treats *any*
    unpriced Portfolio-wide holding as unavailable, so this cannot be grafted onto the demo
    fixture without SKIPping `unassigned_residual_above` and moving the §8.5 SKIPPED count —
    an isolated Portfolio is the only way to exercise this without disturbing it.
    """
    con = duckdb.connect(str(db_path))
    con.execute("SET TimeZone='UTC'")
    con.execute(MIGRATION_PATH.read_text())
    uow = DuckDBUnitOfWork(con)

    priced_id = AssetId(UUID(int=8101))
    unpriced_id = AssetId(UUID(int=8102))
    cash_id = AssetId(UUID(int=8103))
    uow.assets.add(
        Asset(id=priced_id, name="Priced Fund", asset_class="EQUITY_DEVELOPED", currency="EUR")
    )
    uow.assets.add(
        Asset(id=unpriced_id, name="Unpriced Fund", asset_class="EQUITY_GLOBAL", currency="EUR")
    )
    uow.assets.add(Asset(id=cash_id, name="Cash", asset_class="CASH", currency="EUR"))
    uow.prices.add(
        uuid4(), priced_id, valid_date=date(2026, 7, 24), close="1", currency="EUR",
        source="seed", recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )
    # unpriced_id deliberately gets no price row.

    account_id = AccountId(uuid4())
    uow.accounts.add(
        AccountInfo(id=account_id, cash_asset_id=cash_id, currency="EUR"), name="Main",
        type_="BROKERAGE",
    )
    portfolio_id = PortfolioId(uuid4())
    uow.portfolios.add(Portfolio(id=portfolio_id, name="P", accounts=(account_id,)))
    strategy_id = StrategyId(uuid4())
    uow.strategies.ensure_strategy(strategy_id, name="S")
    bucket_id = BucketId(uuid4())
    uow.buckets.add(
        Bucket(id=bucket_id, portfolio_id=portfolio_id, strategy_id=strategy_id, name="B")
    )
    legs: list[Operation] = []
    for asset_id, quantity in ((priced_id, "100"), (unpriced_id, "50")):
        primary_id = OperationId(uuid4())
        legs.append(
            Operation(
                id=primary_id, type=OperationType.BUY, account_id=account_id, asset_id=asset_id,
                trade_date=date(2026, 7, 24), quantity=Quantity(amount=Decimal(quantity)),
                price=Decimal("1"), fees=Decimal(0), currency="EUR",
                recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
            )
        )
        legs.append(
            Operation(
                id=OperationId(uuid4()), type=OperationType.BUY, account_id=account_id,
                asset_id=cash_id, trade_date=date(2026, 7, 24),
                quantity=Quantity(amount=-Decimal(quantity)), price=Decimal("1"), fees=Decimal(0),
                currency="EUR", cash_leg_of=primary_id,
                recorded_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
            )
        )
    uow.operations.write(legs, import_batch_id=uuid4())

    version = StrategyVersion(
        id=StrategyVersionId(uuid4()),
        strategy_id=strategy_id,
        definition=StrategyDefinition(
            name="S",
            horizon=Horizon(years=10),
            risk=RiskProfile(level=RiskLevel.BALANCED),
            targets=f.flat_targets(("EQUITY_DEVELOPED", "1.0", f.absolute("0.10"))),
            rules=(
                Rule(
                    id=RuleId(UUID(int=2)),
                    name="r",
                    priority=Priority.HIGH,
                    suggestion_class=SuggestionClass.CONSIDER_REBALANCE,
                    message="m",
                    condition=LeafCondition(
                        kind="drift_outside_tolerance",
                        kind_version=1,
                        params={
                            "asset_class": "EQUITY_DEVELOPED",
                            "scope": Scope.for_bucket(bucket_id).ref,
                        },
                    ),
                ),
            ),
        ),
        change_note="seed",
        frozen_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )
    uow.strategies.freeze_version(version)
    evaluate_strategy(
        uow, _CountingIdGen(0), _FixedTestClock(), scope=Scope.for_bucket(bucket_id),
        as_of=date(2026, 7, 24), currency="EUR",
    )
    con.close()


def test_allocation_reports_the_unpriced_position_rather_than_dropping_it(
    tmp_path: Path,
) -> None:
    """The demo's CASH position is priced at par (UX-0001 §8.1), so this isolated Portfolio
    is what exercises `compute_allocation`'s documented contract: an unpriced holding
    contributes nothing and is recorded. Silently excluding it would understate the total by
    an unknown amount while reading as a complete answer.
    """
    db_path = tmp_path / "financeos.duckdb"
    _unpriced_holding_portfolio_db(db_path)
    body = TestClient(create_app(db_path)).get("/allocation").text
    assert "senza prezzo" in body
    assert "Questo totale è un minimo, non un totale." in body
    assert "Unpriced Fund" in body


def test_allocation_targets_use_the_runs_frozen_version_not_current(tmp_path: Path) -> None:
    """ADR-0012: audit correctness reads what the run measured against.

    Re-freezing the Strategy after the run must not change what `/allocation` shows: the
    targets on screen are the run's pinned `strategy_version_id`, never
    `strategy.current_version_id`.
    """
    db_path = tmp_path / "financeos.duckdb"
    _single_strategy_portfolio_db(db_path)

    local_client = TestClient(create_app(db_path))
    con: duckdb.DuckDBPyConnection = local_client.app.state.connection  # type: ignore[attr-defined]
    cur = con.cursor()
    row = cur.execute(
        "SELECT sv.strategy_id, sv.id, sv.definition "
        "FROM evaluation_run run JOIN strategy_version sv ON sv.id = run.strategy_version_id "
        "ORDER BY run.evaluated_at DESC LIMIT 1"
    ).fetchone()
    assert row is not None
    strategy_id, version_id, definition = row
    changed = json.loads(str(definition))
    for node in changed["targets"]["children"]:
        if node["key"] == "CASH":
            node["weight"]["value"] = "0.99000000"
    new_version_id = "test-reversion-0001"
    cur.execute(
        "INSERT INTO strategy_version (id, strategy_id, parent_version_id, definition, "
        "change_note, frozen_at) VALUES (?, ?, ?, ?, 'test re-freeze', current_timestamp)",
        [new_version_id, strategy_id, version_id, json.dumps(changed)],
    )
    cur.execute(
        "UPDATE strategy SET current_version_id = ? WHERE id = ?", [new_version_id, strategy_id]
    )

    body = local_client.get("/allocation").text
    assert "contro un target del 100,00%" in body
    assert "99,00%" not in body


def test_design_preview_still_serves(client: TestClient) -> None:
    assert client.get("/design").status_code == 200


# --- chart options: no hex, and every token resolves -------------------------


def _options(body: str) -> list[tuple[str, str]]:
    return OPTION_RE.findall(body)


def _declared_tokens() -> set[str]:
    return set(re.findall(r"(--[a-z0-9-]+)\s*:", TOKENS_CSS.read_text(encoding="utf-8")))


@pytest.mark.parametrize("route", ["/allocation", "RECOMMENDATION"])
def test_served_chart_options_carry_no_hex_and_only_real_tokens(
    client: TestClient, recommendation_id: str, route: str
) -> None:
    """Chart role colours pass as `"token:--name"`, never as hex, and every name is real.

    `audit_offline.mjs` checks this for the dumped design preview; these are the options the
    served routes assemble, which it never sees. An unresolvable token renders a mark with no
    colour at all, so the names are checked against `tokens.css` rather than merely matched
    against a pattern.
    """
    path = f"/recommendations/{recommendation_id}" if route == "RECOMMENDATION" else route
    body = client.get(path).text
    options = _options(body)
    assert options, f"{path} carries no chart options at all"

    declared = _declared_tokens()
    for chart_id, raw in options:
        assert not HEX_RE.findall(raw), f"{chart_id}: hex colour in a server option"
        json.loads(raw)  # a malformed option would fail silently in the browser
        for token in TOKEN_RE.findall(raw):
            assert token in declared, f"{chart_id}: {token} is not declared in tokens.css"


def test_pages_reference_nothing_off_origin(client: TestClient, recommendation_id: str) -> None:
    """ADR-0008, Local First: the app must render with the network disabled."""
    for path in ("/", "/allocation", f"/recommendations/{recommendation_id}"):
        body = client.get(path).text
        off_origin = re.findall(r'(?:src|href)\s*=\s*["\'](?:https?:)?//[^"\']*', body)
        assert not off_origin, f"{path}: {off_origin}"


def test_vendored_libraries_are_referenced_and_present(client: TestClient) -> None:
    """HTMX and ECharts are vendored, not linked (ADR-0007, ADR-0008)."""
    body = client.get("/").text
    for asset in ("/static/vendor/htmx/htmx.min.js", "/static/vendor/echarts/echarts.min.js"):
        assert asset in body
        assert client.get(asset).status_code == 200


# --- the honest empty states ------------------------------------------------


def test_seeded_but_unevaluated_store_says_so(tmp_path: Path) -> None:
    """A store with facts and no evaluation is a real state, distinct from "nothing found"."""
    client = TestClient(create_app(_seed(tmp_path, evaluate=False)))
    response = client.get("/")
    assert response.status_code == 200
    assert "Nessuna valutazione registrata." in response.text
    # And it is not dressed up as compliance.
    assert "Nessun rilievo aperto." not in response.text
    # /allocation has no run to read an as_of from, and says so rather than guessing a date.
    assert client.get("/allocation").status_code == 404


def test_unknown_recommendation_is_a_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/recommendations/{missing}").status_code == 404
    assert client.get(f"/recommendations/{missing}/trace").status_code == 404
