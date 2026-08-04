# Specified in the corpus, not built at `2dd7346`

Point-in-time map, base commit `2dd7346`. Machine-readable form: `../semantic/entities.yaml`
(`classification: not_implemented`).

The corpus specifies more than the code implements. A future agent looking for these will grep and
find nothing — **that absence is correct, not a missing migration**. This page exists so nobody
concludes "the schema is broken" or, worse, invents a shape to fill the hole.

Recovering this list is otherwise expensive: it requires reading nine RFCs *and* the whole of
`core/` and diffing them.

---

## `Decision` — the user's act

**Specified:** RFC-0004 §7 (**ADR-0002**), RFC-0008 §7 (incl. §7.1 dismissal, §7.2 `informedBy` may
be empty, §7.3 linking `enactedBy`), **ADR-0022**.
**Implemented:** nothing. No `Decision` class anywhere in `src/`, no `decision` table in
`001_init.sql`.

This is the most surprising gap, because the bounded context is *named* `decision` and does not
contain the entity it is named after. The package holds `Alert`, `Recommendation`, `EvaluationRun`,
`Provenance`, `Snapshot`, `RuleFiring` and the trace schema — all audit artifacts. `Decision`, the
one thing a *user* creates, is absent.

Consequences today:

- **There is no dismissal path at all.** `CLAUDE.md` notes that "dismissal is recorded as a
  `Decision`; nothing is mutated and there is no `dismissed` flag" — the second half is true and
  visible in the schema; the first half is not built.
- **Nothing resolves a finding.** `mv_finding` accumulates occurrences indefinitely; nothing closes
  one.
- **`I-17`** (a Recommendation cannot reference a Decision) is satisfied trivially — there is nothing
  to reference.

> ### When it is built, read the `finding_key` warning first
>
> A `Decision` resolves against a **`finding_key`** — the *full* hash. Keying resolution on less than
> the full key **silently hides live findings**, and **that bug has already shipped once**. See
> [`decision.md`](decision.md#finding_key--the-one-to-be-careful-with) and
> `tests/test_finding_resolution.py::test_editing_rule_params_does_not_resolve_an_unrelated_finding`.
>
> Resolution is the *entire job* of this entity, so this is the one place the mistake is most likely.

Shape when built, per RFC-0008 §7: `informedBy → Recommendation` (may be **empty** — a user may act
without a prompt), `enactedBy → Operation`, and a resolution keyed on `finding_key`.

---

## `Goal` — a first-class objective

**Specified:** RFC-0007 §9, **E9**, **ADR-0030** (Goal links sit *outside* the freeze boundary),
**ADR-0036** (Goal as a first-class object with a revision audit), **ERR-11**, **ERR-12**.
**Implemented:** the **`goal` table exists**, and so does the **`strategy_goal`** link table. No
domain type does.

- **E9** was escalated from **V2 to V1.1** by RFC-0012 §5.
- **ERR-11** supplied the `goal` DDL, which RFC-0011 **ERR-8** had left dangling (`strategy_goal`
  referenced a table with no definition).
- **ERR-12** corrected **ADR-0030**'s claim that Goal state was reconstructable — it is not: `Goal`
  is mutable and unaudited, which is exactly what **ADR-0036**'s revision audit is meant to fix.

Today only `Strategy.objective` — a free-text `str | None` inside the frozen definition — carries
goal-shaped intent. Note the asymmetry that already exists: `objective` is **inside** the freeze
boundary, while `Goal` links are deliberately **outside** it (**ADR-0030**).

---

## `Account` — a reference entity

**Specified:** RFC-0010 §4.1 as amended by **ADR-0026**, DDL by **ERR-8**.
**Implemented:** partially, and this one is genuinely mixed:

| Piece | Exists? |
|---|---|
| `account` table (+ `portfolio_account` link) | **yes** |
| `AccountId` NewType (`core/shared/ids.py:21`) | **yes** |
| `DuckDBAccountRepository` returning an `AccountInfo` DTO | **yes** |
| An `Account` aggregate in `core/portfolio/` | **no** |

RFC-0010 §4.1 originally said "V1.0 has no Account"; **ADR-0026** corrected that, pulling it in as a
**reference entity** so that auto-emitted cash legs are addressable — `account.cash_asset_id` is what
makes that work.

So `Operation.account_id` and `Portfolio.accounts` reference something with a table and an id type
but no domain aggregate. That is the current, intended state.

---

## `IndicatorReading` and market indicators

**Specified:** RFC-0004 §2.2, RFC-0006 §4.2 (market indicators as facts), RFC-0007 §8.1 (derived
indicator facts), **ADR-0031**, **I-16**.
**Implemented:** nothing. `PriceView` is the only Market type that exists.

Two condition kinds depend on this and are therefore also absent: **`indicator_threshold`** and
**`concentration_above`**, both moved to **V1.2** by **ERR-3** (whose whole subject was that
RFC-0006 §3's availability column contradicted the roadmap).

**ERR-14** is worth knowing here: `concentration_above` is the kind that *already* contradicted
RFC-0006 §7.1's "no `AssetId`" claim, which is why that claim was rescoped rather than defended.

---

## Classification axes — `ClassificationAxis`

**Specified:** **ADR-0033**, **E12**, RFC-0012 §4 (which restates **I-14** to `(axis, value)` pairs
and adds **I-19**, **I-20**), **ERR-14**.
**Implemented:** nothing. `asset.asset_class` is a single `VARCHAR`.

Today an `Asset` carries exactly one `AssetClass` on an implicit single `ASSET_CLASS` axis, every
weight is `1`, and **I-19** / **I-20** are trivially satisfied. **I-18** (the category hierarchy is
acyclic) has nothing to constrain.

ADR-0033's real content — **orthogonal** axes with **fractional** exposure, so one Asset can be 60%
`EQUITY_DEVELOPED` and 40% `EQUITY_EMERGING` on the same axis — would change `AllocationBreakdown` to
be per-axis. RFC-0012 §4 notes that the `ASSET_CLASS` decomposition is unchanged from today's
behaviour *because every weight there is 1*, which is what makes the migration additive. Sequenced at
**V1.2**.

---

## Condition combinators

**Specified:** RFC-0006 §2.1 — `all_of` / `any_of` / `not` over flat leaves, **composition depth
exactly 1**. Explicitly out of skeleton scope by RFC-0006 §12.
**Implemented:** nothing. Only `LeafCondition` exists, and `Rule.condition` is a **bare
`LeafCondition`**, not a union.

Depth 1 is a **design limit, not an accident**: a closed catalog turns into a general expression
language by degrees, and unbounded nesting is the first degree. If combinators land, `Rule.condition`
becomes a union and the trace's `condition` field has to carry the tree — which is a
`TRACE_VERSION` bump, not a trace migration (RFC-0009 §7.2).

---

## Candidate `StrategyVersion` lineage

**Specified:** **ADR-0035** (candidate evaluation via draft lineage), **ERR-13**, **I-22**.
**Implemented:** partially, by accident of design.

- **Present:** `RunMode.HYPOTHETICAL`, and RFC-0008 §8's rule that hypothetical runs produce zero
  Recommendations. `mv_finding` filters `WHERE run.mode = 'ACTUAL'`.
- **Absent:** `lineage_kind` on `strategy_version`, so there is no `MAINLINE` / `CANDIDATE`
  distinction, and **I-22** (a `CANDIDATE` is never the target of `strategy.current_version_id`) has
  nothing to check.

RFC-0012 §3 describes **two independent guards** keeping a candidate out of the findings list: the
hypothetical-run rule *and* I-22. **Only the first exists today.** So a candidate version could be
made current, and nothing would stop it.

**ERR-13**'s subject was precisely that the UI mock used candidate evaluation without the corpus ever
specifying it.

---

## `I-21` — epistemic classes

**Specified:** RFC-0012 §4, originating in RFC-0010's **ADR-0032** (increment classes: observation,
projection, generation).
**Implemented:** nothing. `ConditionKindSpec` has eight declared components and none of them is an
epistemic class.

Note the registry detail RFC-0012 §4 spells out: I-21 originates in ADR-0032 but is *recorded* in
RFC-0012 because that is the amending document, and the registry takes its rows from one place
regardless of which ADR produced them.

---

## The `cashflow` context

`core/cashflow/__init__.py` is **0 bytes**. Deferred to V1.1 by **ADR-0024**, amended by **ADR-0026**
(which pulled `Account` forward). The package exists so contract **C3** has a fifth module to hold
independent.

---

## Summary table

| Thing | Corpus | Table? | Domain type? | Sequenced |
|---|---|---|---|---|
| `Decision` | RFC-0004 §7, RFC-0008 §7, ADR-0002, ADR-0022 | no | no | V1.0 scope, unbuilt |
| `Goal` | RFC-0007 §9, E9, ADR-0036 | **yes** (+ link) | no | V1.1 (escalated) |
| `Account` | ADR-0026, ERR-8 | **yes** (+ link) | no (DTO only) | reference entity |
| `IndicatorReading` | RFC-0006 §4.2, ADR-0031 | no | no | V1.2 |
| `indicator_threshold`, `concentration_above` | RFC-0006 §3, ERR-3 | n/a | no | V1.2 |
| `ClassificationAxis` | ADR-0033, E12, I-19/I-20 | no | no | V1.2 |
| combinators | RFC-0006 §2.1, §12 | n/a | no | post-skeleton |
| `lineage_kind` / I-22 | ADR-0035, ERR-13 | no column | no | V1.1 |
| epistemic class / I-21 | ADR-0032, RFC-0012 §4 | n/a | no | unscheduled |
| `cashflow` | ADR-0024 | no | **empty package** | V1.1 |

---

## Before you build any of these

1. **Read the RFC section, not this page.** This page is an index; the corpus is normative and
   outranks the code.
2. **Check the precedence chain.** Precedence is **section-scoped and recency-ordered**
   (RFC-0012 §8) — the latest document that speaks to *that section* wins, not the latest document
   overall. `RFC-0000-index.md` §4 is the lookup table of what corrects what.
3. **Read the most recent `docs/handoff/HANDOFF-<date>.md`.** It records what is deliberately
   unfinished — some of these gaps have context there that never reached an RFC.
4. **Product-definition questions go to the product owner.** An agent never invents one. Several of
   these gaps are unbuilt *because a product question is open*, not because nobody got to them.
