# Portfolio context — what is held, and what it is worth

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.
Machine-readable form: `../semantic/entities.yaml` (`context: portfolio`).

`src/financeos/core/portfolio/`

## The governing idea

**Quantity is never stored anywhere it could drift from the facts that produced it.**

This one rule generates most of the context's shape. An `Asset` carries no quantity (**ADR-0003**).
`Operation` carries the signed change. `Holding` is the *fold* of Operations, computed and never
authored — because a stored mutable quantity would let a position change with no corresponding
`Operation`, which is unauditable and the most likely source of silent divergence in the system.

The same pattern repeats one level down (**ADR-0025**): the authored fact is the
`bucket_apportionment` row, and `VirtualHolding` is the projection of its supersession chain at
`as_of`.

## Aggregate roots

### `Portfolio` — `portfolio.py:6`

```
id: PortfolioId · name: str · accounts: tuple[AccountId, ...]
```

Deliberately thin: an identity plus the set of Accounts in scope. It does **not** contain Holdings.
Table `portfolio`, with a `portfolio_account` link table (DDL supplied by **ERR-8**).

### `Bucket` — `portfolio.py:17`

```
id: BucketId · portfolio_id: PortfolioId · strategy_id: StrategyId · name: str
```

A pot of one Portfolio's capital, governed by one Strategy. Both foreign keys are **non-nullable**
(**ERR-9**, **I-3**).

Also thin — since **ADR-0025** moved apportionment *out* of the aggregate, the Bucket's
transactional boundary contains no apportionment state at all.

> A `Strategy` is a **policy applied per Bucket** (**ADR-0020**), not a per-Bucket instance.
> Several Buckets may be governed by the same Strategy. A Bucket is governed by exactly one
> (**I-3**) — which is exactly why `SKIPPED(heterogeneous_strategies)` has to exist.

### `Asset` — `asset.py:28`

```
id: AssetId · name: str · asset_class: AssetClass · currency: Currency
identifiers: tuple[AssetIdentifier, ...]
```

What an instrument *is*, independent of how much of it is held. `AssetIdentifier` (`asset.py:21`)
carries a `scheme` from `IdentifierScheme` — `ISIN | TICKER | INTERNAL` — and one Asset may carry
several.

`asset_class` is **mutable in place** under the correction model (**ADR-0012**), but a
reclassification must be accompanied by an `asset_classification_audit` row (**E6**). That is a
**repository** concern, not a model validator — the model cannot see whether the audit row was
written.

`AssetClass` itself lives in `core/shared/ids.py:39`, not here. See
[`bounded-contexts.md`](bounded-contexts.md) for why (C3 + **I-14**).

### `Operation` — `operation.py:53`

The atomic financial fact. **Append-only** (**I-10**, contract **C6**): no setters, no repository
update path, no delete. Corrections are compensating `CORRECTION` rows (**ADR-0028**), never
mutations.

```
id · type: OperationType · account_id · asset_id · trade_date
quantity: Quantity          # SIGNED change in units
price: PriceAmount | None   # None on DIVIDEND/COUPON primaries (quantity == 0)
fees: MoneyAmount · currency · import_batch_id
corrects_id · transfer_pair_id · cash_leg_of · recorded_at
```

`OperationType` (`operation.py:32`) has **seven** members (**E10**, **ADR-0028**):
`BUY`, `SELL`, `DIVIDEND`, `COUPON`, `TRANSFER_IN`, `TRANSFER_OUT`, `CORRECTION`.

> `TRANSFER` is **deliberately absent**. A transfer is two-sided by nature and is represented as a
> `TRANSFER_OUT`/`TRANSFER_IN` pair sharing one `transfer_pair_id`. Do not add `TRANSFER`.

**Where invariants live, and why the split matters.** The constructor enforces exactly the
**row-local** rules — the **ADR-L01** truth table over `corrects_id` × `transfer_pair_id` ×
`cash_leg_of`, plus the sign checks — and migration `001_init.sql` encodes the same rules as `CHECK`
constraints. Cross-row invariants (leg totality, pair cardinality, no correction chains) are
**repository-enforced by design**, because a single `Operation` cannot see its sibling. Those are
the W1–W10 property checks in `adapters/duckdb/repositories/operation.py`, pinned by
`tests/test_operation_repository_invariants.py`.

Sign rules, from `_check_sign`: `BUY`/`TRANSFER_IN` require `quantity > 0`; `SELL`/`TRANSFER_OUT`
require `quantity < 0`; a `CORRECTION` carries a signed delta and is exempt; an auto-emitted cash
leg keeps its parent's type and is exempt from that type's sign check (**ADR-0026**).

## Derived read models

None of these has a table of its own except through a view. All are rebuildable.

| Type | Code | Derived from | Notes |
|---|---|---|---|
| `Holding` | `holding.py:27` | `Operation` (fold) | SQL half is the `mv_holding` **view**. **ADR-0003**. |
| `VirtualHolding` | `holding.py:40` | `ApportionmentRecord` chain | `.as_holding()` projects it for Bucket-scoped valuation. **ADR-0025**, **E3**. |
| `AllocationLine` | `holding.py:53` | `Holding` + `PriceView` | One AssetClass's value and share of a scope. |
| `AllocationBreakdown` | `holding.py:62` | ditto | The Portfolio Engine's output. |
| `ApportionmentLine` | `apportionment.py:32` | records × `Holding` | The two operands **I-9** compares. |
| `ResidualComputation` | `residual.py:13` | Portfolio-wide fold | The `UNASSIGNED` pseudo-bucket. **ADR-0029**. |

### `AllocationLine` vs `DriftLine` — the asymmetry that matters

`AllocationLine` covers **every held class**, targeted or not. `DriftLine` (Strategy context) covers
**targeted leaves only**. That asymmetry is exactly why `untargeted_allocation` needs *both*
`FACT_ALLOCATION` and `FACT_TARGETS`: it must find classes that are held but *not* in the target
tree, which neither family alone can express.

### `AllocationBreakdown.is_complete`

`unpriced_assets` lists held Assets for which no price was supplied. A breakdown carrying any of
them is **incomplete**, and consuming it would produce a **partial denominator**, which
**RFC-0007 §4.1** forbids. The Strategy Engine therefore **skips** rather than computing a weight
against a total it knows is wrong.

### `ApportionmentRecord` — the authored fact

`apportionment.py:20`, table `bucket_apportionment`. Every row ever written, current or superseded,
linked by `supersedes_id`.

> **AUTHORED DATA.** There is no recovery path but `financeos export --authored`. Run it after every
> migration and before every schema change.

Re-apportioning is a change of mind, not a mistake — so a superseded row is not noise to discard,
it is precisely what the supersession chain is reconstructed *from*. Dropping superseded rows on
export would silently lose history that `virtual_holdings` never carried in the first place.

### `ApportionmentLine` — and why the model asserts its own invariant

```python
if self.apportioned_quantity <= 0:
    raise InvariantViolationError(...)
```

`over_apportioned`'s severity denominator is `Σ apportioned_quantity`. That sum is only *provably*
non-zero on the firing set if no line is ever constructed at `apportioned_quantity <= 0`
(**ADR-L04 §4.4 D5**). The producer (`portfolio_engine.compute_apportionment`) already guarantees
it; the model states it too, so the guarantee does not depend on one call site staying correct.

### `ResidualComputation` — signed, and deliberately so

`unassigned_value` is `total_value` minus every Bucket's apportioned share, **signed**. It may be
**negative** when `Σ apportioned` exceeds a Holding — that is **I-9**'s territory and
`over_apportioned`'s subject. **A deficit, not a defect.**

## Behaviours here that look like bugs

- **Over-apportionment warns, never blocks** (**I-9** as revised by **ADR-0025**). You can commit
  more units of an Asset to Buckets than you hold; the system reports it as a finding rather than
  rejecting the write.
- **Untargeted and unassigned capital stays in the denominator** (**ADR-0029**). The resulting
  scatter of small under-allocation findings is the honest reading, not noise to filter.
- **`UNASSIGNED` weight may be negative.** Same signed reading as above.
- **There is no `holding` table.** Correct — see **ADR-0003**.
- **There is no `Account` aggregate**, though `AccountId`, the `account` table and a repository DTO
  all exist. See [`gaps-specified-not-built.md`](gaps-specified-not-built.md).

## Engine

`portfolio_engine.py` — `compute_holdings`, `compute_allocation`, `compute_apportionment`,
`compute_residual`. Pure functions, no ports (**I-7** / **C2**), and **no engine calls another
engine**. Composition happens in `app/evaluate_strategy.py`; see
[`evaluation-pipeline.md`](evaluation-pipeline.md).
