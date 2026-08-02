# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Finance OS — a local-first, offline personal-finance **decision support** system. It never advises;
it explains. Every alert must be replayable back to the numbers that produced it (I-6), and no output
may be phrased as an instruction (I-12).

The code is a build against a **frozen document corpus**. `docs/seed/rfcs/` is the specification and it
outranks the code: when they disagree, the code is wrong. Read the relevant RFC section before changing
behaviour, and cite it in the commit.

## Commands

All Python tooling goes through `uv run`. No bare `pytest` / `python` / `ruff`.

```bash
uv run pytest -q                          # full suite
uv run pytest tests/test_rule_engine.py -q          # one file
uv run pytest tests/test_rule_engine.py::test_name  # one test
uv run ruff check src tests               # NOT `ruff check .` — that descends into .claude/worktrees/
uv run mypy                               # strict, files = src + tests
uv run lint-imports                       # C1-C5 architecture contracts
node docs/design/audit_offline.mjs        # design-token / offline-asset audit
```

CLI (`financeos = financeos.cli:app`):

```bash
uv run financeos seed demo                # wipe + load demo/ fixture into DuckDB
uv run financeos evaluate                 # run the Strategy/Rule pipeline, materialize Recommendations
uv run financeos export --authored        # the ONLY recovery path for authored data (see below)
uv run financeos serve                    # FastAPI on 127.0.0.1 only (ADR-0008)
```

**The full gate** — run all of it before merging anything: ruff + mypy + lint-imports + pytest +
`seed demo && evaluate` + `audit_offline.mjs`. The demo run is part of the gate, not a smoke test: it
asserts exact expected numbers (`demo/expected/`).

## Architecture

Hexagonal on the **write** side, dataflow SQL on the **read** side — two shapes over one DuckDB file
(RFC-0005 §2). `src/financeos/`:

- `core/` — pure domain. Zero I/O, zero framework, `Decimal` only (float is banned). Five bounded
  contexts as sibling packages (`cashflow`, `portfolio`, `strategy`, `market`, `decision`) that may not
  import each other; `core/shared/` is the only shared vocabulary.
- `core/engines/` — pure functions, no ports injected. **No engine calls another engine.** Composition
  happens exactly one place: an `app/` use case.
- `ports/` — protocols, a *sibling* of core rather than inside it, to keep the graph acyclic.
- `app/` — use cases; the only layer that holds ports and owns transactions (`unit_of_work.py`).
- `adapters/` — DuckDB (hand-written SQL, no ORM; forward-only numbered migrations), importers,
  exporters, clock/id-gen (`system.py`).
- `adapters/duckdb/queries/` — the read side. Named SQL modules returning non-domain DTOs, importable
  **only** by `web/`. Never inline SQL in a route.
- `web/` — FastAPI + Jinja + htmx. Vendored assets only, no CDN.

These are enforced, not aspirational: C1–C5 are import-linter contracts in `pyproject.toml`; C4's
positive half and C6 (no UPDATE/DELETE on append-only tables) are real tests
(`tests/test_c4_read_write_split.py`, `tests/test_c6_append_only.py`).

### The engines

- **Rule engine** — a *closed typed catalog* of rule kinds (ADR-0014), not an expression language. Each
  kind declares params, `required_facts`, evaluator, explanation template, severity. Composition depth
  is exactly 1 (`all_of|any_of|not` over flat leaves). Facts arrive fully materialized as a frozen
  `FactSet` of `Bound[T]`; **the rule engine performs no financial computation** — a new fact must carry
  something another engine already computed.
- **Traces are accumulated, not emitted.** A recorder is threaded through evaluation; there is no
  untraced arithmetic path. The step algebra is 15 Decimal ops — adding one requires an ADR.
- **Four outcomes**: FIRED / NOT_FIRED / SKIPPED / ERROR. `SKIPPED != NOT_FIRED` (ADR-0016); SKIPPED and
  ERROR feed the run-health panel.
- **Severity** is a dimensionless breach ratio, anchored so `severity == 1` sits exactly at each kind's
  own firing threshold and rises monotonically. `severity = null` is a real semantic (the kind cannot
  express urgency), which is why ordering uses `NULLS LAST`.
- **Decision engine** is pure: every FIRED firing becomes exactly one immutable Recommendation.
  Deduplication is read-side (`mv_finding`) keyed on
  `finding_key = sha256(rule_id ‖ scope_id ‖ canonical(condition.params))`. Any resolution or dedup
  logic keying on *less* than the full `finding_key` silently hides live findings — this bug has
  already shipped once.
- Determinism is a gate: `(priority DESC, rule_id ASC)`, an `input_digest` over canonical facts, and a
  byte-identical re-run verified by a trace-replay property test.

### Data: authored vs derivable

Derivable data (Operations, prices, readings) can be re-imported from raws. **Authored data**
(apportionment, Strategies/Rules, asset classifications) has no other recovery path than
`financeos export --authored`. Run it after every migration and before every schema change.

Operations are append-only (I-10). Stored traces are **never migrated** — bump `trace_version` and keep
all readers.

## Governance

- **RFCs are never edited in place.** A correction is a new amending document plus a row in
  `docs/seed/rfcs/RFC-0000-index.md` §4. Precedence is section-scoped and recency-ordered (RFC-0012 §8),
  not document-scoped.
- Two ADR series: corpus ADRs 0001–0036 live inside their owning RFC's Appendix A; **local** ADRs
  (`ADR-L01`…) live in `docs/plans/adr/` and resolve build blockers.
- Named identifier families you will meet in code comments and commits — cite the number, don't
  paraphrase: **I-1..I-18** invariants (registry in RFC-0000 §), **C1..C6** architecture contracts,
  **P1..P33** product-owner ratifications (`docs/plans/RATIFICATIONS-2026-07-30.md` and the handoffs),
  **ERR-1..ERR-15** errata, **E1..E11** extension queue.
- `docs/seed/ux/UX-0001` mock is **non-normative**. If it drifts from the corpus, the corpus wins.
- **Product-definition questions go to the product owner. An agent never invents one.**

## Working conventions

- Branches: `main` is untouched; work lands on `build/skeleton`. Never force-push. Worktrees live under
  `.claude/worktrees/` — before trusting any worktree's output, compare its `git log --oneline -1`
  against the main checkout's; a stale base has silently produced good-looking work more than once.
  Use `git -C <path>` rather than a persisted `cd`.
- Commits: conventional, lowercase, scoped, and **citing the authority**, e.g.
  `feat(rules): over_apportioned v1 (ADR-L04 §4.1-§4.4, overrides ADR-0025's severity clause)`.
  Commit once per deliverable; document deviations from the spec in the body.
- Model routing when delegating: **Sonnet implements, Opus reviews.** Every real bug so far was caught
  by the review gate, not by the model that wrote the code.
- `docs/handoff/HANDOFF-<date>.md` is the session ledger — read the most recent one before resuming
  work. It records what is unreviewed, what is deliberately unfinished, and what looks like a bug but
  isn't.

## Copy and UI rules

User-facing copy is **Italian**; identifiers, code, and commits are English (ADR-L03). Impersonal
register (P17), `target` not `obiettivo` (P18), Italian taxonomy prose forms (P19) with short forms on
chart axes (P24) and head-noun capitals (P25). Decimals are stored with a dot and localized in the view
(P14). ECharts and htmx are vendored — no CDN, the app must work offline. Chart colours are declared as
`"token:--name"`, never literals.

## Deliberate behaviours that look like bugs

- Correlated findings are never collapsed — equity-under and bonds-over are shown as two findings.
- Untargeted and unassigned capital stays in the denominator; the resulting scatter of small
  under-allocation findings is the honest reading.
- Over-apportionment (I-9) **warns, never blocks**.
- Mixed governance produces `SKIPPED(heterogeneous_strategies)`, never an average.
- Dismissal is recorded as a `Decision`; nothing is mutated and there is no `dismissed` flag.
- Hypothetical runs persist alerts and traces but produce zero Recommendations.
- Strategy YAML under export is a *derived artifact* — edit via `financeos import-strategy`, which
  freezes a new version.
