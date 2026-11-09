# Goal-Based Investing

This context models a single investor's goal buckets, portfolio holdings and cash decisions. It distinguishes money assigned to a goal from the financial products that may hold it.

## Language

**Bucket Cash**:
A system-owned, €1-per-euro technical balance held separately for each bucket. It represents uninvested money assigned to that bucket and is not a user-configurable financial product.
_Avoid_: cash product, deposit account, unallocated cash

**Deposit account**:
A real user-configured cash-regime product, with its own return and fiscal assumptions. It is distinct from Bucket Cash.
_Avoid_: Bucket Cash, virtual cash

**External contribution**:
Money entering a bucket from outside the tracked portfolio and credited to its Bucket Cash. It is the actual amount for plan-versus-actual purposes.
_Avoid_: buy, acquisition

**External withdrawal**:
Money leaving a bucket's Bucket Cash for outside the tracked portfolio. It is a performance cash flow, not a negative planned contribution.
_Avoid_: sell, negative contribution

**Internal cash transfer**:
A movement from the Bucket Cash of one bucket to that of another. It does not enter or leave the tracked portfolio.
_Avoid_: contribution, withdrawal

**Opening position**:
The one-time account baseline at an as-of date, including holdings and optional Bucket Cash balances. It is not an external contribution.
_Avoid_: first contribution, initial buy

**Archived bucket**:
A reversibly closed bucket with no holdings or Bucket Cash. Its history remains available but it is excluded from current decisions and projections.
_Avoid_: deleted bucket, inactive transaction
