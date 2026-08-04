# Market and Cashflow contexts

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.

The two smallest contexts. Grouped here because neither warrants its own page yet — Market holds one
type, Cashflow holds none.

---

## `market` — every external observation

`src/financeos/core/market/` — `price.py` (29 lines) and `__init__.py` (6 lines). That is the whole
context.

### The charter

**ADR-0031** / **E11** widened Market's charter from *indicators* to **all external observations,
prices included**. The reason is not taxonomy, it is **egress containment**:

> Market owns every external observation, prices included, so that egress lives behind **one**
> context (Privacy First, RFC-0005 §5.7).

This is backed by contract **C5** (no `httpx` / `httpx2` / `requests` in `core` or `app`). The single
HTTP client in the project is `adapters/market/http_price_provider.py`. The app must work **offline**;
vendored assets only, no CDN.

### `PriceView` — `price.py:14`

```
asset_id: AssetId · price_id: PriceId
valid_date: date        # the date the close refers to
close: PriceAmount · currency: Currency
recorded_at: Instant    # when that close was RECORDED
```

The Market → Portfolio contract. A **flat DTO**, not an aggregate.

> **Portfolio never queries the `price` table.** It consumes this DTO. That is contract **C3** —
> sibling contexts may not import each other, so the shape crosses as a DTO.

Two things carry weight:

- **It pins `price_id`**, exactly as `IndicatorView` is specified to pin `reading_id`, so an
  evaluation stays **resolvable after a restatement**. A trace's `SourceRef` can name the exact price
  row it used.
- **The `(valid_date, recorded_at)` pair is bitemporal** (RFC-0009 §3.1). `valid_date` is the day the
  price is *about*; `recorded_at` is when we learned it. That pair is what lets a later discrepancy be
  explained as a **restatement** rather than a bug — a provider revising Tuesday's close on Thursday
  produces a second row, not an update.

The `price` table is **append-only** (**C6**), indexed
`ix_price_asset_valid(asset_id, valid_date, recorded_at)`. Persisted by
`adapters/duckdb/repositories/price.py`.

### Where prices enter the pipeline

`portfolio_engine.compute_allocation` values `Holding`s using `PriceView`s. A held Asset with no
supplied price lands in `AllocationBreakdown.unpriced_assets`, making the breakdown **incomplete** —
and an incomplete breakdown is **not consumed**, because a partial denominator is forbidden
(RFC-0007 §4.1). The Strategy Engine skips instead. See
[`evaluation-pipeline.md`](evaluation-pipeline.md).

### Not built

`IndicatorReading`, and the two condition kinds that would consume it (`indicator_threshold`,
`concentration_above`, both moved to V1.2 by **ERR-3**). Market indicators are specified at
RFC-0006 §4.2 and RFC-0007 §8.1, and would be immutable when built (**I-16**). See
[`gaps-specified-not-built.md`](gaps-specified-not-built.md).

---

## `cashflow` — empty

`src/financeos/core/cashflow/__init__.py` is **0 bytes**.

Deferred to **V1.1** by **ADR-0024**, which was then amended by **ADR-0026** — the amendment pulled
`Account` forward as a reference entity, and introduced **auto-emitted cash legs** so that the cash
side of a trade is representable *without* the Cashflow context existing yet.

That is why cash currently lives in the Portfolio context rather than here:

- an `Account` carries a `cash_asset_id`, so cash is modelled as an `Asset` like any other;
- a trade's cash side is an **auto-emitted `Operation`** with `cash_leg_of` set, carrying its
  parent's `type` and **exempt from that type's sign check** (`Operation._check_sign`);
- `DIVIDEND` / `COUPON` primaries carry `quantity = 0` and `price = None`; gross income is
  reconstructed as `leg.quantity + parent.fees` (**ADR-L01**).

The package exists so that contract **C3** has a fifth module to hold independent. Do not delete it,
and do not put anything in it without an RFC section to cite.

`REVIEW_LIQUIDITY` already exists in `SuggestionClass`, and `bucket_below_target_value` already
answers a liquidity-shaped question from `FACT_BUCKET_VALUE` — so some cashflow-adjacent surface is
reachable today without the context.
