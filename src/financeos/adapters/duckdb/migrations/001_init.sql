-- =============================================================================
-- 001_init.sql — Finance OS initial schema (walking skeleton)
--
-- Governing documents (RFC-0011 wins every conflict with RFC-0009):
--   RFC-0009 §3   Physical schema, table classes, fixed numeric precisions.
--   RFC-0011      Consolidated repairs & errata — ERR-1, ERR-2, ERR-8, ERR-9,
--                 ADR-0025..0031.
--   ADR-L01       operation link-flag truth table (corrects_id / transfer_pair_id
--                 / cash_leg_of) — the seven-value type CHECK, sign checks with
--                 cash-leg exemptions, N1-N4 nullability rules, W1-W10 cross-row
--                 invariants (repository-enforced, not DDL).
--
-- Table classes (RFC-0009 §3):
--   definition — mutable, ordinary CRUD through repositories.
--   fact       — append-only. No UPDATE, no DELETE, ever (contract C6).
--   derived    — `mv_` prefix. Rebuildable from facts. Never a source of truth.
--
-- Identifiers: UUIDv7 generated in application code behind the IdGen port.
--   Columns are VARCHAR, not a DB-generated UUID type.
--
-- Fixed numeric precisions (RFC-0009 §3, non-negotiable; no DOUBLE/FLOAT
-- anywhere that feeds an evaluation):
--   money    DECIMAL(19,4)
--   quantity DECIMAL(28,10)
--   price    DECIMAL(19,8)
--   weight   DECIMAL(9,8)   -- not physically columned in 001: weights live
--                           -- inside strategy_version.definition JSON.
-- =============================================================================

-- schema_version — migration-applied marker for the startup migration runner.
CREATE TABLE schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL
);

-- -----------------------------------------------------------------------------
-- asset — definition. Mutable in place + audit log, NOT temporal (RFC-0009
-- §2.1/§3.3, ADR-0012): reclassification is a correction, not a version.
-- -----------------------------------------------------------------------------
CREATE TABLE asset (
    id           VARCHAR PRIMARY KEY,
    name         VARCHAR NOT NULL,
    asset_class  VARCHAR NOT NULL,    -- mutable: correction model (ADR-0012)
    currency     VARCHAR(3) NOT NULL,
    identifiers  JSON NOT NULL        -- [{"scheme":"ISIN","value":"IE00B4L5Y983"}]
);

-- asset_classification_audit — auditable, not temporal (RFC-0009 §3.3, E6).
-- Renders the "premises changed" line in the Reconcile view. The only write
-- path that may change asset.asset_class also writes this row, in one
-- transaction (repository-enforced, not a DDL trigger).
CREATE TABLE asset_classification_audit (
    id          VARCHAR PRIMARY KEY,
    asset_id    VARCHAR NOT NULL REFERENCES asset(id),
    from_class  VARCHAR NOT NULL,
    to_class    VARCHAR NOT NULL,
    reason      VARCHAR,
    changed_at  TIMESTAMPTZ NOT NULL
);

-- import_batch — definition. Not specified with a DDL anywhere in the corpus,
-- but ADR-L01 (W1, W4, W9) and RFC-0009 §3.1 both reference
-- operation.import_batch_id -> import_batch(id). Minimal gap-fill so that FK
-- is not dangling; no wider scope than "one row groups one atomic import".
CREATE TABLE import_batch (
    id           VARCHAR PRIMARY KEY,
    imported_at  TIMESTAMPTZ NOT NULL
);

-- goal — definition, CRUD, no history (RFC-0009 §2.1 table). No DDL is given
-- anywhere in the corpus, but ERR-8/ADR-0030 requires strategy_goal to
-- reference goal(id). Minimal gap-fill: identity + name only, same pattern
-- as portfolio/strategy below.
CREATE TABLE goal (
    id    VARCHAR PRIMARY KEY,
    name  VARCHAR NOT NULL
);

-- -----------------------------------------------------------------------------
-- portfolio, strategy, strategy_version, strategy_goal — definition (ERR-8).
-- -----------------------------------------------------------------------------
CREATE TABLE portfolio (
    id    VARCHAR PRIMARY KEY,
    name  VARCHAR NOT NULL
);

-- strategy — identity + name only; horizon, risk profile, principles,
-- objective are frozen copies inside strategy_version.definition (ERR-8).
-- current_version_id intentionally carries NO REFERENCES: it and
-- strategy_version.strategy_id are mutually referencing, and DuckDB has no
-- ALTER TABLE ... ADD CONSTRAINT / ADD FOREIGN KEY (verified: "Not
-- implemented Error: No support for that ALTER TABLE option yet!"), so the
-- FK ERR-8 describes as "added after strategy_version exists" cannot be
-- added in this engine. Integrity here is repository-enforced, same posture
-- already accepted for alert.rule_id / recommendation.rule_id (ADR-0027).
CREATE TABLE strategy (
    id                   VARCHAR PRIMARY KEY,
    name                 VARCHAR NOT NULL,
    current_version_id   VARCHAR,   -- logical ref to strategy_version(id); no FK, see above
    description          VARCHAR
);

-- strategy_version — immutable (E2). Rules embedded in `definition` JSON;
-- there is NO `rule` table (ADR-0027). rule_id columns elsewhere are logical
-- identifiers resolved via this row's `definition.rules[]`, never an FK.
CREATE TABLE strategy_version (
    id                  VARCHAR PRIMARY KEY,
    strategy_id         VARCHAR NOT NULL REFERENCES strategy(id),
    parent_version_id   VARCHAR REFERENCES strategy_version(id),
    definition          JSON NOT NULL,     -- canonical: targets tree, tolerances,
                                           -- rules[] (ADR-0027), horizon, risk,
                                           -- principles, objective
    change_note         VARCHAR NOT NULL,
    frozen_at           TIMESTAMPTZ NOT NULL
);

-- strategy_goal — plain CRUD link, deliberately OUTSIDE the StrategyVersion
-- freeze boundary (ADR-0030): linking/unlinking a Goal does not mint a new
-- StrategyVersion.
CREATE TABLE strategy_goal (
    strategy_id  VARCHAR NOT NULL REFERENCES strategy(id),
    goal_id      VARCHAR NOT NULL REFERENCES goal(id),
    PRIMARY KEY (strategy_id, goal_id)
);

-- bucket — definition. Carries BOTH portfolio_id and strategy_id, both
-- NOT NULL (ERR-9): a Bucket partitions one Portfolio's capital (I-9 is
-- meaningless without portfolio_id) and is governed by one Strategy (I-3).
-- Thin aggregate post-ADR-0025: apportionment state moved out to
-- bucket_apportionment; VirtualHolding is now derived, not stored here.
CREATE TABLE bucket (
    id            VARCHAR PRIMARY KEY,
    portfolio_id  VARCHAR NOT NULL REFERENCES portfolio(id),
    strategy_id   VARCHAR NOT NULL REFERENCES strategy(id),
    name          VARCHAR NOT NULL
);

-- account — definition. Exists in V1.0 as a reference entity carrying
-- cash_asset_id (ADR-0026): each liquidity container maps to exactly one
-- CASH-class Asset, which is what operation's auto-emitted cash legs settle
-- against. No Transaction, no Category, no Cash Flow Engine yet (deferred
-- V1.1, ADR-0024) — account.type/currency are enough for the cash-leg writer.
CREATE TABLE account (
    id             VARCHAR PRIMARY KEY,
    name           VARCHAR NOT NULL,
    type           VARCHAR NOT NULL,
    currency       VARCHAR(3) NOT NULL,
    cash_asset_id  VARCHAR NOT NULL REFERENCES asset(id)
);

-- portfolio_account — definition, plain CRUD link (ERR-8). Composite PK;
-- no `id` column, per the corrected mv_holding join in ADR-L01 §4.8
-- (pa.portfolio_id, not p.id, which this table never had).
CREATE TABLE portfolio_account (
    portfolio_id  VARCHAR NOT NULL REFERENCES portfolio(id),
    account_id    VARCHAR NOT NULL REFERENCES account(id),
    PRIMARY KEY (portfolio_id, account_id)
);

-- =============================================================================
-- operation — fact, append-only (I-10). The one true financial fact; Holding
-- is a fold over it (ADR-0003). Shape frozen by ADR-L01: the interaction of
-- corrects_id (ADR-0028/RFC-0011), transfer_pair_id (ADR-0028) and
-- cash_leg_of (ADR-0026) on one row, decided by the truth table in
-- ADR-L01 §4.2/§4.3. Cross-row invariants W1-W10 (leg totality, leg shape,
-- no-leg-of-a-leg, transfer pair cardinality, no correction chains,
-- correction pair totality, atomicity, append-only) are NOT DDL-enforced —
-- they are repository-enforced and property-tested (ADR-L01 §4.5). The DDL
-- below enforces only what is row-local: the seven-value type domain, the
-- four sign checks (exempt for CORRECTION and for cash legs per ADR-L01's
-- Premise/UX-0001 §7.1 Option 1), and the four named nullability rules
-- N1-N4 over the three link columns.
-- =============================================================================
CREATE TABLE operation (
    id               VARCHAR PRIMARY KEY,
    type             VARCHAR NOT NULL,
    account_id       VARCHAR NOT NULL REFERENCES account(id),
    asset_id         VARCHAR NOT NULL REFERENCES asset(id),
    trade_date       DATE NOT NULL,                  -- valid time
    quantity         DECIMAL(28,10) NOT NULL,        -- signed
    -- price: NULL on DIVIDEND/COUPON primaries. operation has no `amount`
    -- column and quantity = 0 on income primaries (ADR-0026), so overloading
    -- price with the gross amount was rejected (ADR-L01 §6 open item 1,
    -- orchestrator decision). Gross income is reconstructed as
    -- `leg.quantity + parent.fees`. The importer and the Tax Engine must
    -- both read this contract from here, not reinvent it.
    price            DECIMAL(19,8),
    -- fees: folded into a leg's amount, never counted twice (ADR-L01 W2).
    -- Transfer fees are UNDECIDED at the product level (ADR-L01 §4.3): this
    -- DDL permits a fee-only cash leg on a TRANSFER_IN/TRANSFER_OUT row
    -- (orchestrator decision, matching ADR-L01), but the V1.0 importer is
    -- expected to reject non-zero fees on transfer rows at the application
    -- layer. No CHECK enforces that here, deliberately — it would block a
    -- future decision this schema does not need to pre-empt.
    fees             DECIMAL(19,4) NOT NULL DEFAULT 0,
    currency         VARCHAR(3) NOT NULL,
    import_batch_id  VARCHAR REFERENCES import_batch(id),
    corrects_id      VARCHAR REFERENCES operation(id),   -- ADR-0028
    transfer_pair_id VARCHAR,                            -- ADR-0028; group id, not an FK
    cash_leg_of      VARCHAR REFERENCES operation(id),   -- ADR-0026
    recorded_at      TIMESTAMPTZ NOT NULL,               -- transaction time

    -- type domain: seven values (E10). Skeleton importer emits BUY only.
    CHECK (type IN ('BUY','SELL','DIVIDEND','COUPON',
                    'TRANSFER_IN','TRANSFER_OUT','CORRECTION')),

    -- sign checks (ADR-0028), exempt for CORRECTION by construction and for
    -- cash legs (ADR-L01 Premise / UX-0001 §7.1 Option 1: legs keep their
    -- parent's type and are exempt from that type's sign check)
    CHECK (type <> 'BUY'          OR quantity > 0 OR cash_leg_of IS NOT NULL),
    CHECK (type <> 'SELL'         OR quantity < 0 OR cash_leg_of IS NOT NULL),
    CHECK (type <> 'TRANSFER_IN'  OR quantity > 0 OR cash_leg_of IS NOT NULL),
    CHECK (type <> 'TRANSFER_OUT' OR quantity < 0 OR cash_leg_of IS NOT NULL),

    -- corrects_id non-null <=> type = 'CORRECTION' (ADR-0028)
    CHECK (type <> 'CORRECTION' OR corrects_id IS NOT NULL),
    CHECK (type =  'CORRECTION' OR corrects_id IS NULL),

    -- N1: transfer_pair_id is exclusive with the other two link columns
    CHECK (transfer_pair_id IS NULL OR (cash_leg_of IS NULL AND corrects_id IS NULL)),
    -- N2: pair ids only on transfer-typed rows
    CHECK (transfer_pair_id IS NULL OR type IN ('TRANSFER_IN','TRANSFER_OUT')),
    -- N3: a transfer-typed row is a pair side or a cash leg, never neither
    CHECK (type NOT IN ('TRANSFER_IN','TRANSFER_OUT')
           OR transfer_pair_id IS NOT NULL OR cash_leg_of IS NOT NULL),
    -- N4: no self-reference
    CHECK (corrects_id IS NULL OR corrects_id <> id),
    CHECK (cash_leg_of IS NULL OR cash_leg_of <> id)
);

CREATE INDEX ix_operation_asset_date    ON operation(asset_id, trade_date);
CREATE INDEX ix_operation_cash_leg_of   ON operation(cash_leg_of);       -- W1, W3, W6
CREATE INDEX ix_operation_transfer_pair ON operation(transfer_pair_id);  -- W4, W7
CREATE INDEX ix_operation_corrects_id   ON operation(corrects_id);      -- W5, W6, W7

-- -----------------------------------------------------------------------------
-- bucket_apportionment — fact, temporal append-only, effective-dated
-- supersession (RFC-0009 §3.1). Re-apportioning is a change of mind, not a
-- mistake. Per ADR-0025, VirtualHolding is now a derived read model folded
-- over this table's supersession chains; I-9 (Sigma apportioned <= Holding)
-- became an evaluation-time finding (`over_apportioned`), NOT a write-time
-- invariant, so `quantity >= 0` is the ONLY write-time CHECK here. Do not
-- add a Sigma-apportioned-<=-holding CHECK: that would resurrect Option 1
-- (write-time rejection) which ADR-0025 explicitly rejected.
-- -----------------------------------------------------------------------------
CREATE TABLE bucket_apportionment (
    id              VARCHAR PRIMARY KEY,
    bucket_id       VARCHAR NOT NULL REFERENCES bucket(id),
    asset_id        VARCHAR NOT NULL REFERENCES asset(id),
    quantity        DECIMAL(28,10) NOT NULL CHECK (quantity >= 0),
    effective_from  DATE NOT NULL,
    supersedes_id   VARCHAR REFERENCES bucket_apportionment(id),
    recorded_at     TIMESTAMPTZ NOT NULL
);

-- -----------------------------------------------------------------------------
-- price — fact, bitemporal append-only (asset, valid_date, recorded_at).
-- Owned by the Market context (ADR-0031); Portfolio consumes via PriceView,
-- never joins this table directly. A restatement is a new row with a later
-- recorded_at, never an UPDATE.
-- -----------------------------------------------------------------------------
CREATE TABLE price (
    id           VARCHAR PRIMARY KEY,
    asset_id     VARCHAR NOT NULL REFERENCES asset(id),
    valid_date   DATE NOT NULL,
    close        DECIMAL(19,8) NOT NULL,
    currency     VARCHAR(3) NOT NULL,
    source       VARCHAR NOT NULL,   -- 'seed' | provider id; licence tracked in ADR
    recorded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_price_asset_valid ON price(asset_id, valid_date, recorded_at);

-- -----------------------------------------------------------------------------
-- evaluation_run — fact, immutable (E4). Groups the Alerts from one
-- evaluation; carries as_of, mode, input_digest. scope_kind/scope_id added
-- per ERR-2 (evaluation is Bucket-scoped as well as Portfolio-scoped).
-- mode is required from day one (RFC-0010 §3 V1.0 note) even though
-- candidate/HYPOTHETICAL flows are V1.2 — hypothetical runs are persisted
-- but excluded from every read-side query by default.
-- -----------------------------------------------------------------------------
CREATE TABLE evaluation_run (
    id                   VARCHAR PRIMARY KEY,
    portfolio_id         VARCHAR NOT NULL REFERENCES portfolio(id),
    strategy_id          VARCHAR NOT NULL REFERENCES strategy(id),
    strategy_version_id  VARCHAR NOT NULL REFERENCES strategy_version(id),
    scope_kind           VARCHAR NOT NULL,   -- 'PORTFOLIO' | 'BUCKET' (ERR-2)
    scope_id             VARCHAR NOT NULL,   -- portfolio_id or bucket_id per scope_kind; no FK, heterogeneous target (ERR-2)
    as_of                DATE NOT NULL,           -- domain date evaluated against
    evaluated_at         TIMESTAMPTZ NOT NULL,    -- wall clock
    mode                 VARCHAR NOT NULL,        -- ACTUAL | HYPOTHETICAL
    engine_versions      JSON NOT NULL,           -- {"portfolio":"1.2.0","rule":"1.0.1",...}
    input_digest         VARCHAR NOT NULL,        -- SHA-256 over canonical bound inputs
    CHECK (scope_kind IN ('PORTFOLIO', 'BUCKET')),
    CHECK (mode IN ('ACTUAL', 'HYPOTHETICAL'))
);

-- -----------------------------------------------------------------------------
-- alert — fact, immutable. "A rule evaluation record" (E5): all four
-- outcomes persist, not just FIRED — silence must be reconstructable too
-- (P7). severity promoted to a real column (ERR-1: mv_finding cannot be
-- built without it); NULL for kinds declaring severity = null (ADR-L02:
-- allocation_absent) and for SKIPPED/ERROR outcomes regardless of the
-- kind's declaration. trace is JSON, not STRUCT (ADR-0013). rule_id has NO
-- FK (ADR-0027: there is no `rule` table; rules live in
-- strategy_version.definition and are resolved via this row's
-- run_id -> strategy_version_id). Referential integrity for rule_id is a
-- repository-enforced, property-tested invariant, not a constraint here.
-- -----------------------------------------------------------------------------
CREATE TABLE alert (
    id           VARCHAR PRIMARY KEY,
    run_id       VARCHAR NOT NULL REFERENCES evaluation_run(id),
    rule_id      VARCHAR NOT NULL,      -- logical id; no FK (ADR-0027)
    outcome      VARCHAR NOT NULL,      -- FIRED | NOT_FIRED | SKIPPED | ERROR (E5)
    priority     VARCHAR NOT NULL,
    severity     DECIMAL(19,8),         -- NULL for severity=null kinds and SKIPPED/ERROR (ERR-1)
    trace        JSON NOT NULL,         -- ADR-0013
    recorded_at  TIMESTAMPTZ NOT NULL,
    CHECK (outcome IN ('FIRED', 'NOT_FIRED', 'SKIPPED', 'ERROR'))
);

-- -----------------------------------------------------------------------------
-- recommendation — fact, immutable, 1:1 with a FIRED alert (ADR-0021).
-- Provenance promoted to columns because these are queried and joined
-- (RFC-0009 §4.2). finding_key is the stable natural key
-- sha256(rule_id || scope_id || canonical(condition.params)) that
-- mv_finding groups on (RFC-0008 §4) — deliberately NOT keyed on
-- strategy_version_id, so editing an unrelated Rule does not reset a
-- finding's history. rule_id has NO FK, same reasoning as alert.rule_id
-- (ADR-0027).
--
-- I-12 is enforced by the ABSENCE of columns: there is no `instrument`, no
-- `action`, no `direction`, no `quantity` column on this table. A
-- prescriptive Recommendation is not merely discouraged, it is
-- UNREPRESENTABLE — the §MiFID firewall (ADR-0010) expressed as DDL.
-- DO NOT add an instrument/action/direction/quantity column to this table.
-- -----------------------------------------------------------------------------
CREATE TABLE recommendation (
    id                    VARCHAR PRIMARY KEY,
    alert_id              VARCHAR NOT NULL REFERENCES alert(id),
    run_id                VARCHAR NOT NULL REFERENCES evaluation_run(id),
    strategy_version_id   VARCHAR NOT NULL REFERENCES strategy_version(id),
    rule_id               VARCHAR NOT NULL,   -- logical id; no FK (ADR-0027)
    finding_key           VARCHAR NOT NULL,   -- sha256(rule_id||scope_id||canonical(params)), RFC-0008 §4
    observation           VARCHAR NOT NULL,   -- what is true
    rationale             VARCHAR NOT NULL,   -- why it matters, per the Strategy
    suggestion_class      VARCHAR,            -- nullable, non-instrument (E7)
    input_refs            JSON NOT NULL,      -- ["op:...","price:...","reading:..."]
    recorded_at           TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_recommendation_finding_key ON recommendation(finding_key);

-- -----------------------------------------------------------------------------
-- snapshot — derived checkpoint, never a source of truth. Rebuildable from
-- facts; may be dropped and regenerated. Shares run_id with the Alerts
-- produced in the same evaluation, so "what did my portfolio look like when
-- this Recommendation appeared" is a single join. Written on every evaluate
-- run, per RFC-0009 §5.1.
-- -----------------------------------------------------------------------------
CREATE TABLE snapshot (
    id            VARCHAR PRIMARY KEY,
    portfolio_id  VARCHAR NOT NULL REFERENCES portfolio(id),
    as_of         DATE NOT NULL,
    run_id        VARCHAR REFERENCES evaluation_run(id),
    total_value   DECIMAL(19,4) NOT NULL,
    currency      VARCHAR(3) NOT NULL,
    allocation    JSON NOT NULL,   -- {"EQUITY_DEVELOPED":{"value":"...","weight":"..."}}
    by_bucket     JSON NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- Derived models (mv_ prefix). Rebuildable from facts. Never a source of
-- truth (RFC-0009 §3). Created from day one even though the skeleton has
-- n=1 evaluation (RFC-0008 §10 skeleton scope note).
-- =============================================================================

-- mv_holding — Holding as a fold over operation (ADR-0003).
--
-- DEFECT FIXED (ADR-L01 §4.8): the corpus's WHERE o.type IN (...) filter
-- (RFC-0009 §3.4's original list, and ADR-0028's revised five/six-value
-- list) silently drops every DIVIDEND/COUPON cash leg, because a leg
-- carries its PARENT's type (ADR-L01 Premise) and neither DIVIDEND nor
-- COUPON was ever in the filter list. That would make Net Worth quietly
-- short by exactly the income received. The fix is to drop the type filter
-- entirely: every operation row's quantity is already a signed change in
-- the units of its own asset_id (securities for primaries, currency units
-- for cash legs), and DIVIDEND/COUPON primaries carry quantity = 0, so
-- including them is a no-op. A filter-free fold is also self-maintaining
-- as the type enum widens.
--
-- DEFECT FIXED (ADR-L01 §4.8 / RFC-0011 ERR-8): RFC-0009 §3.4 selected
-- `p.id` from `portfolio_account` aliased `p` — a column that table never
-- had (its PK is the composite (portfolio_id, account_id), ERR-8). Uses
-- pa.portfolio_id instead.
CREATE VIEW mv_holding AS
SELECT o.asset_id, pa.portfolio_id, SUM(o.quantity) AS quantity
FROM operation o
JOIN portfolio_account pa ON pa.account_id = o.account_id
GROUP BY 1, 2
HAVING SUM(o.quantity) <> 0;

-- mv_finding — deduplication belongs on the read side (ADR-0021, RFC-0008
-- §4). Recommendation stays immutable and 1:1 with a FIRED alert; this view
-- groups repeated firings of the same finding_key across runs into one row.
-- Filtered to mode = 'ACTUAL': a hypothetical firing must never appear in
-- the recommendations list. current_severity / current_priority /
-- priority_rank read the LATEST occurrence (arg_max by recorded_at), so a
-- finding's displayed urgency reflects its most recent evaluation, not its
-- first. Ordered per RFC-0008 §3's contract:
--   ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC
-- (NULLS LAST is deliberate: a kind that cannot express its own urgency,
-- e.g. allocation_absent per ADR-L02, must not outrank one that can.)
CREATE VIEW mv_finding AS
SELECT
    r.finding_key,
    r.rule_id,
    arg_min(r.id, r.recorded_at)  AS first_recommendation_id,
    arg_max(r.id, r.recorded_at)  AS latest_recommendation_id,
    min(run.as_of)                AS first_seen,
    max(run.as_of)                AS last_seen,
    count(*)                      AS occurrences,
    arg_max(a.severity, r.recorded_at) AS current_severity,
    arg_max(a.priority, r.recorded_at) AS current_priority,
    arg_max(
        CASE a.priority
            WHEN 'CRITICAL' THEN 5
            WHEN 'HIGH'     THEN 4
            WHEN 'MEDIUM'   THEN 3
            WHEN 'LOW'      THEN 2
            WHEN 'INFO'     THEN 1
        END,
        r.recorded_at
    ) AS priority_rank
FROM recommendation r
JOIN alert a            ON a.id = r.alert_id
JOIN evaluation_run run ON run.id = r.run_id
WHERE run.mode = 'ACTUAL'
GROUP BY r.finding_key, r.rule_id
ORDER BY priority_rank DESC, current_severity DESC NULLS LAST, r.rule_id ASC;

-- Migration marker. Written last: presence of this row is what the startup
-- migration runner checks to know 001 has fully applied.
INSERT INTO schema_version (version, applied_at) VALUES (1, current_timestamp);
