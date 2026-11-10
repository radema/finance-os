# Server architecture review

Reviewed 2026-11-10. This is planning evidence, not a behavioural rule.

## Role and invariant

`server/` is the local I/O and orchestration module. It validates HTTP input, reads and writes
SQLite through Kysely, converts stored cents and scaled values for `engine/`, reads local files,
fetches public prices, runs local jobs, and returns JSON. It binds only to `127.0.0.1`.

Financial decisions belong in `engine/`; `server/` owns persistence, external effects, and the
translation between storage and engine values.

## Current clusters

| Cluster | Files | Assessment when touched |
| --- | --- | --- |
| Startup and HTTP | `bin`, `browser`, `index`, `router`, `static`, `config`, `dataFolder` | `index.ts` is the composition root and should know all registrations. `router.ts` is a deep module: retain its small route-registration interface. |
| Database | `db`, `schema`, `migrations`, `documents`, `rows` | Keep SQLite-to-Kysely adaptation, migrations, and document storage behind their existing interfaces. |
| Portfolio persistence | `products`, `goals`, `allocation`, `transactions`, `cashLedger`, `openingPosition`, `pensionPlan` | See the focused finding below. |
| Read models and decisions | `goalViews`, `tracking`, `overview`, `independence`, `pension`, `alerts`, `snapshots`, `optimizer` | Keep `loadWorld` as the Goal read-model adapter. Avoid a universal loader: calculations intentionally need different representations. |
| Imports | `importRoutes`, `importFile`, `finecoMovimenti`, `xlsx`, `transactionImport`, `recordImport`, `ledgerImport`, `cashImport`, `importUndo`, `previewWrite` | Keep file access and commit/undo mechanics here; deepen only when repeated workflows demonstrate a shared interface. |
| Prices and jobs | `prices`, `priceFetch`, `yahooProvider`, `monthlyJob` | Keep `storePrice` as the common price write path. Revisit only when source precedence, undo, or scheduling repeatedly crosses these files. |
| Data operations | `backup`, `data`, `exchange`, `sample`, fixtures | Keep operational concerns separate from portfolio persistence. |

## Focused finding: portfolio persistence

The portfolio persistence cluster has circular imports:

```text
cashLedger → openingPosition → cashLedger
cashLedger → openingPosition → transactions → cashLedger
transactions → pensionPlan → transactions
```

Shared loading and validation are split among route modules: `loadLedger` has many consumers but
lives in `transactions.ts`; cash state, opening position, and pension-plan access participate in
the cycles. This weakens locality and makes accounting changes harder to navigate.

When an active change crosses this cluster, deepen the shared ledger loading and accounting
validation behind a focused persistence module, while leaving route registration at the HTTP seam.
The target is not a generic repository abstraction: callers should retain a small interface and
should not coordinate persistence internals.

## Folder decision

Do not reorganize `server/` into subfolders now. Moving files alone will not remove the circular
imports or improve the interfaces, and the flat folder remains navigable.

After a portfolio-persistence change actually creates the focused module above, move that module,
its direct route module, and paired tests together if the move makes ownership clearer. Apply the
same change-driven approach to another cluster only when it is actively changing. Folder structure
must express an already-improved module; it is not the improvement itself.
