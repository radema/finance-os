# RFC-0011 — Consolidated Repairs & Errata

| | |
|---|---|
| **Status** | Proposed |
| **Track** | Technical (0004–0010) |
| **Depends on** | RFC-0004 through RFC-0010; RFC-0001/0002/0003 (frozen) |
| **Amends** | RFC-0004, RFC-0005, RFC-0006, RFC-0007, RFC-0008, RFC-0009, RFC-0010 |
| **Resolves** | RFC-0008 §12.4 (`REJECTED` status); the `VirtualHolding`/`bucket_apportionment` reconciliation; cash-as-Asset mechanics; `rule` persistence identity; TRANSFER/correction semantics; UNASSIGNED scoping; `Goal` freeze boundary; `price` ownership |
| **Introduces** | ADR-0025 through ADR-0031; extensions E10, E11 |
| **Language** | English. Ubiquitous Language verbatim per RFC-0003. |

---

## 1. Context

A full cross-reference audit of RFC-0004–0010 surfaced two classes of defects:

1. **Errata** — mechanical inconsistencies where one document already contains the answer and another was not updated. These require no new decision; they require replacement text.
2. **Underspecifications** — places where two accepted decisions collide, or where a deferred question in fact leaks into an earlier increment. These required decisions, taken in dialogue and recorded here as ADR-0025 through ADR-0031, plus three minor resolutions (§4).

Per corpus convention, the originals are **not edited in place**: section-number cross-references throughout 0004–0010 remain valid, and this document is the single authoritative source for every correction. Where a conflict exists between an original RFC and this document, **this document wins**.

The audit also produced RFC-0000 (Index), the navigational companion to this corpus.

---

## 2. Errata

Identifiers are `ERR-n` to avoid collision with the extension queue `E1–E11`.

### ERR-1 — `alert.severity` column is missing

**Defect.** RFC-0008 §4 (`mv_finding`) reads `arg_max(a.severity, r.recorded_at)` from `alert`, but RFC-0009 §3.2 / ADR-0013 promote only `outcome`, `rule_id`, `run_id`, `priority` to columns. `severity` was defined later (RFC-0007 §3.1) and exists only inside the trace JSON. The view as written fails.

**Repair.** `severity` is promoted to a real column on `alert`. Replacement DDL:

```sql
CREATE TABLE alert (
    id           UUID PRIMARY KEY,
    run_id       UUID NOT NULL REFERENCES evaluation_run(id),
    rule_id      UUID NOT NULL,               -- logical id; no FK per ADR-0027
    outcome      VARCHAR NOT NULL,            -- FIRED | NOT_FIRED | SKIPPED | ERROR
    priority     VARCHAR NOT NULL,
    severity     DECIMAL(19,8),               -- NULL for kinds declaring severity = null,
                                              -- and for SKIPPED/ERROR outcomes
    trace        JSON NOT NULL,
    recorded_at  TIMESTAMPTZ NOT NULL
);
```

The value duplicates the trace binding by design — same posture as `outcome` and `priority`: promoted because queried, authoritative copy in the trace. Note the DDL also drops `REFERENCES rule(id)` per ADR-0027.

### ERR-2 — `evaluation_run` has no scope

**Defect.** ADR-0020 makes evaluation Bucket-scoped; `FactSet` carries `scope`; ADR-0021's resolution rule ("absent from the most recent ACTUAL run in which its rule was evaluated") is scope-dependent. The `evaluation_run` DDL carries only `portfolio_id`.

**Repair.** Two columns added:

```sql
    scope_kind   VARCHAR NOT NULL,   -- 'PORTFOLIO' | 'BUCKET'
    scope_id     UUID NOT NULL,      -- portfolio_id or bucket_id per scope_kind
```

`portfolio_id` is retained (a bucket-scoped run still belongs to a portfolio; Snapshot join in RFC-0009 §5.1 depends on it). ADR-0021's resolution predicate is restated precisely: *a finding resolves when the most recent `ACTUAL` run with matching `(scope_kind, scope_id)` in which its rule was evaluated produced `NOT_FIRED`.*

### ERR-3 — Condition catalog availability vs roadmap

**Defect.** RFC-0006 §3 marks `indicator_threshold` and `concentration_above` as **1**; RFC-0010 §3 places indicators and risk rules in **V1.2**.

**Repair.** The catalog's Avail column is corrected: `indicator_threshold` → **1.2**, `concentration_above` → **1.2**. RFC-0010 is authoritative for sequencing; the catalog column is descriptive only.

### ERR-4 — `bucket_below_target_value` declares a phantom fact

**Defect.** RFC-0006 §3 lists `prices` among facts consumed. `FactSet` (RFC-0006 §4) has no `prices` field — deliberately, since valuation belongs to the Portfolio Engine (RFC-0007 §6.1).

**Repair.** Facts column corrected to `allocation` (monetary values per class per scope are already present in `AllocationLine`). No kind may ever declare `prices` as a fact.

### ERR-5 — RFC-0004's `TargetAllocation` and I-13 are silently superseded

**Defect.** ADR-0017 (RFC-0007) replaced the flat `Map[AssetClass, (Weight, Tolerance)]` with a tree of relative weights and revised I-13, but RFC-0004 §2.1 and §6.2 were never annotated.

**Repair.** Errata note attached to RFC-0004:

> §2.1 `TargetAllocation` row and §6.2 I-13 are superseded by RFC-0007 ADR-0017. Current definitions: `TargetAllocation` is a tree; each node's `Weight` is relative to its parent; a `Tolerance` may attach at any node. **I-13 (revised):** *the children of every node sum to 1, within an explicit `Decimal` epsilon, enforced in the tree constructor.* Effective leaf targets are the product of weights along the root→leaf path and therefore sum to 1 by construction.

### ERR-6 — I-11 enforcement wording is stale

**Defect.** RFC-0004's class diagram gives `Alert` a `strategyVersion` field and I-11's enforcement reads "non-nullable fields" on the Alert. RFC-0009 moved the pin to `evaluation_run` via `run_id`.

**Repair.** I-11 enforcement restated: *every `Alert` carries non-nullable `run_id` and `rule_id`; `evaluation_run` carries non-nullable `strategy_id` and `strategy_version_id`; `strategy_version` rows are immutable. The pin `(strategy_id, strategy_version, rule_id)` is therefore one join away and can never dangle or drift.* The class-diagram field `Alert.strategyVersion` is replaced by `Alert.runId`.

### ERR-7 — Walking skeleton predates `EvaluationRun`

**Defect.** RFC-0005 §8 (written before RFC-0009) omits `EvaluationRun` from skeleton scope; task 10 says "repositories for the seven aggregates".

**Repair.** `EvaluationRun` (E4) is **in** skeleton scope — the skeleton's single `evaluate` necessarily writes one row. Task 10 reads "repositories for the eight aggregates in scope". No other skeleton change.

### ERR-8 — Missing DDL

**Defect.** `mv_holding` (RFC-0009 §3.4) joins `portfolio_account`, which is never defined; no `CREATE TABLE` exists for `portfolio`, `bucket`, `strategy`, or `strategy_version`.

**Repair.** Completing DDL (incorporating ADR-0026, ADR-0027, ADR-0030):

```sql
CREATE TABLE portfolio (
    id    UUID PRIMARY KEY,
    name  VARCHAR NOT NULL
);

CREATE TABLE portfolio_account (
    portfolio_id UUID NOT NULL REFERENCES portfolio(id),
    account_id   UUID NOT NULL REFERENCES account(id),
    PRIMARY KEY (portfolio_id, account_id)
);

CREATE TABLE account (
    id             UUID PRIMARY KEY,
    name           VARCHAR NOT NULL,
    type           VARCHAR NOT NULL,
    currency       VARCHAR(3) NOT NULL,
    cash_asset_id  UUID NOT NULL REFERENCES asset(id)   -- ADR-0026
);

CREATE TABLE bucket (
    id            UUID PRIMARY KEY,
    portfolio_id  UUID NOT NULL REFERENCES portfolio(id),   -- ERR-9
    strategy_id   UUID NOT NULL REFERENCES strategy(id),    -- I-3
    name          VARCHAR NOT NULL
);

CREATE TABLE strategy (
    id                  UUID PRIMARY KEY,
    name                VARCHAR NOT NULL,
    current_version_id  UUID,               -- FK added after strategy_version exists
    -- horizon, risk profile, principles, objective: frozen copies live
    -- in strategy_version.definition; these rows carry identity + name only
    description         VARCHAR
);

CREATE TABLE strategy_version (
    id                 UUID PRIMARY KEY,
    strategy_id        UUID NOT NULL REFERENCES strategy(id),
    parent_version_id  UUID REFERENCES strategy_version(id),
    definition         JSON NOT NULL,       -- canonical: targets tree, tolerances,
                                            -- rules[] (ADR-0027), horizon, risk,
                                            -- principles, objective
    change_note        VARCHAR NOT NULL,    -- RFC-0007 §7
    frozen_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE strategy_goal (                -- ADR-0030: outside the freeze boundary
    strategy_id  UUID NOT NULL REFERENCES strategy(id),
    goal_id      UUID NOT NULL REFERENCES goal(id),
    PRIMARY KEY (strategy_id, goal_id)
);
```

There is **no `rule` table** (ADR-0027). The `STRATEGY_VERSION ||--|{ RULE` edge in RFC-0009's ER diagram is reinterpreted as document containment, not a table relationship.

### ERR-9 — `Bucket` field lists disagree

**Defect.** RFC-0004 §2.2 says `Bucket` references `Strategy, Portfolio`; the class diagram gives only `governedBy`; RFC-0009's ER has `PORTFOLIO ||--o{ BUCKET`.

**Repair.** `Bucket` carries both: non-nullable `portfolio_id` (a Bucket partitions one Portfolio's capital — I-9 conservation is meaningless without it) and non-nullable `strategy_id` (I-3). Class diagram gains `+PortfolioId portfolio`. DDL above is authoritative.

### ERR-10 — RFC-0006 §9 YAML example incomplete

**Defect.** Rule 2 lacks `enabled`; the first combinator leaf lacks `max_staleness`.

**Repair.** Defaults are declared once at the schema level rather than repeated in examples: `enabled: true`; `max_staleness` defaults **per condition kind** (each kind's registration declares one, checked by the registry completeness test — a fifth mandatory registration component alongside params model, evaluator, explanation template, `required_facts`, and severity declaration). Examples stay minimal by design.

---

## 3. Resolutions (ADR-0025 — ADR-0031)

### ADR-0025 — `VirtualHolding` as derived model; I-9 as evaluation-time finding

**Context.** RFC-0004 §2.2 classified `VirtualHolding` as a mutable child entity inside the `Bucket` aggregate, with I-9 ("Σ VirtualHolding.quantity ≤ Holding.quantity") checked at write time on apportionment. RFC-0009 §2.1/§3.1 replaced storage with `bucket_apportionment`, an append-only effective-dated supersession table. The two were never reconciled, and I-9 became time-ambiguous: `Holding` is a fold that changes with every Operation, while apportionment rows are effective-dated. A SELL executed after an apportionment can retroactively over-commit it, and nothing specified who notices or what happens.

**Decision Drivers.** P7 (no silent state repair); consistency with the `Holding`/`Operation` derivation pattern; ADR-0011's supersession model already accepted; "surface, don't silently fix" as the corpus-wide posture; not blocking legitimate Operations on bookkeeping state.

**Considered Options.**
1. *Write-time rejection* — a SELL that would over-commit any Bucket fails at import.
2. *Auto-supersession* — the SELL triggers automatic pro-rata reduction of apportionment rows.
3. *Derived `VirtualHolding` + I-9 as an evaluation-time finding* — over-commitment surfaces as a negative `UNASSIGNED` residual and a dedicated Rule firing.

**Decision Outcome.** Option 3.

Option 1 blocks recording a *fact* (a sale that already happened at the broker) on the state of *bookkeeping* (apportionment), inverting the priority between the two — the Operation log must always be able to record reality. Option 2 is the same class of invisible, uncaused state change that ADR-0001 rejected for weight-based apportionment: the system silently rewriting which Bucket owns what, with no auditable user act behind it.

Under Option 3:

- **`VirtualHolding` moves from RFC-0004 §2.2 (Entities) to §2.3 (Derived Read Models):** `VirtualHolding(bucket, asset, as_of) → Quantity`, computed by resolving `bucket_apportionment` supersession chains at `as_of`. The authored fact is the apportionment row; the entity is a projection — exactly the `Holding`/`Operation` relationship. Extension E3's wording is adjusted accordingly (still promotes "Holdings virtuali" to a named concept; the concept is now derived).
- **I-9 restated:** *for each Asset at any `as_of`, Σ apportioned quantity ≤ Holding quantity. A violation is a reportable state, never a rejectable write.* The `UNASSIGNED` residual may be negative; a negative residual is a deficit finding.
- **New condition kind** (catalog addition): `over_apportioned(scope)` — fires when any Asset in scope has Σ apportionment > Holding at `as_of`. Priority `HIGH`, `suggestion_class: REVIEW_BUCKET_ASSIGNMENT`, `severity = deficit_quantity / holding_quantity` (holding of the affected Asset). Availability: **V1.0** — reachable the first time anything is sold. It joins `unassigned_residual_above` as the second rule by which the system surfaces its own maintenance chores through the explainable channel.
- A **soft write-time warning** survives in the apportionment UI (the only place where the check is cheap and the user is present), but it warns, it does not reject, and it is not an invariant.
- The one remaining write-time invariant: `bucket_apportionment.quantity >= 0` (already a DDL CHECK).

**Consequences.** The Bucket aggregate becomes thin (identity, portfolio, governing strategy, name) — its transactional boundary no longer contains apportionment state, simplifying the repository. Drift computation reads `VirtualHolding` at the run's `as_of`, which was already implied by ADR-0011 but is now the only reading. Cost: a user who never opens the app after selling carries an over-committed apportionment until the next evaluate — accepted, because the next evaluate is also the first moment the information could matter.

---

### ADR-0026 — Cash legs auto-emitted as paired Operations

**Context.** ADR-0024 delivers V1.0 Net Worth via cash positions modelled as `Asset`s with a `CASH` class. A Holding is a fold over `Operation`s — so something must change the CASH quantity when a BUY settles. RFC-0004 §10.6 deferred the `Transaction`↔`Operation` overlap to V1.1, but V1.0's headline feature is unbuildable without resolving the Operation half now.

**Decision Drivers.** Net Worth correctness in V1.0; no manual double-entry (the data-entry-friction risk in RFC-0010 §6.1 is the project's top risk); atomicity (a BUY and its cash effect are one fact); leaving the V1.1 `Transaction` reconciliation answerable rather than foreclosed.

**Considered Options.**
1. *Auto-emitted cash leg* — every cash-affecting Operation writes a paired Operation on the Account's designated CASH Asset, atomically.
2. *Manual cash Operations* — the user records cash movements separately.
3. *Periodic reconciliation* — CASH holdings seeded from statements, drift accepted between imports.

**Decision Outcome.** Option 1. Option 2 doubles the entry burden on every trade and guarantees divergence the first time an entry is forgotten — and a silently wrong Net Worth is a plausible-looking wrong number, the failure class this architecture exists to prevent. Option 3 makes Net Worth stale by design and makes the CASH Holding un-derivable from the Operation log, breaking ADR-0003's single-source-of-truth argument for the one class where it is easiest to get right.

**Mechanics.**

- `Account` gains non-nullable `cash_asset_id` — each liquidity container maps to exactly one CASH-class Asset (DDL in ERR-8).
- `operation` gains `cash_leg_of UUID REFERENCES operation(id)`, non-null only on auto-emitted legs.
- BUY emits a cash leg of `−(quantity × price) − fees`; SELL emits `+(quantity × price) − fees`; DIVIDEND and COUPON emit a positive cash leg equal to the amount (the "primary" row for these carries the cash amount and zero quantity change on the security — their cash leg *is* their effect). Fees never need their own Operation.
- The pair is written in one repository transaction, same `import_batch_id`. Deleting or correcting either side alone is unrepresentable: a `CORRECTION` (ADR-0028) of a legged Operation requires correcting the pair.

**Consequences.** `Account` exists in V1.0 as a **reference entity** — RFC-0010 §4.1's claim "V1.0 has no `Account`" is softened to *"no `Transaction`, no `Category`, no Cash Flow Engine; `Account` exists as a reference row carrying `cash_asset_id`"*. The V1.1 reconciliation question (RFC-0004 §10.6) becomes crisp: an imported bank `Transaction` matching a cash-leg Operation is deduplicated against the `cash_leg_of` link at import time — the deferral stands, but the answer's shape is now fixed. CASH Assets are valued at par (price ≡ 1 in their own currency), so they need no price series — recorded here so nobody builds a `CASH` price feed.

---

### ADR-0027 — Rule definitions embedded in `StrategyVersion`; `rule_id` as logical identifier

**Context.** Three prior claims could not jointly hold: `rule_id` is stable across versions (RFC-0006 §8); a Rule's definition is frozen per `StrategyVersion` and may differ between versions; `alert.rule_id UUID REFERENCES rule(id)` implies one physical row per `rule_id`. If params change in v3, a v2-era Alert's FK points at a row that no longer says what the Alert evaluated.

**Decision Drivers.** RFC-0004's own classification of `Rule` as a child entity, not an aggregate; RFC-0006 §8's lookup contract "`(strategy_version_id, rule_id)` identifies one frozen definition"; ADR-0009's canonical serialization (the YAML export already treats rules as part of the version document); avoiding a table whose rows are immutable copies of JSON that exists anyway.

**Considered Options.**
1. *`rule` table keyed `(strategy_version_id, rule_id)` composite*, with `alert` carrying both columns as a composite FK.
2. *Rule definitions embedded in `strategy_version.definition`*; `rule_id` columns kept as plain logical identifiers with no FK.
3. *One `rule` row per `rule_id`*, mutable, versions referencing it — the status quo as written.

**Decision Outcome.** Option 2. Option 3 is simply broken (the collision above). Option 1 works but stores every rule twice — once relationally, once in the version's canonical document that ADR-0009 exports — and the relational copy answers no query the document lookup does not: every consumer of a rule definition already holds a `strategy_version_id`.

**Consequences.**

- No `rule` table. `strategy_version.definition` (ERR-8) contains `rules[]` under the same canonicalization rules as traces (RFC-0006 §10).
- `alert.rule_id` and `recommendation.rule_id` keep their columns, **without FK** (see ERR-1 DDL). They are resolved as `strategy_version.definition.rules[id == rule_id]` via the row's `run_id → strategy_version_id`.
- **Referential integrity moves to the application boundary:** `Alert` construction rejects a `rule_id` absent from the pinned version. This is the price of dropping the FK, so it is guarded by a **property test** (added to RFC-0008 §9's table): *for every persisted Alert, `rule_id` resolves within its run's `strategy_version`.*
- `finding_key` is unaffected — it hashes `rule_id ‖ scope ‖ params`, none of which needed the table.
- RFC-0009's ER edge `STRATEGY_VERSION ||--|{ RULE` denotes document containment.

---

### ADR-0028 — `OperationType` widened: transfers as pairs, corrections as a type (extension E10)

**Context.** `operation` has one `account_id`, so `TRANSFER` — two-sided by nature — cannot be represented in one row. Separately, the correction model ("compensating Operations", I-10) collides with the DDL's own sign checks: an erroneous BUY cannot be compensated by a negative-quantity BUY (`CHECK` violation), and compensating with a SELL fabricates a sale that never happened — which poisons any future cost-basis computation (Tax Engine, V2).

**Decision Drivers.** Representability of transfers; corrections that are distinguishable from economic events (the exact distinction ADR-0011 says an audit trail exists to make); Tax Engine cost-basis integrity; I-10 unchanged (append-only, compensation not mutation).

**Considered Options.**
1. *Keep `TRANSFER` single-row* with a nullable `counterparty_account_id`.
2. *Relax sign checks* and compensate a BUY with a negative BUY.
3. *Widen the type enum*: `TRANSFER_IN`/`TRANSFER_OUT` pairs; `CORRECTION` exempt from sign checks.

**Decision Outcome.** Option 3. Option 1 makes the Holding fold read two columns for one type and breaks the uniform "one row = one account's side of one event" shape every query assumes. Option 2 makes an erroneous entry and a real purchase indistinguishable by type — the "restated vs bug" distinction lost again, one layer down.

**Mechanics.**

- `TRANSFER` is replaced by a pair: `TRANSFER_OUT` (`quantity < 0`) on the source account, `TRANSFER_IN` (`quantity > 0`) on the destination, written atomically, linked by a new `transfer_pair_id UUID` (same value on both rows). A portfolio-internal transfer nets to zero in `mv_holding` by construction.
- `CORRECTION` is exempt from sign checks; requires non-null `corrects_id`; the corrected row must exist and must not itself be a `CORRECTION` (no chains — a correction of a correction targets the original). Its quantity/price/fees are deltas that, summed with the target row, yield the intended values.
- Revised checks:

```sql
    CHECK (type <> 'BUY'          OR quantity > 0),
    CHECK (type <> 'SELL'         OR quantity < 0),
    CHECK (type <> 'TRANSFER_IN'  OR quantity > 0),
    CHECK (type <> 'TRANSFER_OUT' OR quantity < 0),
    CHECK (type <> 'CORRECTION'   OR corrects_id IS NOT NULL),
    CHECK (type = 'CORRECTION'    OR corrects_id IS NULL)
```

- `mv_holding` filter becomes `type IN ('BUY','SELL','TRANSFER_IN','TRANSFER_OUT','CORRECTION')`.
- Tax consequence recorded now: cost-basis computation must net `CORRECTION` rows into their targets before any FIFO/LIFO walk — which is possible precisely because corrections are typed rather than disguised as SELLs.

**Consequences.** RFC-0003's five-value *Tipologie* becomes seven → **extension E10, product ratification required**. Blocks nothing (the skeleton uses BUY only) and rides with E5/E7 in the V1.0 ratification batch. Cash legs (ADR-0026) of a corrected Operation are corrected in the same transaction.

---

### ADR-0029 — `UNASSIGNED` in denominators; `unassigned_residual_above` denominator fixed

**Context.** `unassigned_residual_above(threshold_weight)` never specified what the weight is relative to; and RFC-0007 §4.1 answered denominator questions for *untargeted* holdings but not for *unapportioned* capital under portfolio-scope evaluation.

**Decision Drivers.** RFC-0007 §4.1's honesty argument (capital that exists must not vanish from compliance math); a per-Bucket reading of a residual that belongs to no Bucket is incoherent; consistency between the two "hygiene" rules.

**Decision Outcome.**

- `unassigned_residual_above.threshold_weight` is relative to **total portfolio value**. The rule is portfolio-scoped by nature; `scope` is removed from its params (it was never meaningful).
- For `scope: portfolio` drift evaluation, `UNASSIGNED` capital **stays in the denominator** — same reasoning as untargeted holdings: the capital is genuinely there, and excluding it would display compliance you do not have. The resulting dilution noise is exactly what `unassigned_residual_above` (and now `over_apportioned`) exist to explain.
- For `scope: bucket` evaluation the question does not arise: the denominator is the Bucket's own apportioned value.

**Consequences.** RFC-0007 §4.1's edge-case table gains a row: *"Unapportioned capital, portfolio scope → in `total_value`, no target of its own, surfaced by `unassigned_residual_above`."*

---

### ADR-0030 — `Goal` links outside the freeze boundary

**Context.** `Strategy` carries `GoalId[]` and RFC-0007 §7 freezes on *any* change to the Strategy aggregate, with no materiality judgment. Linking a Goal — an object with an explicitly independent lifecycle (RFC-0004 §2.2) — would therefore mint a `StrategyVersion`. Marking a Goal `ACHIEVED` would pollute the version lineage that `change_note` exists to narrate.

**Decision Drivers.** No evaluation reads Goals before `goal_funding_gap` (V2); Goals' independent lifecycle is a source-document property; version lineage should narrate strategy *thinking*, not bookkeeping; P7 provenance must still pin the goal when a rule finally reads one.

**Considered Options.**
1. *Goals frozen inside `StrategyVersion`* — the literal reading of RFC-0007 §7.
2. *Goals as a mutable link table on `Strategy`*, outside the freeze boundary; provenance pinned at the rule level when needed.

**Decision Outcome.** Option 2. When `goal_funding_gap` arrives (V2), the **rule's params pin the `goal_id`** — and the rule is frozen in the version — which is where the provenance actually needs it: the evaluation's target is reconstructable from the version, while the link table merely expresses current association for navigation and reporting.

**Consequences.** `strategy_goal(strategy_id, goal_id)` link table (ERR-8), plain CRUD. RFC-0007 §7's freeze trigger is restated: *any change to targets, tolerances, rules, horizon, risk, principles, objective, name, or description — but not Goal links.* This is not a materiality judgment; it is a boundary statement: Goal links are not part of the Strategy aggregate. RFC-0004's class diagram drops `+GoalId[] goals` from `Strategy`; the many-to-many association survives as the link table. E9 (the `objective`/`Goal` split, RFC-0007 §9) is unaffected and still pending ratification.

---

### ADR-0031 — Market owns all external observations, prices included (extension E11)

**Context.** RFC-0007 §6.1 sited valuation *computation* in the Portfolio Engine but left RFC-0004 §10.4 half-open: which bounded context owns the `price` series and the `PriceProvider` port? RFC-0003's Market charter mentions only macro indicators; RFC-0010 has `HttpPriceProvider` arriving in V1.0 with no context assignment while the Market Engine arrives in V1.2.

**Decision Drivers.** One egress surface, not two (Privacy First — RFC-0005 §5.7 audits egress per context); `price` and `indicator_reading` share the identical bitemporal posture (RFC-0009 §2.1) and the identical revision problem; keeping Portfolio the cleanest, most stable context; the `IndicatorView` pin pattern already solved this shape.

**Considered Options.**
1. *Portfolio owns prices* — they value its Holdings.
2. *Market owns all external observations* — prices join indicators; Portfolio consumes via a contract.

**Decision Outcome.** Option 2. Option 1 puts an HTTP adapter behind the context whose whole virtue is stability, splits egress across two contexts, and duplicates the bitemporal query discipline (RFC-0009 §9's two-named-accessors rule) in two owners.

**Consequences.**

- `price` table, `price_latest()` / `price_as_known_at()` accessors, and the `PriceProvider` port move under the **Market** context. `MarketEngine`'s charter becomes "fetch and record external observations" — indicators and prices alike.
- New contract in RFC-0004 §4.1's table: **`PriceView`** — *Market → Portfolio*, payload `(asset_id, price_id, valid_date, close, currency, recorded_at)`, pinning `price_id` exactly as `IndicatorView` pins `reading_id`. Portfolio never queries `price` directly.
- Sequencing is untouched: V1.0 ships the Market context's *price half* (`price` table + providers + `PriceView`); the *indicator half* arrives in V1.2 as planned. RFC-0010's V1.0 table row "Ingestion" is annotated accordingly.
- Extends RFC-0003's Market charter → **extension E11, low-risk ratification** (same class as E3).

---

## 4. Minor Resolutions

**R-1 — `Decision.status` (closes RFC-0008 §12.4).** The domain enum is defined in full now — `ENACTED | ACKNOWLEDGED | DEFERRED | REJECTED` — but `REJECTED` is excluded from the V1.1 capture UI, per RFC-0008 §12.4's lean. Enum members are cheap; UI affordances are the friction. If the acknowledged/rejected distinction proves real in use, exposing it is a template change, not a migration. RFC-0010 §7's deferral row for `REJECTED` now reads "domain: done; UI: V2, if the distinction proves real".

**R-2 — `finding_key` deliberately double-encodes scope.** `scope` appears both as a hash component of `finding_key` and, for most kinds, inside `params`. The redundancy is **kept and documented**: a future condition kind whose params omit scope would otherwise silently merge findings across Buckets. One guaranteed hash component beats a convention about params contents.

**R-3 — YAML authoring defaults.** Resolved in ERR-10: `enabled: true` by default; `max_staleness` defaults declared per condition kind at registration, enforced by the registry completeness test.

---

## 5. Roadmap Deltas (amends RFC-0010)

| Increment | Delta | Origin |
|---|---|---|
| **S — Skeleton** | `EvaluationRun` in scope; task 10 → "eight aggregates" | ERR-7 |
| **V1.0** | `over_apportioned` condition kind (catalog + rule) | ADR-0025 |
| **V1.0** | Cash-leg machinery: `Account` as reference entity with `cash_asset_id`, paired-Operation writer, `cash_leg_of` | ADR-0026 |
| **V1.0** | `TRANSFER_IN`/`TRANSFER_OUT`/`CORRECTION` importer support | ADR-0028 |
| **V1.0** | Market context ships its price half: `price`, providers, `PriceView` | ADR-0031 |
| **V1.1** | `Transaction`↔cash-leg dedup at import (shape fixed by ADR-0026) | ADR-0026 |
| **V1.2** | `indicator_threshold`, `concentration_above` availability formally corrected | ERR-3 |

The V1.0 additions are real scope growth (roughly one importer concern, one new kind, one contract) — accepted, because every one of them is reachable from ordinary V1.0 usage and deferring any of them produces a silently wrong number.

---

## 6. Updated Extension & Ratification Queue

Supersedes RFC-0010 §5.

| E | Extension | Ratification | Blocks | Origin |
|---|---|---|---|---|
| **E1** | Ninth bounded context `Decision` | **Required** | **S** | RFC-0004 |
| E2 | `StrategyVersion` immutable aggregate | Technical | — | RFC-0004 |
| E3 | `VirtualHolding` as named (now derived) concept | Low risk | — | RFC-0004, amended ADR-0025 |
| E4 | `EvaluationRun` aggregate | Technical | — | RFC-0009 |
| **E5** | `Alert` = "rule evaluation record" | **Required** | V1.0 | RFC-0009 |
| E6 | `asset_classification_audit` | Technical | — | RFC-0009 |
| **E7** | `SuggestionClass` closed enum | **Required** | V1.0 | RFC-0006 |
| E8 | Strategy Engine not a Domain Service | Technical | — | RFC-0007 |
| **E9** | `Goal` vs `Strategy.objective` split | **Required** | V2 | RFC-0007 |
| **E10** | `OperationType` widened to seven values | **Required** | V1.0 | **ADR-0028** |
| E11 | Market charter includes prices | Low risk | V1.0 | **ADR-0031** |

E10 joins E5/E7 in the V1.0 ratification batch. E1 remains the only skeleton blocker.

---

## 7. Consequences

**Positive**

- Every schema-level contradiction found by the audit is closed with replacement DDL, not prose.
- The two derivation patterns are now uniform: `Operation → Holding` and `bucket_apportionment → VirtualHolding` are the same shape, and I-9's temporal ambiguity is resolved in the corpus's own idiom — surfaced, not silently repaired.
- The largest hidden V1.0 dependency (cash mechanics) is explicit, atomic, and leaves the V1.1 `Transaction` reconciliation *answerable* instead of foreclosed.
- Referential integrity lost with the `rule` table is compensated by a named property test, keeping "enforced by review is not an enforcement point" true.
- Egress remains confined to one context (Market), preserving the Privacy First CI contract's simplicity.

**Negative / accepted costs**

- **V1.0 grew.** Four deltas (§5) are additional scope in the increment that was already the largest. Each is justified individually; jointly they push V1.0 from M toward L.
- **`alert.rule_id` has no FK.** Application-level integrity guarded by one property test is weaker than a constraint — the same trade already accepted for I-10 under DuckDB, now made in a second place.
- **Two more ratification items** (E10, E11) widen the divergence between tracks until the product track writes its amendments.
- **A negative `UNASSIGNED`** is a concept users must learn; the `over_apportioned` explanation template carries that teaching burden.
- This document adds a **second lookup hop**: a reader of RFC-0004–0010 must check RFC-0011 for corrections. RFC-0000's cross-reference table (§ registry) is the mitigation.

---

## 8. Open Questions

1. **E10/E11 ratification timing** — should they ride the E5/E7 batch or go immediately, given E10 touches the Ubiquitous Language's *Tipologie* list directly?
2. **Cash-leg display.** Auto-emitted legs double the visible Operation count. Should the Operations list collapse pairs by default (rendering the leg as a detail of its parent)? Leaning yes; purely a read-side template question.
3. **`CORRECTION` of a transfer pair.** Correcting one side of a `transfer_pair_id` pair must correct both. Enforced in the repository like ADR-0026's cash legs, but the interaction of `corrects_id`, `transfer_pair_id`, and `cash_leg_of` on one row deserves a truth table before migration 001 freezes — assigned to the skeleton's task 3.
4. **Does the `over_apportioned` soft warning belong in the CLI importer too**, or only in the apportionment UI? Leaning both — the importer is where the deficit is usually created.

---

## Appendix A — ADR Index (cumulative, complete)

| ADR | Title | Status | Owner |
|---|---|---|---|
| ADR-0001 | Bucket apportionment model | Accepted, **amended by ADR-0025** | RFC-0004 |
| ADR-0002 | Definition of `Decision` | Accepted | RFC-0004 |
| ADR-0003 | `Holding` as derived read model | Accepted | RFC-0004 |
| ADR-0004 | Scope of reconstructability | Accepted | RFC-0009 |
| ADR-0005 | Local store: DuckDB single file | Accepted | RFC-0005 |
| ADR-0006 | Pydantic v2 in the domain core | Accepted | RFC-0005 |
| ADR-0007 | UI: FastAPI + Jinja2 + HTMX | Accepted | RFC-0005 |
| ADR-0008 | Single process, on-demand ingestion | Accepted | RFC-0005 |
| ADR-0009 | Strategy files as derived artifacts | Accepted | RFC-0005 |
| ADR-0010 | Defer commercialization posture | Accepted | RFC-0005 |
| ADR-0011 | Corrections as append-only supersession | Accepted | RFC-0009 |
| ADR-0012 | Reclassification as correction | Accepted | RFC-0009 |
| ADR-0013 | Trace stored as JSON, not STRUCT | Accepted, **amended by ERR-1** (severity promoted) | RFC-0009 |
| ADR-0014 | Conditions as a closed typed catalog | Accepted | RFC-0006 |
| ADR-0015 | No forward chaining | Accepted | RFC-0006 |
| ADR-0016 | `SKIPPED` distinct from `NOT_FIRED` | Accepted | RFC-0006 |
| ADR-0017 | Hierarchical `TargetAllocation`, relative weights | Accepted | RFC-0007 |
| ADR-0018 | Tolerance semantics | Accepted | RFC-0007 |
| ADR-0019 | Dual valuation basis for bonds | Accepted | RFC-0007 |
| ADR-0020 | Strategy as policy, applied per Bucket | Accepted | RFC-0007 |
| ADR-0021 | Findings as a derived read model | Accepted | RFC-0008 |
| ADR-0022 | Dismissal is a `Decision` | Accepted | RFC-0008 |
| ADR-0023 | `rationale` assembled from `StrategyVersion` | Accepted | RFC-0008 |
| ADR-0024 | Cash Flow deferred to V1.1 | Accepted, **amended by ADR-0026** (Account as reference entity) | RFC-0010 |
| **ADR-0025** | `VirtualHolding` derived; I-9 evaluation-time | **Accepted** | **RFC-0011** |
| **ADR-0026** | Auto-emitted cash legs | **Accepted** | **RFC-0011** |
| **ADR-0027** | Rules embedded in `StrategyVersion` | **Accepted** | **RFC-0011** |
| **ADR-0028** | `OperationType` widened (E10) | **Accepted** | **RFC-0011** |
| **ADR-0029** | `UNASSIGNED` denominators fixed | **Accepted** | **RFC-0011** |
| **ADR-0030** | `Goal` links outside freeze boundary | **Accepted** | **RFC-0011** |
| **ADR-0031** | Market owns prices (E11) | **Accepted** | **RFC-0011** |
