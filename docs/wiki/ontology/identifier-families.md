# Identifier families — what each means, and where its registry lives

Point-in-time map, base commit `2dd7346`. Machine-readable form: `../semantic/identifiers.yaml`.

You will meet these numbers in code comments, docstrings, commit messages and ADR prose.
**Cite the number; do not paraphrase.**

## Quick routing table

| Family | Range | Registry (normative) | Enforced by |
|---|---|---|---|
| **I-** | I-1 … **I-22** | `docs/seed/rfcs/RFC-0000-index.md` §6 (**stale — see below**) | model validators, repositories, import-linter, property tests |
| **C-** | C1 … C6 | `pyproject.toml` `[tool.importlinter]` + `tests/` | `uv run lint-imports`; `pytest` for C4-positive and C6 |
| **P-** | P1 … P33 | **split across three files** — see below | convention + review; a few have code consequences |
| **ADR-** | ADR-0001 … ADR-0036 | the **owning RFC's Appendix A**; cumulative index in RFC-0010 v0.2 Appendix A | n/a (decisions) |
| **ADR-L** | ADR-L01 … ADR-L08 | `docs/plans/adr/` | n/a (decisions) |
| **ERR-** | ERR-1 … ERR-15 | RFC-0011 §2 (1–10), RFC-0012 §2 (11–15) | n/a (corrections) |
| **E-** | E1 … E11 (+ E12–E14) | RFC-0010 v0.2 §5 (was RFC-0011 §6) | product ratification |
| **R-** | R-1 … R-3 | RFC-0011 §4 | n/a (resolutions) |
| **L05 §** | — | `docs/plans/L05-italian-label-registry.md` | `core/shared/labels.py`, tests |
| **W-** | W1 … W10 | `adapters/duckdb/repositories/operation.py` + tests | `tests/test_operation_repository_invariants.py` |

---

## I — Invariants

**Range is I-1 … I-22, not I-1 … I-18.**

`RFC-0000-index.md` §6 holds the original **I-1 … I-18** table, and `CLAUDE.md` quotes that range.
But **RFC-0012 §4 added I-19 … I-22 and restated I-14**, and RFC-0000 was never updated on disk.

This is a genuine, known staleness in the corpus, resolved by the corpus's own precedence rule: per
**RFC-0012 §8**, precedence is **section-scoped and recency-ordered**, so RFC-0012 §4 wins for the
invariant registry. Do not "fix" RFC-0000 — `docs/seed/` is frozen and never edited in place.

Defined in RFC-0004 §6.1 (inherited from RFC-0003) and §6.2 (added by RFC-0004), plus RFC-0012 §4.

The ones you will actually meet, and what they are enforced by:

| ID | Statement | Enforced by |
|---|---|---|
| **I-3** | A Bucket is governed by exactly one Strategy | `bucket.strategy_id` non-nullable (**ERR-9**) |
| **I-4** | A Strategy contains at least one Rule | `StrategyDefinition._at_least_one_rule` |
| **I-5** | Every Recommendation derives from a Rule | `Provenance.rule_id`/`run_id` non-nullable — **structural** |
| **I-6** | Every Alert is explainable | `Alert._is_explainable` + the `TraceRecorder` design |
| **I-7** | No engine writes to storage | import-linter **C2** |
| **I-9** | Σ apportioned ≤ Holding — **reportable, not rejectable** | the `over_apportioned` kind (revised by **ADR-0025**) |
| **I-10** | Operations append-only; corrections compensate | **C6** tests + repository shape (**W10**) |
| **I-11** | Every Alert pins (strategy, version, rule) + inputs | `evaluation_run.strategy_version_id` FK (**ERR-6**) |
| **I-12** | A Recommendation is never prescriptive | **structural** — no such field exists (**E7**) |
| **I-13** | Children of every target node sum to 1 within an epsilon | `_check_sum_to_one` in the constructor (**ERR-5**) |
| **I-14** | Targets keyed by AssetClass, never AssetId | `TargetNode.key` type (rescoped by **ERR-14**) |
| **I-15** | Money arithmetic requires the same currency | `CurrencyMismatchError` |
| **I-16** | Snapshot / IndicatorReading immutable | frozen models; write-once rows |
| **I-17** | A Recommendation cannot reference a Decision | absence of the field |
| **I-19 … I-22** | classification-axis and candidate-lineage invariants | **not implemented** — see [`gaps-specified-not-built.md`](gaps-specified-not-built.md) |

Full statements and per-invariant notes: `../semantic/identifiers.yaml`, `family: I`.

Three notes worth carrying:

- **I-9 warns, never blocks.** The revision from a rejection rule to an evaluation-time finding is
  **ADR-0025**. Over-apportionment is reportable.
- **I-12 and I-5 are structural, not validated.** There is no check to bypass, because there is no
  field to populate and no constructor path to take. That is the point.
- **ERR-14 rescoped I-14.** `over_apportioned` keys facts by `AssetId` and that is *not* a violation:
  I-14 governs the **target tree**, not every condition.

---

## C — Architecture contracts

C1–C5 are **import-linter contracts** in `pyproject.toml`. C6 is **tests only**.

| ID | Contract | Type |
|---|---|---|
| **C1** | Core purity — no adapters/web/app/duckdb/fastapi/pandas/polars/HTTP in `core` | forbidden |
| **C2** | `core.engines` may not import `financeos.ports` (**I-7** made structural) | forbidden |
| **C3** | The five bounded contexts are mutually independent | **independence** |
| **C4** | `app` may not import `adapters.duckdb.queries`; only `web` may | forbidden + test |
| **C5** | No egress (`httpx`, `httpx2`, `requests`) in `core` or `app` | forbidden |
| **C6** | No `UPDATE`/`DELETE` on append-only tables | **test only** |

```bash
uv run lint-imports    # C1-C5
uv run pytest tests/test_c4_read_write_split.py tests/test_c6_append_only.py -q
```

Two details that trip people:

- **C5 lists `httpx2`** because that is the real module name
  `adapters/market/http_price_provider.py` imports (`import httpx2 as httpx`). import-linter matches
  the *imported module*, not the alias, so a contract naming only `httpx` would not see the one HTTP
  client this project ships.
- **C6's table list is itself pinned** by `test_append_only_table_list_matches_migration_001`. Adding
  an append-only table without registering it fails the suite — deliberately.

`C3` is the one with the most day-to-day consequences; see [`bounded-contexts.md`](bounded-contexts.md).

---

## P — Product-owner ratifications

**Split across three files**, which is the most common reason a `grep` for a P-number fails:

| Range | File |
|---|---|
| P1 … P15 | `docs/handoff/HANDOFF-2026-07-26.md` |
| P16 … P20 | `docs/handoff/HANDOFF-2026-07-28.md` §2.1 |
| P21 … P33 | `docs/plans/RATIFICATIONS-2026-07-30.md` |

To search all of them at once:

```bash
grep -rn '| P29 |' docs/handoff/ docs/plans/
```

> These are **ratified decisions, not implementer defaults.** Cite the number wherever the wording or
> the scale is quoted.
>
> **Product-definition questions go to the product owner. An agent never invents one.** If a
> behaviour is undecided, the answer is to ask — not to pick a plausible default and ship it.

The ones with code consequences: **P14** (decimals stored with a dot, localized in the view),
**P17–P19**, **P21–P28** (Italian copy and the L05 label machinery), **P29–P30**
(`over_apportioned` per-scope; `untargeted_allocation` threshold rejected at import), **P31–P33**
(`RiskLevel` as the 1–7 SRRI/SRI scale; no computed risk level in V1.0).

Full list: `../semantic/identifiers.yaml`, `family: P`.

---

## ADR vs ADR-L — two separate series

Do not merge the numbering.

**Corpus ADRs `ADR-0001` … `ADR-0036`** live inside their **owning RFC's Appendix A**. There is no
single ADR directory. Ownership by range:

| RFC | ADRs |
|---|---|
| RFC-0004 | 0001, 0002, 0003 |
| RFC-0005 | 0005 – 0010 |
| RFC-0006 | 0014, 0015, 0016 |
| RFC-0007 | 0017 – 0020 |
| RFC-0008 | 0021, 0022, 0023 |
| RFC-0009 | 0004, 0011, 0012, 0013 |
| RFC-0010 v0.2 | 0024, 0032 |
| RFC-0011 | 0025 – 0031 |
| RFC-0012 | 0033 – 0036 |

No gaps — all 36 exist. The **current cumulative index** is RFC-0010 v0.2 Appendix A (per
RFC-0012 §8); RFC-0000 §5 is a summary by range; RFC-0011 Appendix A is a historical snapshot
through 0031.

**Local ADRs `ADR-L01` … `ADR-L08`** live in `docs/plans/adr/` and **resolve build blockers** the
frozen corpus does not decide. They may override a corpus ADR's clause where the corpus is silent or
wrong in practice — cite both when they do, e.g.
`feat(rules): over_apportioned v1 (ADR-L04 §4.1-§4.4, overrides ADR-0025's severity clause)`.

| ID | Subject | Touches |
|---|---|---|
| **ADR-L01** | `operation` link-flag truth table | `Operation` validator + `001_init.sql` CHECKs |
| **ADR-L02** | severity declarations for three kinds | `SeverityDeclaration` |
| **ADR-L03** | ECharts vendored; Italian copy / English code | `web/`, all copy |
| **ADR-L04** | `over_apportioned` severity under the uniform anchor | `ApportionmentLine`'s own validator (§4.4 D5) |
| **ADR-L05** | `untargeted_allocation` reduction over classes | `FACT_TARGETS` existing separately (§5) |
| **ADR-L06** | rule scope gating | `RuleScopeGate`, `evaluate_strategy`, `HETEROGENEOUS_STRATEGIES` |
| **ADR-L07** | `zero_portfolio_value` also gates `allocation` | `FACT_ALLOCATION`, `evaluate_strategy.py` |
| **ADR-L08** | `/dashboard` landing page, alongside `/` | `web/routes/dashboard.py` |

---

## ERR — Errata

Corrections to the corpus, `ERR-1` … `ERR-15`, no gaps. `ERR-1`–`ERR-10` in **RFC-0011 §2**;
`ERR-11`–`ERR-15` in **RFC-0012 §2**.

The ones whose effects you will see in code:

| ID | Effect |
|---|---|
| **ERR-1** | promoted `severity` to a real `alert` column (without it `mv_finding` cannot run) |
| **ERR-2** | added `scope_kind` / `scope_id` to `evaluation_run` |
| **ERR-4** | removed a phantom `prices` fact from `bucket_below_target_value` |
| **ERR-5** | annotated I-13 / `TargetAllocation` as superseded by **ADR-0017** |
| **ERR-6** | moved the I-11 pin to `EvaluationRun` (was `Alert.strategyVersion`) |
| **ERR-8** | supplied the missing DDL for portfolio, account, bucket, strategy, strategy_version |
| **ERR-9** | fixed the disagreeing `Bucket` field lists |
| **ERR-10** | made `default_max_staleness` a declared schema-level default |
| **ERR-14** | **rescoped I-14's "no AssetId" claim** to target/drift conditions |
| **ERR-15** | **replaced the precedence rule** — see governance below |

Full list: `../semantic/identifiers.yaml`, `family: ERR`.

---

## E — Extension and ratification queue

Extensions **beyond the source corpus**, requiring product-track ratification. `E1` … `E11`, plus
`E12`–`E14` added by RFC-0012 §5.

The authoritative queue moved: **RFC-0010 v0.2 §5** is the current location (integrating RFC-0011
§6, which was authoritative before). RFC-0000 §7 carries a non-authoritative summary.

Almost all of E1–E11 are **implemented** — they are why the code has entities RFC-0004 does not
mention: `EvaluationRun` (**E4**), `Alert`-as-evaluation-record (**E5**), `SuggestionClass` as a
closed enum (**E7**), the seven-member `OperationType` (**E10**), Market owning prices (**E11**), the
Decision context itself (**E1**).

**E9** (Goal vs `Strategy.objective`) is the notable exception — escalated from V2 to **V1.1** by
RFC-0012 §5 / **ADR-0036**, and not built. **E12**–**E14** are not built.

---

## Governance rules over all of the above

**The corpus outranks the code.** `docs/seed/rfcs/` is the specification; when it and the code
disagree, **the code is wrong**. Read the relevant section before changing behaviour and cite it in
the commit.

**RFCs are never edited in place.** A correction is a **new amending document** plus a row in
`RFC-0000-index.md` §4 (which is the practical lookup table of what corrects what).
`docs/seed/` is read-only.

**Precedence is section-scoped and recency-ordered** (**RFC-0012 §8**), **not** document-scoped.

> RFC-0011 originally claimed "this document wins". **ERR-15** found that self-contradictory once
> RFC-0010 v0.2 began absorbing RFC-0011 §5/§6, and replaced it. The corpus documents its own
> governance bug and fixes it in-band.
>
> Practical consequence: to resolve a conflict, find the **latest document that speaks to that
> section**, not the latest document overall.

**`docs/seed/ux/UX-0001-ui-reference.md` is non-normative.** If the mock drifts from the corpus,
**the corpus wins**. Same for `docs/seed/ux/finance-os-ui-mock.html`.

**`docs/handoff/HANDOFF-<date>.md` is the session ledger.** Read the most recent before resuming
work: it records what is unreviewed, what is deliberately unfinished, and what looks like a bug but
isn't.
