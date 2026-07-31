# Known limitation — `rationale` cannot be re-rendered it-IT

| | |
|---|---|
| **Status** | Known limitation, not yet fixed. Deferred, not blocked on a schema change |
| **Raised** | 2026-07-31, Wave-1 gate review, ruling 1 ("rationale locale — freeze going forward") |
| **Deferred by** | Two independent blockers, neither of which is a missing column: read-side aggregate
hydration the flat read model doesn't provide, and re-derivation risk under a newer build than the
one that wrote the row. See below. **This deliberately overrides L05 §7.3's recommendation** — see
"What L05 §7.3 recommended, and why this defers it" |

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

Unlike `observation`, `rationale` does not need a new storage shape to be re-assembled: `assemble_rationale(version, rule, *, render_number)` is
already pure and already takes an injected number renderer (`src/financeos/core/engines/decision_engine.py`), so re-running it with an
it-IT `render_number` against the frozen `(version, rule)` inputs would, in principle, reproduce the
sentence with it-IT punctuation. That is exactly what L05 §7.3 recommended (see below). Two real
blockers stand in the way of doing that on the read side, and neither is "needs a migration":

1. **Read-side aggregate hydration the current read model doesn't provide.** `assemble_rationale`
   takes a hydrated `StrategyVersion` domain aggregate — `version.definition`, `version.targets.leaves()`,
   `version.frozen_at` — and a `Rule` domain object, not the raw `strategy_version.definition` JSON a
   query returns. Every read-side query in `adapters/duckdb/queries/` returns flat rows for Jinja2 and
   never loads an aggregate to render a page (UX-0001 §2.1, RFC-0005 §5.3); C4 (read/write split) keeps
   queries as DTO-producers, not domain-object producers. Reconstructing a full `StrategyVersion` (and
   its nested value objects) from stored JSON on the read side would mean either duplicating the
   write-side repository's hydration logic in a query module, or loosening C4/UX-0001 §2.1's flat-row
   discipline for this one field. Both are bigger changes than this fix pass's scope.
2. **Re-derivation risk under a newer build than the one that wrote the row.** `assemble_rationale`'s
   own docstring already names this: re-invoking it against an old row's `(version, rule)` re-derives
   the sentence under *today's* code, not a replay of what was actually frozen. If the assembly logic
   itself changes between when a row was written and when it is displayed, re-assembling on read
   silently rewrites history — the exact failure the freeze exists to prevent
   (`docs/features-candidates/rationale-locale-freeze.md` is that docstring's own pointer back here).
   A stored `rationale` has no marker distinguishing "safe to re-assemble, nothing has changed" from
   "unsafe, the assembly code has moved on" — closing this only for old rows that are still safe needs
   that marker, which does not exist today.

Every existing display path (`recommendation.html`, `findings.html`) renders `rationale` directly as
prose, so closing the gap correctly means solving (1) and (2), not adding a column. This fix pass is
scoped to read-query fixes and does not touch `assemble_rationale`'s write path or its call sites:
it still writes the canonical-form concatenated string it always has.

### What L05 §7.3 recommended, and why this defers it

L05 §7.3 recommended exactly the injected-renderer seam `assemble_rationale` already has, and said
so as "a recommendation with an owner, not a change made here." This document is where that
recommendation was picked up and — for now — deliberately **not** acted on: the seam exists, but
using it from the read side runs into blockers (1) and (2) above, which L05 §7.3 did not need to
resolve because it stopped at the write-path signature. Recording the override here rather than
silently declining it is the point of this section.

## Considered but deferred: `run.engine_versions` as a no-migration path

`evaluation_run.engine_versions` (JSON, already stored on every run) is a plausible way to close
blocker (2) without a schema change: re-assemble a rationale it-IT **only when** the row's own
`engine_versions` for the decision engine matches the currently running build's version. A match
means nothing has changed since the row was written, so replaying `assemble_rationale` with an
it-IT `render_number` reproduces the frozen sentence rather than rewriting it; a mismatch falls
back to displaying the stored canonical string, same as today. This still leaves blocker (1)
(aggregate hydration) unresolved, so it does not close the gap on its own — noted here as future
work, not implemented in this fix pass.

## What this means today

- Every `rationale` — old and new — reads in canonical dot-decimal form (`40.00%`) even inside
  otherwise it-IT prose, exactly as `findings.py`'s docstring already says.
- A future fix needs to resolve both blockers above — read-side aggregate hydration and a
  build-version-aware re-derivation guard (see the `engine_versions` idea) — and, whichever shape
  it takes, must leave old rows exactly as they are: old rows are immutable facts and are never
  migrated or backfilled (RFC-0008 §5.1, append-only).
