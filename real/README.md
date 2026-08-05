# `real/` — your real portfolio data

This folder is where your actual financial data lives once you start using Finance OS for real
(RFC-0010 §3 V1.0's done-when: *import your actual holdings, author your actual Strategy*).

**Nothing under this folder except this README is ever committed.** `.gitignore` excludes every
`.csv`/`.yaml`/`.yml` here — real account numbers, balances, and holdings must never enter git
history, even by accident.

## Getting the empty template

Two ways to get the 8-file skeleton (header-only CSVs + a documented `strategy.yaml` example):

- From the running app: `/data-io` → "Modello vuoto" → download the zip, unzip it here.
- From the CLI: `curl http://127.0.0.1:8000/data-io/template -o template.zip && unzip template.zip -d real/`

## Filling it in

1. **`strategy.yaml` first** — `buckets.csv` needs a real `strategy_id`, which only exists once a
   Strategy is authored. Replace every `TODO` and the two placeholder UUIDs (generate real ones:
   `python -c "import uuid; print(uuid.uuid4())"`).
2. **`assets.csv`, `accounts.csv`, `portfolios.csv`, `portfolio_accounts.csv`, `buckets.csv`** —
   your real structure. All ids are UUIDs you mint yourself.
3. **`apportionment.csv`** — which Bucket holds how much of which Asset, as of what date.
4. **`operations.csv` is deliberately not in the template** — add it yourself once you have a
   real transaction history to import (same column contract: `account_id,asset_id,type,
   trade_date,quantity,price,fees,currency,ref`), or skip it and use `/data-io`'s Operations
   upload after the first seed instead.

## Loading it

```bash
uv run financeos seed real/
uv run financeos evaluate
```

`seed` **wipes the current DuckDB file first** — this is also your reset/delete mechanism. Adding
a new Portfolio/Bucket/Account/Asset later has no UI form yet (deferred to V1.1, ADR-0037): export
the current store as a backup (`/data-io/backup` or `financeos export --authored` for the
Strategy/apportionment history specifically), hand-edit the CSV to add the new row, and re-seed
from the edited bundle.
