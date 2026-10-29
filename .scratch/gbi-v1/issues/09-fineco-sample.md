# 09 — Provide a Fineco export sample

Type: task
Status: resolved
Blocked by: —
Map: ../map.md

## Question

HITL. The import mapping cannot be fixed without a real file. Checklist for the user: (1) export the transactions ('movimenti') from Fineco in the formats available (CSV and/or XLSX); (2) put the files in `real/` (gitignored — add `real/*.xlsx` to .gitignore first); (3) optionally a positions statement, used by rule R9 (units mismatch). Resolved when the files exist; the answer records file names, formats and column headers (no amounts).

## Answer

Done 2026-10-29. The user exported "Lista Titoli.xlsx" from Fineco and blanked some values of two columns (Quantita, Controvalore). Copied to `real/fineco-movimenti-sample.xlsx`; `real/*.xlsx` and `real/*.xls` added to `.gitignore`, so it is never committed. No positions statement provided (R9 has no sample yet).

Shape (no amounts recorded here):

- Format: XLSX, one sheet "Movimenti Dossier Titoli". CSV not provided.
- Rows 1-5 are metadata: "Dossier n.: …", "Intestazione Dossier: …", blank, "RISULTATO RICERCA MOVIMENTI TITOLI…", blank. Row 6 is the header, row 7 is blank, data from row 8.
- Columns: `Operazione` | `Data valuta` | `Descrizione` | `Titolo` | `Isin` | `Segno` | `Quantita` | `Divisa` | `Prezzo` | `Cambio` | `Controvalore` | `Commissioni amministrato`.
- Dates are **text** `DD/MM/YYYY` (both `Operazione` and `Data valuta`), not Excel dates.
- `Descrizione` values seen: `Compravendita titoli` (trades), `Stacco Cedole` (coupon, `Segno` blank).
- `Segno`: `A` = buy, `V` = sell, blank for coupons.
- `Prezzo` numeric (format `#,##0.00000`); BTP rows priced per 100. `Cambio` numeric (1 for EUR). `Divisa` `EUR`. `Commissioni amministrato` numeric.
- `Titolo` is a short broker name (e.g. ETF and BTP abbreviations), so product matching must go by `Isin`.
- Sample covers ETF buys/sells, a BTP buy, a gold ETC and one coupon line.

Implications for ticket 08: skip the metadata block by finding the header row; parse text dates; map `Segno` A/V to sign; decide how `Stacco Cedole` rows are imported (cash flow, not a unit change) and whether `Controvalore` is used to cross-check `Quantita × Prezzo`.

Check: `git check-ignore real/fineco-movimenti-sample.xlsx` succeeds; `uv run --with openpyxl python -c "import openpyxl; print([c.value for c in openpyxl.load_workbook('real/fineco-movimenti-sample.xlsx').active[6]])"` prints the 12 headers above.
