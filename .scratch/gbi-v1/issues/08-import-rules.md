# 08 — Import: first broker format and multi-bucket trades

Type: grilling
Status: resolved
Blocked by: 03, 09
Map: ../map.md

## Question

Which broker export is supported first (Fineco 'movimenti' CSV or XLSX), with which column mapping? When one broker trade serves several buckets, is it split by allocation weights automatically or does the user always choose? How is the opening position entered (opening transactions from a statement)?

## Answer

Grilled with the user on 2026-10-29. Source: `reference/source-spec.md` "Prices and bulk import", sample shape from [09](09-fineco-sample.md). Only add more formats or cases when a real need appears.

**First format.** One preset, "Fineco movimenti (XLSX)", sheet "Movimenti Dossier Titoli". The generic CSV/XLSX path uses the same pipeline with manual column mapping.

- Find the header row by its column names (`Operazione` … `Commissioni amministrato`), not by a fixed row number. Skip blank rows.
- Mapping: `Operazione` → date (text `DD/MM/YYYY`; `Data valuta` is ignored). `Isin` → product (match by ISIN; `Titolo` is only a display hint). `Segno` `A` = buy, `V` = sell (trim it: on coupon rows it is a single space). `Quantita` → qty. `Prezzo` → price (BTP per 100, as in the rest of the app). `Commissioni amministrato` → commission (actual).
- `Divisa` ≠ EUR or `Cambio` ≠ 1 → row is "needs fix" (v1 is EUR only).
- `Controvalore` is a cross-check only: if it does not match qty × price (BTP: /100) ± commission, the row gets a warning, not a block.
- `Descrizione` = `Stacco Cedole` → coupon row (see below). Any other `Descrizione` → "needs fix".

**Several buckets for one trade.** Bucket assignment follows the spec chain: bucket column if present; else the only bucket that holds the product or has it in its weights (auto, "ready"); else the row is "needs a goal". There the user picks one of:

- one bucket;
- **split by weights**: units rounded to integers by largest remainder;
- **split by units**: the user types the units per bucket.

A split is never applied without the user's confirmation. A split row is "ready" only when its parts sum exactly to the broker quantity. Each part becomes its own Transaction, all in the same ImportBatch. The commission is split in proportion to units. The same split control is used for the opening position. This replaces and improves the Excel v2 `Mapping` sheet.

**Opening position.** The user has a portfolio transferred from another broker and will not import its history. So v1 enters the current state through the UI: a "Current portfolio" form with one "as of" date (default `trackingStart`). For each product: total units and account PMC, then the units are split across buckets (by weights or by units, as above). Each part is an `opening` Transaction with price = PMC.

- For a transferred portfolio, the PMC is the fiscal cost basis (carico fiscale) Fineco shows after the transfer, because taxes are computed on it.
- Pension funds use the same form (units + average unit value, in the pension bucket). Their contribution history stays in the pension module.
- Opening transactions count for units and PMC, never as contributions (as in the spec).
- Import rows with `Operazione` ≤ the opening date are skipped automatically with the status "already in the opening position", so they are never counted twice. A user who does import the full history instead treats rows before `trackingStart` as normal buys/sells: they count for units and PMC, not for plan vs actual.

**Coupons.** New Transaction type `coupon`: qty 0, amount = cash received. It is assigned to the bucket(s) that hold the bond on that date, split by units. The import default is "record as coupon", not "leave out" (this answers the default the UI prototype asks for). A coupon is bucket income. It is an outflow in TWR/XIRR, so returns include it. It is not a contribution and does not change units or PMC. The Fineco `Controvalore` of a coupon is usually net (12.5% withheld). Store the net amount received. Fineco can export a more detailed version with gross amounts if this is ever needed.

**Duplicates.** Key (date, product, qty, price) against existing data → "already in your records", skipped. Two identical rows inside one file → "needs fix" (not skipped), so the user decides whether they are two real orders.

Data-model deltas for the spec: Transaction.type gains `coupon` (with an amount field); saved mapping "Fineco movimenti (XLSX)"; an opening "as of" date per account.

Check: in the spec, the import section names the Fineco XLSX preset with the column mapping above, the three bucket choices (one / by weights / by units, sum = broker qty), the "Current portfolio" opening form, the skip rule for rows ≤ opening date, and the `coupon` type. A test on `real/fineco-movimenti-sample.xlsx` parses 7 rows: 6 trades (5 A, 1 V) and 1 coupon, with no row lost to the metadata block. On the first real coupon row, the stored amount equals the cash credited on the account statement.
