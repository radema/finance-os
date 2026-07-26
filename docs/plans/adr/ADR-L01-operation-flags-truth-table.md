# ADR-L01 — `operation` link-flag truth table: `corrects_id` × `transfer_pair_id` × `cash_leg_of`

| | |
|---|---|
| **Status** | Accepted (build-blocker resolution) |
| **Date** | 2026-07-26 |
| **Resolves** | RFC-0011 §8.3 (open question 3), assigned to skeleton task 3 (RFC-0005 §8.4 task 3 / task 10) |
| **Depends on** | ADR-0026 (cash legs), ADR-0028 (`OperationType` widened, E10), ADR-0011 / I-10 (append-only), RFC-0009 §3.1 (`operation` DDL), RFC-0009 §7.2 (schema-change classes) |
| **Blocks** | `001_init.sql` CHECK constraints; the paired-Operation writer in `app/` (RFC-0005 §3) |
| **Premise** | UX-0001 §7.1 Option 1 — cash legs are exempt from sign checks and keep their parent's `type` (see §Premise below) |
| **Scope note** | Skeleton emits `BUY` only. This ADR fixes the *shape* 001 freezes, not the skeleton's importer scope. |

---

## 1. Context

`operation` is the one true fact table (I-10: immutable, append-only; ADR-0003: `Holding` is a fold over it). Three separate decisions each added a nullable self-referencing link column to it:

- **`corrects_id`** — RFC-0009 §3.1, tightened by ADR-0028: non-null exactly on `CORRECTION` rows; the target must exist and must not itself be a `CORRECTION` (no chains).
- **`transfer_pair_id`** — ADR-0028: the same UUID on the two rows (`TRANSFER_OUT` on the source account, `TRANSFER_IN` on the destination) of one two-sided movement, written atomically.
- **`cash_leg_of`** — ADR-0026: non-null on auto-emitted cash legs, pointing at the Operation whose cash effect the leg records.

Each was specified in isolation. RFC-0011 §8.3 records the consequence:

> *"…the interaction of `corrects_id`, `transfer_pair_id`, and `cash_leg_of` on one row deserves a truth table before migration 001 freezes — assigned to the skeleton's task 3."*

Two forces make this urgent rather than tidy-up work:

1. **RFC-0009 §7.2 forbids in-place retyping of a fact table** ("Rename or retype: new column, backfill, dual-read one release, drop later. Never in-place on a fact table"), and DuckDB's `ALTER TABLE` cannot add a CHECK constraint to an existing table. A constraint omitted from 001 costs a table rebuild, and every constraint here is row-local and therefore free to write now.
2. **The skeleton writes `BUY` only** (RFC-0005 §8.1) — so the skeleton itself cannot discover a wrong shape. The first `TRANSFER_IN`/`CORRECTION`/cash-leg row appears in V1.0 (RFC-0011 §5), by which point the table has real history.

### Premise: cash-leg `type` (UX-0001 §7.1)

UX-0001 §7.1 reports, correctly, that ADR-0026 never says what `operation.type` holds on an auto-emitted leg, that mirroring the parent's type violates ADR-0028's own sign checks (a `BUY`'s cash leg is negative), and that this **blocks the present truth table**. Its three options are: (1) exempt legs from sign checks, keeping the parent's type; (2) type legs as `TRANSFER_IN`/`TRANSFER_OUT`; (3) add `CASH_IN`/`CASH_OUT`, widening E10 to nine values.

This ADR **adopts Option 1** — UX-0001's own recommendation — as its premise: legs keep the parent's `type`, and the sign checks gain a leg exemption exactly as they already have a `CORRECTION` exemption. Reasons: E10 stays at seven values and needs no further product ratification; the leg still records *why* the cash moved, which the Tax Engine (V2) will want; and Option 2 is explicitly rejected by UX-0001 for the same reason this ADR rejects combining `transfer_pair_id` with `cash_leg_of` (§4, rule N1).

**The truth table below is invariant under all three options.** Only the `type` column of a leg row and the presence of the sign-check exemptions change. If a sibling ADR (UX-0001 calls it ADR-0032) ratifies Option 3 instead, rules N1–N4 and W1–W10 stand unchanged and 001's `CHECK (type IN …)` list widens by two values.

---

## 2. Decision Drivers

- **Decidability.** Migration 001 and the paired writer must both be derivable from one table with no residual judgment. "Deserves a truth table" (RFC-0011 §8.3) means: every combination classified, every legal one given its write-time invariant.
- **One column, one meaning.** Reusing a link column for a second relationship is how the `rule_id` collision in ADR-0027 happened. Not twice.
- **Cheap integrity queries.** The invariants that cannot be CHECKs must be one-query checkable, so they can be repository-enforced *and* property-tested (the posture ADR-0027 established when it dropped the `rule` FK and bought it back with a named property test).
- **P7 / no silent state repair.** A half-written pair (leg without parent, one transfer side, a correction of a security with no correction of its cash) is unrepairable under I-10 except by a further correction. Partial sets must be unrepresentable, not merely discouraged.
- **The Operation log must always be able to record reality** (ADR-0025's argument). Constraints here are about *internal consistency of one recorded event*, never about rejecting a fact that happened.
- **Nothing frozen in 001 may break V1.0** (ADR-0026 cash legs, ADR-0028 transfers + corrections).

---

## 3. Considered Options

The design space is the meaning of `transfer_pair_id` on a row that is also a correction or a leg.

1. **Free combination.** All three columns independently nullable; meaning resolved by convention in the writer. Rejected: it leaves RFC-0011 §8.3 exactly where it was, and it forfeits every DDL guarantee that is available for free.
2. **`transfer_pair_id` reused on correction rows** — a correction of a transfer side carries the original pair id. Rejected: four rows then share one pair id, and the invariant that makes transfer integrity checkable in one query (*exactly two rows, one `TRANSFER_IN`, one `TRANSFER_OUT`, summing to zero*) is destroyed. It is also the ADR-0027 mistake in miniature: one identifier, two populations.
3. **`transfer_pair_id` minted afresh to link the two correction rows to each other.** Rejected: the column would carry two meanings ("sides of one movement" and "members of one correction set"), and the second population cannot satisfy the first's typing invariant, since both rows are `CORRECTION`.
4. **`transfer_pair_id` exclusive with both other link columns; correction pairing derived through `corrects_id`; correction cash legs carry both `corrects_id` and `cash_leg_of`.** Chosen.

Within option 4 one sub-choice remained: whether the cash side of a correction is *(a)* a plain `CORRECTION` targeting the original leg (`cash_leg_of` NULL), or *(b)* itself a cash leg — `corrects_id` → the original leg **and** `cash_leg_of` → the sibling correction row. **(b) is chosen**: it makes the correction of a legged Operation byte-for-byte the same *shape* as the original legged write (one primary + one leg), so the writer has one code path; it makes the pairing check row-local (`c'.cash_leg_of = c.id`) instead of a two-hop walk; and it keeps ADR-0026's V1.1 promise intact — an imported bank `Transaction` is deduplicated "against the `cash_leg_of` link", which only works if corrective cash movements also carry that link.

---

## 4. Decision Outcome

### 4.1 The rule, in one sentence

> **`transfer_pair_id` is mutually exclusive with both `corrects_id` and `cash_leg_of`. `corrects_id` and `cash_leg_of` are freely combinable.**

### 4.2 Truth table over the three link columns

`•` = non-null, `∅` = NULL. Five of eight combinations are legal.

| # | `corrects_id` | `transfer_pair_id` | `cash_leg_of` | Verdict | Row this is, and why |
|---|---|---|---|---|---|
| 1 | ∅ | ∅ | ∅ | **LEGAL** | Primary economic row: `BUY`, `SELL`, `DIVIDEND`, `COUPON`. Its cash leg exists as a *separate* row (#2) pointing back at it; leg-ness is never recorded on the parent. |
| 2 | ∅ | ∅ | • | **LEGAL** | Auto-emitted cash leg (ADR-0026) of a primary row or of a transfer side. Carries the parent's `type`, exempt from sign checks (§Premise). |
| 3 | ∅ | • | ∅ | **LEGAL** | One side of a transfer pair: `TRANSFER_IN` (qty > 0) or `TRANSFER_OUT` (qty < 0), ADR-0028. |
| 4 | ∅ | • | • | **ILLEGAL** | A row cannot be both a side of a two-sided event and the derived cash counterpart of another row. A leg of a transfer side carries `cash_leg_of` only and does **not** inherit the pair id — its pairing is reachable through its parent. Allowing this breaks the *exactly-two-rows-per-pair-id* cardinality invariant (W4), which is the only cheap transfer-integrity check available, and it is the precise ambiguity UX-0001 §7.1 rejects Option 2 for. |
| 5 | • | ∅ | ∅ | **LEGAL** | Correction primary (`type = 'CORRECTION'`, ADR-0028): a signed delta against `corrects_id`. This is the shape for correcting a `BUY`/`SELL`/`DIVIDEND`/`COUPON` **or** a transfer side. |
| 6 | • | ∅ | • | **LEGAL — and mandatory** | The cash side of a correction: `corrects_id` → the *original leg*, `cash_leg_of` → the *sibling correction primary* (#5) written in the same transaction. Required whenever the corrected row has a leg (W6). |
| 7 | • | • | ∅ | **ILLEGAL** | A correction never carries `transfer_pair_id` — neither the original value (option 2 above) nor a fresh one (option 3). Pairing of transfer corrections is *derived*: `corrects_id → target.transfer_pair_id`. |
| 8 | • | • | • | **ILLEGAL** | Union of #4 and #7. |

Read column-wise, the table says: `transfer_pair_id` non-null ⟹ both other links NULL; and the only row that legitimately carries two links at once is #6.

### 4.3 The same table, per `type`

| `type` | May carry `corrects_id` | May carry `transfer_pair_id` | May carry `cash_leg_of` | Sign constraint |
|---|---|---|---|---|
| `BUY` | never | never | yes (then it is the leg) | `quantity > 0` unless leg |
| `SELL` | never | never | yes (then it is the leg) | `quantity < 0` unless leg |
| `DIVIDEND` | never | never | yes (then it is the leg) | none — primary carries `quantity = 0` (ADR-0026) |
| `COUPON` | never | never | yes (then it is the leg) | none — as `DIVIDEND` |
| `TRANSFER_IN` | never | **required** unless leg | yes (then it is a fee leg) | `quantity > 0` unless leg |
| `TRANSFER_OUT` | never | **required** unless leg | yes (then it is a fee leg) | `quantity < 0` unless leg |
| `CORRECTION` | **required** | never | yes (then it is the correction's cash side) | exempt (ADR-0028) |

`corrects_id` non-null ⟺ `type = 'CORRECTION'` is unchanged from ADR-0028. A transfer-typed row is **either** a pair side **or** a cash leg, never neither — which is what makes "every transfer side has a pair id" DDL-expressible despite fee legs existing.

*Transfer fee legs:* the corpus never states whether a `TRANSFER_OUT` with a non-zero `fees` emits a fee-only cash leg. This ADR makes 001's shape **permit** it (row #2 with a transfer type) and leaves V1.0's importer emitting `fees = 0` on transfer rows — an application-level scope limit, not a DDL one, so allowing fee legs later is a code change and not a migration.

### 4.4 Named nullability rules (DDL-expressible, row-local)

- **N1** `transfer_pair_id IS NULL OR (cash_leg_of IS NULL AND corrects_id IS NULL)` — the §4.1 sentence.
- **N2** `transfer_pair_id IS NULL OR type IN ('TRANSFER_IN','TRANSFER_OUT')` — pair ids only on transfer types.
- **N3** `type NOT IN ('TRANSFER_IN','TRANSFER_OUT') OR transfer_pair_id IS NOT NULL OR cash_leg_of IS NOT NULL` — a transfer-typed row is a pair side or a leg.
- **N4** no self-reference: `corrects_id <> id`, `cash_leg_of <> id`.

### 4.5 Write-time invariants (repository-enforced, property-tested)

These cannot be CHECK constraints (they span rows), so they follow ADR-0027's precedent: enforced at the application boundary, guarded by a named property test in the RFC-0008 §9 table. Each is one query.

| | Invariant |
|---|---|
| **W1** | **Leg totality.** Every `BUY`, `SELL`, `DIVIDEND`, `COUPON` primary has **exactly one** row with `cash_leg_of = its id`, written in the same repository transaction with the same `import_batch_id`. |
| **W2** | **Leg shape.** `leg.account_id = parent.account_id`; `leg.asset_id = account.cash_asset_id` (ADR-0026); `leg.currency = account.currency`; `leg.price = 1` (CASH at par); `leg.trade_date = parent.trade_date`; `leg.fees = 0` — fees are folded into the leg's amount and must never be counted twice. Amounts per ADR-0026: `BUY` → `−(q × p) − fees`; `SELL` → `+(q × p) − fees`; `DIVIDEND`/`COUPON` → `+amount`. |
| **W3** | **No leg of a leg.** The row named by `cash_leg_of` must have `cash_leg_of IS NULL`. (The analogue of ADR-0028's no-correction-chains rule.) |
| **W4** | **Transfer pair cardinality.** For each `transfer_pair_id`: exactly two rows; one `TRANSFER_IN` with `quantity > 0` and one `TRANSFER_OUT` with `quantity < 0`; same `asset_id`; distinct `account_id`; `SUM(quantity) = 0`; same `trade_date`; same `import_batch_id`; one transaction. This is what makes ADR-0028's "a portfolio-internal transfer nets to zero in `mv_holding` by construction" literally true rather than aspirational. |
| **W5** | **No correction chains** (ADR-0028, restated). `target.type <> 'CORRECTION'`; the target row must exist. |
| **W6** | **Correction pair totality — cash.** If the corrected row has a leg `L`, the same transaction contains exactly one row with `type = 'CORRECTION'`, `corrects_id = L.id`, `cash_leg_of = <the correction of L's parent>.id`. Conversely, a `CORRECTION` whose `corrects_id` targets a leg **must** carry `cash_leg_of`: a bare correction of a leg is illegal. |
| **W7** | **Correction pair totality — transfer.** If the corrected row carries `transfer_pair_id = P`, the same transaction contains exactly one `CORRECTION` targeting the *other* row of `P`, and the two deltas are equal and opposite (`Δ_in = −Δ_out`). One movement of N units was mis-recorded by one amount, on both sides. |
| **W8** | **Correction leg amount.** The correction leg's `quantity` is `f(intended) − f(original)` under W2's formula for the parent's type — i.e. the delta that makes the cash effect right, not a re-statement of it. |
| **W9** | **Atomicity.** Every set above is one repository transaction sharing one `import_batch_id`. A partial set is unrepresentable at the write boundary; under I-10 it would be unrepairable except by a further correction. |
| **W10** | **Append-only** (I-10, RFC-0005 §5.2): no `UPDATE`, no `DELETE`, enforced in the application layer plus the CI contract. Nothing in this ADR relaxes it. |

### 4.6 Worked cases

**Correcting a `BUY` (quantity was 100, should be 90).** Two rows, one transaction:

| | `type` | `asset_id` | `quantity` | `corrects_id` | `cash_leg_of` |
|---|---|---|---|---|---|
| C | `CORRECTION` | the ETF | `−10` | the `BUY` | ∅ |
| CL | `CORRECTION` | account's CASH asset | `+ (10 × p)` | the `BUY`'s leg | **C** |

Row C is table row #5, row CL is table row #6. Identical shape to the original `BUY` + leg — same writer code path.

**Correcting only the fees of a `BUY`.** Same two rows; C carries `quantity = 0` and the fee delta, CL carries the cash delta. `CORRECTION` is exempt from sign checks, so `quantity = 0` is legal, and `mv_holding`'s `HAVING SUM(quantity) <> 0` is unaffected. Pairing stays total: **there is no such thing as a cash-only or security-only correction of a legged Operation.** The cost is an occasional zero-delta row; the benefit is that W6 has no exceptions.

**Correcting a transfer pair (12 units moved, should have been 15).** Two `CORRECTION` rows, `transfer_pair_id` NULL on both, one transaction:

| | `type` | `quantity` | `corrects_id` | `transfer_pair_id` |
|---|---|---|---|---|
| C₁ | `CORRECTION` | `−3` | the `TRANSFER_OUT` | ∅ |
| C₂ | `CORRECTION` | `+3` | the `TRANSFER_IN` | ∅ |

Both are table row #5. Δ sums to zero (W7), so the movement still nets to zero in the fold. The set is recoverable by reading `corrects_id → target.transfer_pair_id`; no new pair id is minted. If either side had a fee leg, each gains its own row #6.

### 4.7 What migration `001_init.sql` must contain

All three columns and every rule above, now — even though the skeleton emits `BUY` only.

```sql
CREATE TABLE operation (
    id               UUID PRIMARY KEY,
    type             VARCHAR NOT NULL,
    account_id       UUID NOT NULL REFERENCES account(id),
    asset_id         UUID NOT NULL REFERENCES asset(id),
    trade_date       DATE NOT NULL,
    quantity         DECIMAL(28,10) NOT NULL,      -- signed
    price            DECIMAL(19,8),
    fees             DECIMAL(19,4) NOT NULL DEFAULT 0,
    currency         VARCHAR(3) NOT NULL,
    import_batch_id  UUID REFERENCES import_batch(id),
    corrects_id      UUID REFERENCES operation(id),   -- ADR-0028
    transfer_pair_id UUID,                            -- ADR-0028; group id, not an FK
    cash_leg_of      UUID REFERENCES operation(id),   -- ADR-0026
    recorded_at      TIMESTAMPTZ NOT NULL,

    -- type domain: seven values (E10). Skeleton importer emits BUY only.
    CHECK (type IN ('BUY','SELL','DIVIDEND','COUPON',
                    'TRANSFER_IN','TRANSFER_OUT','CORRECTION')),

    -- sign checks (ADR-0028), exempt for CORRECTION by construction and for cash legs (Premise)
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

CREATE INDEX ix_operation_asset_date   ON operation(asset_id, trade_date);
CREATE INDEX ix_operation_cash_leg_of  ON operation(cash_leg_of);      -- W1, W3, W6
CREATE INDEX ix_operation_transfer_pair ON operation(transfer_pair_id); -- W4, W7
CREATE INDEX ix_operation_corrects_id  ON operation(corrects_id);      -- W5, W6, W7
```

Writing the seven-value CHECK now does not pre-empt E10's product ratification: it is a permissive superset over a table that will contain `BUY` rows only until V1.0, and tightening or widening a CHECK at that point is trivial, whereas retyping a populated fact table is what RFC-0009 §7.2 forbids.

### 4.8 Consequence for `mv_holding` — a defect this ADR forces into the open

RFC-0009 §3.4 defines `mv_holding` with `WHERE o.type IN ('BUY','SELL','TRANSFER')`; ADR-0028 revises the list to `('BUY','SELL','TRANSFER_IN','TRANSFER_OUT','CORRECTION')`. **Under the §Premise typing, that filter silently drops every `DIVIDEND` and `COUPON` cash leg** — those legs carry their parent's type, and neither type is in the list. Dividend and coupon cash would therefore never enter the CASH fold, and V1.0's headline Net Worth would be quietly short by exactly the income received: a plausible-looking wrong number, the failure class ADR-0026 exists to prevent.

The fix is to drop the type filter entirely. After ADR-0026 and ADR-0028, **every** `operation` row's `quantity` is a signed change in the units of its own `asset_id` — securities for primary rows, currency units for cash legs — and `DIVIDEND`/`COUPON` primaries carry `quantity = 0`, so including them is a no-op. A filter-free fold is also self-maintaining as the enum widens.

```sql
CREATE VIEW mv_holding AS
SELECT o.asset_id, pa.portfolio_id, SUM(o.quantity) AS quantity
FROM operation o
JOIN portfolio_account pa ON pa.account_id = o.account_id
GROUP BY 1, 2
HAVING SUM(o.quantity) <> 0;
```

Two smaller errata in the same view, both to be fixed in 001: RFC-0009 §3.4 aliases `portfolio_account` as `p` and selects `p.id`, a column `portfolio_account` does not have (its PK is `(portfolio_id, account_id)` per ERR-8) — it must be `pa.portfolio_id`; and the view is per-`(asset, portfolio)`, so a leg's CASH quantity lands under the portfolio owning the account, which is what ADR-0026 intends.

---

## 5. Consequences

**Positive**

- RFC-0011 §8.3 is closed with a decision table, and skeleton task 3 is unblocked. Migration 001 is fully determined; nothing about transfers, corrections, or cash legs needs a second migration on a populated fact table.
- The one-sentence rule (§4.1) is memorable and every part of it is a row-local CHECK. Only genuinely cross-row properties (W1–W9) live in the repository, and each is one query — so each is property-testable, the posture ADR-0027 already paid for.
- Correcting a legged Operation has the same shape as writing one (primary + leg). One writer, one reader, one test shape.
- `transfer_pair_id` keeps exactly one meaning, so W4 stays a one-query integrity check and ADR-0028's nets-to-zero claim becomes enforced rather than asserted.
- ADR-0026's V1.1 `Transaction` dedup ("match against the `cash_leg_of` link") extends to corrective cash movements for free, because correction legs carry that link.
- A real defect in `mv_holding` (§4.8) was found before 001 rather than after the first dividend.

**Negative / accepted costs**

- **Row #6 carries two link columns**, which is the one place a reader must hold two relationships in mind at once. Mitigated by its being the *only* such case, and by the shape symmetry that motivates it.
- **Zero-delta correction rows exist** (correcting only fees writes a `quantity = 0` primary). Accepted: a delta of zero is an accurate delta, and the alternative is an exception to W6.
- **Four cross-row invariants are application-enforced, not DDL-enforced** (W1, W4, W6, W7). This is the third place the corpus makes that trade after I-10 under DuckDB and `alert.rule_id` (ADR-0027 Consequences). Each needs its named property test before V1.0 writes its first non-`BUY` row.
- **Transfer fee legs are permitted by the schema and not emitted by V1.0.** A deliberate gap: the shape is ready, the importer scope is not.
- **This ADR takes a premise on UX-0001 §7.1** rather than waiting for its ADR. If Option 3 (`CASH_IN`/`CASH_OUT`) is ratified instead, §4.7's type CHECK widens by two values and the four sign-check leg exemptions become unnecessary; nothing else changes.

---

## 6. Open items for the product owner

1. **`DIVIDEND` / `COUPON` primary rows have nowhere to put the amount.** ADR-0026 says the primary "carries the cash amount and zero quantity change on the security", but `operation` has no `amount` column and `quantity = 0` makes `quantity × price` zero. Either the primary stores the gross amount in `price` (documented overload, no migration) or it stores nothing and the gross is reconstructed as `leg.quantity + parent.fees`. The truth table is invariant either way, but 001's column comments should say which. Recommend the second (no overload), with `price` left NULL on income rows.
2. **Transfer fees** (§4.3). Confirm that V1.0 may reject non-zero `fees` on `TRANSFER_IN`/`TRANSFER_OUT` at import, deferring fee legs to V1.1.
3. **Whether W1's leg totality admits an exception** for an externally-funded `BUY` (cash that never sat in a tracked Account). V1.0's model says no — every Account has a `cash_asset_id`, so the cash is always somewhere — but the first real import will test that claim.
