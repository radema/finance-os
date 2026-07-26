# Finance OS — v1 Prototype Execution Plan

## Context

`/root/finance-os` is a **pure-spec seed**: `docs/` only — no git, no Python project, no code.
The RFC corpus (`docs/seed/rfcs/`, RFC-0011 wins conflicts; RFC-0012 adds classification/
measurement/goals) plus the UX reference (`docs/seed/ux/UX-0001-ui-reference.md` +
`finance-os-ui-mock.html`) fully specify the product. Goal: build a **working v1 prototype** of
the roadmap in RFC-0010 — the Walking Skeleton (spine + replay contract), then the first
genuinely useful release (V1.0: strategy compliance + Net Worth).

The product is a **Decision Support System** (not a tracker): its differentiator is that it knows
your strategy and produces **explainable, reconstructable** findings (Manifest P3/P7). The single
non-negotiable technical property is the **trace-replay contract**: every finding replays from its
stored trace, byte-for-byte. If that test can't be maintained, the product's core promise is gone
(RFC-0010 §6.2).

## Stack (decided in RFCs — not up for redesign)

- Python 3.12+, `Decimal` in core (no float feeds evaluation). Pydantic v2 frozen models.
- DuckDB single file; forward-only numbered SQL migrations + `schema_version`; no ORM.
- FastAPI + Jinja2 + HTMX; one process, no npm/build step. **Charts: ECharts** (vendored static,
  Local-First — supersedes the mock's CSS bars; RFC left chart lib open with no dependency).
- `uv` packaging; `financeos` console script. ruff + mypy strict + **import-linter (C1–C6)** +
  Hypothesis property tests + golden-file tests.
- Fonts: IBM Plex Sans/Mono/Serif ("three voices"), **vendored** static (no CDN).

## Resolved decisions (user-confirmed)

1. **Scope endpoint** — **S + V1.0**. V1.1–V1.3 sketched only, out of scope for this engagement.
2. **UI language** — **Italian for all user-facing copy** (chrome, labels, observations, assembled
   rationale); **English for code objects, identifiers, components, module/class/function names**.
   i.e. `SuggestionClass.REVIEW_ALLOCATION` (code, English) renders as Italian text in the UI.
3. **Ratifications E1/E5/E7/E10** — **ratified, all four** (RFC-0011 §6). E1 = 9th `Decision`
   bounded context (only hard skeleton blocker); E5 = Alert as full evaluation record; E7 = closed
   `SuggestionClass` enum; E10 = 7 OperationTypes.
4. **Method** — **direct orchestration** (RFCs are the spec). This plan is mirrored to the repo at
   `docs/plans/` on execution start (also kept in the plan-mode file).

Technical build-blockers resolved by the **Opus advisor** (not user) before migration 001 freezes:
the §8.3 `corrects_id` × `transfer_pair_id` × `cash_leg_of` truth table (new ADR), the **three
missing `severity` declarations** (`unassigned_residual_above`, `allocation_absent`,
`bucket_below_target_value` — registry completeness test fails the build without them), and a
one-line chart-lib/UI-language ADR.

**First post-approval action:** add `AskUserQuestion` and `ExitPlanMode` to the
`.claude/agents/orchestrator` agent toolset (per user request).

---

## The Team (model-routed for cost)

| Agent | Model | Role |
|---|---|---|
| **orchestrator** (main) | Sonnet | Dispatch, synthesis, gates, user comms. Holds no bulk artifacts. |
| **Explore** | (own) | Read-only context mining. Already used for planning. |
| **advisor / Plan** | **Opus** | Design-blockers: §8.3 truth-table ADR, severity formulas, target-tree edge cases. |
| **back-end implementer** | **Opus** core / Sonnet plumbing | Domain VOs, the 4 engines, `Bound`/`TraceRecorder`/step algebra + replay test (Opus, correctness-critical); ports, app use cases, DuckDB adapters, migration 001, repositories, importers, CLI, fixtures (Sonnet, clear contracts). |
| **front-end implementer** (`impl-fe`) | Sonnet skeleton / **Opus** design-heavy | Web (FastAPI+Jinja+HTMX), the 7 screens, ECharts, CSS system. Drives the **impeccable** skill (Operate mode) + `impeccable-asset-producer` for vendored assets; `impeccable-finish-reviewer` runs the FE design-finish pass at phase close. |
| **minion** | Haiku | Scaffolding, config, boilerplate DDL typing, font/lib vendoring, WORKLOG. |
| **reviewer** (`code-reviewer`) | **Opus** | The single standing review gate — one adversarial correctness+quality review at each phase close (KISS/YAGNI folded in; `code-simplifier` available ad-hoc only, not a standing gate). |

Concurrency ≤ 4 named teammates; one-shot work goes to anonymous subagents. Independent waves
dispatched in parallel. Leaves never sub-delegate.

---

## Wave 0 — Preflight (design-blockers + scaffold)

Parallel:
- **Opus advisor**: resolve §8.3 truth table (→ new ADR in `docs/plans/adr/`), the three
  `severity` formulas, chart-lib + UI-language ADR. Blocks migration 001.
- **minion**: `git init` (branch `main`, then work on `build/skeleton`); `uv` project scaffold —
  `pyproject.toml`, dir tree per RFC-0005 §4 (`src/financeos/{core,ports,app,adapters,web}`,
  `tests/`), ruff/mypy/import-linter configs (C1–C6 contracts), `.gitignore`, empty package inits.
  Mirror this plan → `docs/plans/`.

**verify:** `uv sync` succeeds; `uv run ruff .` and import-linter run clean on empty scaffold.

## Wave 1 — Walking Skeleton (S)  → FIRST VISUALIZABLE DELIVERABLE

Build order per RFC-0005 §8 (pure Python steps 1–9 first, where the contract is won).

- **1a — core (back-end impl, Opus):** `core.shared` VOs (Money/Quantity/Weight/Percentage/ids/
  errors) + frozen domain models for the 8 skeleton aggregates (Asset, Operation, Portfolio,
  Bucket + derived VirtualHolding, Strategy/StrategyVersion, Alert, Recommendation, EvaluationRun).
- **1b — engines (back-end impl, Opus):** portfolio_engine (fold → Holding → AllocationBreakdown),
  strategy_engine (drift/severity, depth-1 tree), rule_engine (`Bound`, `TraceRecorder`, Decimal
  step algebra, `drift_outside_tolerance` v1 kind, registry + **completeness test**),
  decision_engine (`materialize`). **The Hypothesis replay property test lands here (task 8).**
- **1c — plumbing (back-end impl, Sonnet):** ports (Protocols); app use cases (unit_of_work,
  import_operations, apportion_bucket, import_strategy, evaluate_strategy); DuckDB adapter
  (connection, `001_init.sql` incorporating ERR-1/2/8/9 + ADR-0025/26/27/28/31, `mode` column),
  repositories (8 aggregates), read queries (`mv_holding`, `mv_finding` as views from day one);
  CSV ops + YAML strategy importers; `seed demo` + `demo/expected/` golden fixtures; CLI
  (`seed`, `import-operations`, `import-strategy`, `evaluate`, `serve`).
- **1d — web (front-end impl, Sonnet + impeccable):** 3 views — Findings list (via `mv_finding`),
  `/recommendations/{id}` 9-block explanation surface (trace ladder, sticky provenance bar,
  outcome chips), `/allocation` (flat, Net Worth, ECharts). Vendor IBM Plex + ECharts. CSS
  design system extracted from the mock (§5.1 hard requirements; §5.2 free to restyle).
  Italian copy, English code identifiers.

1a→1b sequential (engines need VOs); 1c can start ports/DDL in parallel with 1b; 1d after 1c.

**Gate (done-when, RFC-0005 §8.3):** from clean checkout,
`uv run financeos seed demo && evaluate && serve` renders **exactly one** Recommendation
("Equity/Developed is 6.0% below target of 40.0%…"), trace click shows pinned version/rule/bindings/
steps, **every number matches `demo/expected/`**. Then the **Opus reviewer** + FE
**impeccable-finish-reviewer** pass. → **User eyeball checkpoint.**

## Wave 2 — V1.0 (first useful release; only after skeleton is green)

Opening batch: apply E5/E7/E10 + the three severity declarations.
Then parallel:
- **2a — ingestion/market (back-end impl, Sonnet):** broker-CSV importers; `HttpPriceProvider`
  (EOD, on-demand) + `SeedFilePriceProvider`; TRANSFER_IN/OUT/CORRECTION (7 OperationTypes);
  `price` bitemporal + `price_latest()`/`price_as_known_at()` + `PriceView`; **Cash-as-Asset
  (CASH class) → Net Worth without Cash Flow**; Account reference entity + `cash_asset_id` +
  paired cash-leg writer (ADR-0026).
- **2b — rules/portfolio (back-end impl, Opus):** catalog — `allocation_absent`,
  `untargeted_allocation`, `unassigned_residual_above`, `bucket_below_target_value`,
  `over_apportioned`; multiple Assets/Buckets, apportionment, signed `UNASSIGNED` residual;
  `mode='ACTUAL'` read predicate everywhere; `Snapshot` on every evaluate + drift-over-time.
- **2c — web (front-end impl, Opus + impeccable):** screens 4 Buckets/apportionment, 5 Operations,
  7 Run health (build early — makes broken config visible), 6 Strategy authoring last (target tree
  editor depth 1–2, tolerances, rule editor); Allocation + Net Worth + drift-over-time **ECharts**;
  Reconcile block. `financeos export --authored` before any migration 002.

**Gate:** V1.0 done-when (import real holdings, author real Strategy, findings are recognizably
true) + Opus reviewer + impeccable-finish-reviewer.

## Out of scope (sketched only)

V1.1 (Cash Flow, Decision loop, Goal object; E9 blocks it), V1.2 (risk/classification axes,
bonds, integrity hash chain), V1.3 (valuation/return series, drawdown/vol/sharpe). Sequenced in
RFC-0010 §3; not built in this engagement.

---

## Verification (end-to-end)

- **Contract tests:** import-linter C1–C6 green; mypy strict clean; ruff clean.
- **Replay property test (Hypothesis):** the non-negotiable — every finding replays from trace.
- **Golden-file:** `seed demo && evaluate` output matches `demo/expected/`.
- **Manual eyeball:** `uv run financeos serve` → localhost, walk Findings → Recommendation →
  trace → StrategyVersion → change_note; verify provenance bar + tolerance rail render.
- **Registry completeness test:** every `condition_kind` declares params/evaluator/template/
  required_facts/severity — build fails otherwise.

## Git / branches

`git init`; work on `build/skeleton`, then `build/v1.0`. Leaf implementers work in worktrees,
commit to their branches; orchestrator reports branch names and merge order (skeleton → v1.0),
never force-pushes, never pushes to `main` without confirmation.
