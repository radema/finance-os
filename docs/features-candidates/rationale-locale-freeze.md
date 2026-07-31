# Known limitation — `rationale` cannot be re-rendered it-IT

| | |
|---|---|
| **Status** | Known limitation, not yet fixed. Blocked on a schema change |
| **Raised** | 2026-07-31, Wave-1 gate review, ruling 1 ("rationale locale — freeze going forward") |
| **Blocked by** | A migration adding storage for the rationale's template + bindings, which this fix
pass was explicitly scoped to leave alone |

## The gap

`observation` is frozen as a template (`rule.message`) plus bindings (`alert.trace.message_bindings`),
so `render_observation_it` (L05 §7.3) can replay it with it-IT punctuation at read time without
recomputing anything. `rationale` (`assemble_rationale`, ADR-0023) has no equivalent: it is
assembled by branching code — leaf-target lookup, tolerance kind, horizon shape, principle
presence — and the result is concatenated into a single canonical-form string at write time
(`recommendation.rationale VARCHAR`). There is no template and no bindings left over for a read
path to re-render, only the finished sentence with dot-decimal numbers
(`docs/seed/rfcs/RFC-0008-decision-engine.md` §5.2, `financeos.web.routes.findings` module
docstring).

## Why this isn't fixed here

Closing it properly means the write path stops concatenating a final string and instead freezes
something a read-side function can replay — the same shape `render_observation`/
`render_observation_it` already use. `recommendation.rationale` is a single `VARCHAR` column with
no room for that structure without changing what gets written, and every existing display path
(`recommendation.html`, `findings.html`) renders it directly as prose. Doing this without breaking
those call sites, and without silently changing what *old* rows mean, needs either a new column
(e.g. a `rationale_bindings` JSON column mirroring `alert.trace`) or a second table — either way, a
migration. This fix pass was explicitly scoped to leave migrations untouched, so the write path is
unchanged: `assemble_rationale` still writes the canonical-form concatenated string it always has.

## What this means today

- Every `rationale` — old and new — reads in canonical dot-decimal form (`40.00%`) even inside
  otherwise it-IT prose, exactly as `findings.py`'s docstring already says.
- A future fix should add the template/bindings storage, land the write-path change so *new* rows
  carry it, and leave old rows exactly as they are — old rows are immutable facts and are never
  migrated or backfilled (RFC-0008 §5.1, append-only).
