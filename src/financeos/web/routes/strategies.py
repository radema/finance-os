"""Strategy authoring at `/strategies`, `/strategies/{id}` — screen 6, built last (ADR-0017,
ADR-0018, ADR-0009, ADR-0027, ADR-0030).

RFC-0005 §8's own reasoning, restated by UX-0001 §9.3: a form-based Strategy editor is the most
speculative UI in the product, so it is built after every other V1.0 screen has settled the Rule
representation it edits.

**Every edit freezes a new immutable version and requires a `change_note` (RFC-0007 §7).**
`StrategyVersion.change_note` has a `min_length=1` field constraint, so an empty note is rejected
by the domain model itself before this route ever calls the repository — there is no code path
here that freezes a version without one.

**Freeze, pointer move and export are one transaction — for the two steps this route owns.**
`StrategyRepository.freeze_version` writes the new `strategy_version` row and repoints
`strategy.current_version_id` inside one call (its own docstring states this). The third step —
`financeos export --authored` — is a CLI command run after a migration, not part of this request;
nothing here claims to perform it.

**Scope deliberately narrower than the full ask, stated rather than silently dropped:**
- The target tree editor supports depth 1 and depth 2 (weight + tolerance on every leaf, at
  either level, plus adding one new depth-1 leaf). It does not support restructuring a tree
  (moving a node, adding a child under an existing branch, or deleting a node) — RFC-0010 §352
  calls this screen "the fiddliest UI in V1", and reshaping is the fiddliest part of it.
- The rule editor supports enable/disable, Priority, SuggestionClass, message and the
  condition's own params on every existing Rule, plus adding one new Rule from the real
  closed catalog (`ConditionRegistry`, ADR-0014) with its own kind, params and priority. It
  does not support changing an existing Rule's condition *kind* (that path is "add a new
  Rule from the catalog" instead), or deleting a Rule.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import ValidationError

from financeos.adapters.duckdb.queries.runs import latest_actual_run
from financeos.adapters.duckdb.queries.strategies import (
    RuleView,
    StrategyDetail,
    TargetNodeView,
    get_strategy_detail,
    list_strategies,
    rule_catalog_kinds,
)
from financeos.adapters.system import SystemClock, UUIDv7IdGen
from financeos.app.freeze_strategy import freeze_strategy
from financeos.app.unit_of_work import DuckDBUnitOfWork
from financeos.core.engines.rule_engine import REGISTRY
from financeos.core.shared import (
    Priority,
    RuleId,
    StrategyId,
    SuggestionClass,
    UnknownConditionKindError,
    Weight,
    canonical_decimal,
)
from financeos.core.strategy import (
    Horizon,
    LeafCondition,
    RiskLevel,
    RiskProfile,
    Rule,
    StrategyDefinition,
    TargetAllocation,
    TargetNode,
    Tolerance,
    ToleranceKind,
)
from financeos.web.chrome import nav_of, provenance_of
from financeos.web.dependencies import Store
from financeos.web.preview import build_environment

router = APIRouter()


@router.get("/strategies", response_class=HTMLResponse, include_in_schema=False)
def strategies_list(con: Store) -> HTMLResponse:
    """Every Strategy, with its currently-frozen version's `change_note`."""
    strategies = list_strategies(con)
    context = {
        "static": "/static",
        "title": "Strategie",
        "page_title": "Strategie",
        "page_kicker": "Dichiarare",
        "page_lede": (
            "La strategia è un oggetto di primo livello, congelato: ogni rilievo è misurato "
            "contro una versione specifica, mai contro quella corrente."
        ),
        "provenance": provenance_of(latest_actual_run(con)),
        "nav": nav_of("strategies"),
        "strategies": strategies,
    }
    template = build_environment().get_template("strategies.html")
    return HTMLResponse(template.render(**context))


@router.get("/strategies/{strategy_id}", response_class=HTMLResponse, include_in_schema=False)
def strategy_detail(strategy_id: str, con: Store, error: str | None = None) -> HTMLResponse:
    """One Strategy's currently-frozen version, and the form that freezes the next one."""
    detail = get_strategy_detail(con, strategy_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Strategia non trovata.")

    context = {
        "static": "/static",
        "title": detail.name,
        "page_title": detail.name,
        "page_kicker": "Dichiarare",
        "page_lede": (
            "Il documento congelato: target, tolleranze e regole. Ogni modifica congela una "
            "nuova versione — non ne esiste una modificabile in-place — e richiede una nota di "
            "modifica."
        ),
        "provenance": provenance_of(latest_actual_run(con)),
        "nav": nav_of("strategies"),
        "s": detail,
        "catalog": rule_catalog_kinds(),
        "error": error,
    }
    template = build_environment().get_template("strategy_detail.html")
    return HTMLResponse(template.render(**context))


@router.post("/strategies/{strategy_id}", include_in_schema=False)
async def freeze(strategy_id: str, con: Store, request: Request) -> RedirectResponse:
    """`DefineStrategy`: freeze a new version built from the edit form (RFC-0007 §7).

    Reads the raw form rather than declaring `Form(...)` parameters one by one: the number of
    target nodes and Rules varies per Strategy, so the field set is inherently dynamic. Every
    domain invariant (I-13 children sum to one, ADR-0018 tolerance shape, I-4 at least one Rule,
    the `change_note` length) is enforced by constructing the real Pydantic aggregates below —
    this route adds no separate validation of its own, so it cannot drift from what the domain
    actually requires.
    """
    detail = get_strategy_detail(con, strategy_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Strategia non trovata.")

    form = await request.form()
    change_note = str(form.get("change_note", "")).strip()
    id_gen = UUIDv7IdGen()

    try:
        definition = StrategyDefinition(
            name=detail.name,
            description=detail.description,
            objective=detail.objective,
            horizon=Horizon(years=detail.horizon_years, target_date=None)
            if detail.horizon_years
            else Horizon(years=None, target_date=_parse_date(detail.horizon_target_date)),
            risk=RiskProfile(level=RiskLevel(detail.risk_level), principles=detail.principles),
            targets=_rebuild_targets(detail, form),
            rules=_rebuild_rules(detail, form, id_gen),
        )
        uow = DuckDBUnitOfWork(con)
        freeze_strategy(
            uow,
            id_gen,
            SystemClock(),
            StrategyId(UUID(strategy_id)),
            definition,
            change_note,
        )
    except (ValidationError, ValueError, InvalidOperation) as exc:
        return RedirectResponse(
            url=f"/strategies/{strategy_id}?error={_short(exc)}", status_code=303
        )

    return RedirectResponse(url=f"/strategies/{strategy_id}", status_code=303)


def _short(exc: Exception) -> str:
    """A one-line, URL-safe error summary — the raw exception text may contain `&`/`#`."""
    text = str(exc).splitlines()[0][:180]
    return text.replace("&", "e").replace("#", "n.").replace("\n", " ")


def _parse_date(value: str | None) -> Any:
    from datetime import date

    return date.fromisoformat(value) if value else None


def _rebuild_targets(detail: StrategyDetail, form: Any) -> TargetAllocation:
    """The edited depth-1/2 tree: every existing node's weight/tolerance, plus one new leaf."""
    children = [
        _rebuild_node(node, path=str(index), form=form) for index, node in enumerate(detail.targets)
    ]
    new_key = str(form.get("new_target_key", "")).strip()
    if new_key:
        children.append(
            TargetNode(
                key=new_key,
                weight=Weight(value=_decimal(form.get("new_target_weight"))),
                tolerance=Tolerance(
                    kind=ToleranceKind(str(form.get("new_target_tol_kind", "ABSOLUTE"))),
                    band=_decimal(form.get("new_target_tol_band")),
                ),
                children=(),
            )
        )
    return TargetAllocation(children=tuple(children))


def _rebuild_node(node: TargetNodeView, *, path: str, form: Any) -> TargetNode:
    weight_raw = form.get(f"target_weight_{path}")
    weight = _decimal(weight_raw) if weight_raw not in (None, "") else node.weight
    if node.is_leaf:
        # A leaf always carries a Tolerance (ADR-0018) — the frozen version this was read from
        # could not have been constructed otherwise, so the fallback is never actually None.
        assert node.tolerance_kind is not None
        assert node.tolerance_band is not None
        kind_raw = form.get(f"target_tol_kind_{path}")
        band_raw = form.get(f"target_tol_band_{path}")
        tolerance = Tolerance(
            kind=ToleranceKind(str(kind_raw)) if kind_raw else ToleranceKind(node.tolerance_kind),
            band=_decimal(band_raw) if band_raw not in (None, "") else node.tolerance_band,
        )
        return TargetNode(
            key=node.key, weight=Weight(value=weight), tolerance=tolerance, children=()
        )
    return TargetNode(
        key=node.key,
        weight=Weight(value=weight),
        tolerance=None,
        children=tuple(
            _rebuild_node(child, path=f"{path}_{j}", form=form)
            for j, child in enumerate(node.children)
        ),
    )


def _decimal(raw: Any) -> Decimal:
    return Decimal(str(raw))


def _rebuild_condition(view: RuleView, form: Any) -> LeafCondition:
    """Re-validate an existing Rule's edited params against the catalog before freezing.

    Drives off `ConditionKindSpec.params_model` (ADR-0014) rather than a hand-copied field
    list, exactly like `rule_catalog_kinds()` already does for the "add a new Rule" picklist.
    A field left blank in the form falls back to the value already frozen on `view` — same
    per-field-optional convention `_rebuild_node` uses for weight/tolerance — so the existing
    test form (which sends no `rule_param_*` fields at all) still carries params forward
    unchanged. The kind itself is never re-derived from the form: changing it is out of scope
    (module docstring "Scope").
    """
    existing = dict(view.params)
    try:
        spec = REGISTRY.get(view.kind, view.kind_version)
    except UnknownConditionKindError as exc:
        raise ValueError(
            f"La regola «{view.name}» usa un tipo di condizione non più nel catalogo."
        ) from exc

    raw: dict[str, str] = {}
    for name in spec.params_model.model_fields:
        posted = form.get(f"rule_param_{view.id}_{name}")
        raw[name] = str(posted) if posted not in (None, "") else existing.get(name, "")

    try:
        validated = spec.params_model.model_validate(raw)
    except ValidationError as exc:
        detail = exc.errors()[0]
        field = ".".join(str(part) for part in detail["loc"]) or "?"
        raise ValueError(
            f"Parametro «{field}» non valido per la regola «{view.name}»: {detail['msg']}."
        ) from exc

    params = {
        name: canonical_decimal(value) if isinstance(value, Decimal) else str(value)
        for name, value in validated.model_dump().items()
    }
    return LeafCondition(kind=view.kind, kind_version=view.kind_version, params=params)


def _rebuild_rules(detail: StrategyDetail, form: Any, id_gen: UUIDv7IdGen) -> tuple[Rule, ...]:
    """Every existing Rule with its metadata edited in place, plus at most one new Rule.

    A Rule's `id` and condition `kind`/`kind_version` are carried forward unchanged (§
    docstring "Scope"): `enabled`, `priority`, `suggestion_class`, `message` and the
    condition's own params are editable on an existing Rule, keyed by its stable `RuleId` so
    a reordering in the form cannot silently attach one Rule's edits to another.
    """
    ids = form.getlist("rule_id")
    enabled = form.getlist("rule_enabled")
    priorities = form.getlist("rule_priority")
    suggestion_classes = form.getlist("rule_suggestion_class")
    messages = form.getlist("rule_message")
    edits = {
        str(rule_id): (en, pr, sc, msg)
        for rule_id, en, pr, sc, msg in zip(
            ids, enabled, priorities, suggestion_classes, messages, strict=False
        )
    }

    rules: list[Rule] = []
    for view in detail.rules:
        edit = edits.get(view.id)
        en, pr, sc, msg = (
            edit
            if edit is not None
            else ("true", view.priority, view.suggestion_class or "NO_ACTION", view.message)
        )
        rules.append(
            Rule(
                id=RuleId(UUID(view.id)),
                name=view.name,
                enabled=(en == "true"),
                priority=Priority(pr),
                suggestion_class=SuggestionClass(sc),
                message=msg,
                condition=_rebuild_condition(view, form),
            )
        )

    new_kind = str(form.get("new_rule_kind", "")).strip()
    if new_kind:
        params: dict[str, str] = {}
        for slot in range(1, 4):
            key = str(form.get(f"new_rule_param_key_{slot}", "")).strip()
            value = str(form.get(f"new_rule_param_value_{slot}", "")).strip()
            if key:
                params[key] = value
        rules.append(
            Rule(
                id=RuleId(id_gen()),
                name=str(form.get("new_rule_name", new_kind)),
                enabled=True,
                priority=Priority(str(form.get("new_rule_priority", "MEDIUM"))),
                suggestion_class=SuggestionClass(
                    str(form.get("new_rule_suggestion_class", "NO_ACTION"))
                ),
                message=str(form.get("new_rule_message", "")),
                condition=LeafCondition(
                    kind=new_kind,
                    kind_version=int(form.get("new_rule_kind_version", 1) or 1),
                    params=params,
                ),
            )
        )
    return tuple(rules)
