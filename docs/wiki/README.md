# Finance OS docs wiki

**A point-in-time architectural map of the domain, built for agentic use.**

Base commit: **`2dd7346`** · written 2026-08-04.

## What this is, and what it is not

This wiki exists so that an agent (or a person) resuming work on Finance OS can answer questions like
*"what entity governs X"*, *"which invariant applies to Y"*, *"what is the relationship between a
`Rule` and a `Recommendation`"* **without re-deriving the answer from nine RFCs and forty source
files every session.**

> ### It is not normative.
>
> **Ground truth is `docs/seed/rfcs/` (the frozen corpus) first, then `src/`.** If this wiki disagrees
> with either, **this wiki is wrong** — treat a conflict as a bug in the wiki, never as licence to
> change behaviour. Every claim here carries a citation so you can check it at the source.
>
> This is a **map, not a mirror.** It is not kept in lockstep with every code change and will drift.
> Line numbers especially: they were accurate at `2dd7346` and are anchors for `grep`, not addresses
> to trust blindly. When a line number is stale, the symbol name next to it is still findable.

Reminder of the standing rule from `CLAUDE.md`: **the corpus outranks the code.** When the code and an
RFC disagree, the code is wrong. Read the RFC section before changing behaviour, and cite it in the
commit.

## Two layers

### `semantic/` — machine-readable, for programmatic navigation

Cheap to `grep`, cheap to parse. Start here if you are an agent.

| File | Answers |
|---|---|
| **`entities.yaml`** | every first-class type: attributes, classification, code anchor, table, governing RFC/ADR, invariants, and *what a future agent gets wrong if it only reads the field list* |
| **`relationships.yaml`** | a flat edge list — `subject` / `predicate` / `object` / `cardinality` / `mechanism` / `authority`. One grep per question. |
| **`identifiers.yaml`** | every identifier family — `I-1..I-22`, `C1..C6`, `P1..P33`, `ADR-0001..0036`, `ADR-L01..L06`, `ERR-1..15`, `E1..E14`, `R-1..3`, L05, W1..W10 — with what each means, where its registry lives, and what it constrains |

Each file's header carries its own field contract and query recipes.

### `ontology/` — prose, for orientation

Read these when you need the *why*, not just the shape.

| File | Covers |
|---|---|
| **`bounded-contexts.md`** | the five-context partition, the C3 non-import rule, and the placements it explains |
| **`portfolio.md`** | `Portfolio`, `Bucket`, `Asset`, `Operation`, `Holding`, `VirtualHolding`, apportionment, residual |
| **`strategy.md`** | `Strategy`, `StrategyVersion`, `Rule`, `LeafCondition`, targets, tolerance, drift |
| **`decision.md`** | `EvaluationRun`, `Alert`, `Recommendation`, `Provenance`, `Snapshot`, the trace, `finding_key`, `mv_finding` |
| **`market-and-cashflow.md`** | `PriceView`; and why `cashflow` is empty |
| **`outcomes-and-severity.md`** | the four outcomes and severity semantics as first-class concepts |
| **`evaluation-pipeline.md`** | the `evaluate` flow end to end, the six fact families, the condition catalog, determinism |
| **`identifier-families.md`** | the human-readable index of every identifier family, plus governance rules |
| **`gaps-specified-not-built.md`** | what the corpus specifies that the code does not implement |

## Query recipes

```bash
cd docs/wiki

# One entity's full record
grep -A30 '^- entity: Rule$' semantic/entities.yaml

# Every entity, with line numbers, as a table of contents
grep -n '^- entity:' semantic/entities.yaml

# Every relationship from, or into, a type
grep -A6 'subject: Alert$'          semantic/relationships.yaml
grep -B2 -A6 'object: Recommendation$' semantic/relationships.yaml

# What one identifier means and constrains  (members are indented 4 spaces; `^ *-` is depth-proof)
grep -A8 '^ *- id: I-12$' semantic/identifiers.yaml
grep -A6 '^ *- id: C3$'   semantic/identifiers.yaml
grep -A8 '^- family: P$'  semantic/identifiers.yaml   # a family header: where its registry lives

# Which entities an invariant touches
grep -B12 'I-9' semantic/entities.yaml | grep '^- entity:'

# What is specified but not built
grep -B3 'classification: not_implemented' semantic/entities.yaml

# Everything that mentions a concept
grep -rn 'finding_key' .
```

## Start here, by question

| Question | Go to |
|---|---|
| What is the relationship between a Rule and a Recommendation? | `ontology/decision.md` → "The chain"; `semantic/relationships.yaml` |
| Why can't `core/strategy` import `core/portfolio`? | `ontology/bounded-contexts.md` |
| What does `SKIPPED` mean, and how is it different from `NOT_FIRED`? | `ontology/outcomes-and-severity.md` |
| Why is `severity` nullable, and why `NULLS LAST`? | `ontology/outcomes-and-severity.md` |
| Where is the `rule` table? | `ontology/strategy.md` → there isn't one (**ADR-0027**) |
| What runs when I type `financeos evaluate`? | `ontology/evaluation-pipeline.md` |
| What does `I-12` / `C3` / `P29` / `ERR-14` mean? | `ontology/identifier-families.md`; `semantic/identifiers.yaml` |
| Where does `ADR-0021`'s full text live? | inside RFC-0008's Appendix A — see the ownership table in `ontology/identifier-families.md` |
| I can't find `Decision` / `Goal` / `Account` in the code. | `ontology/gaps-specified-not-built.md` |
| Is this thing a bug? | the "looks like a bug" section of each context page, and `CLAUDE.md`'s own list |

## Five things most likely to be got wrong

Collected here because each has a real cost, and each is easy to miss from the field lists alone.

1. **`SKIPPED != NOT_FIRED`** (**ADR-0016**). A rule that could not be evaluated is not a rule that
   found nothing. Conflating them reports compliance exactly when the system knows least.
2. **`finding_key` must be used whole.** Any dedup or resolution logic keying on *less* than
   `sha256(rule_id ‖ scope_id ‖ canonical(condition.params))` **silently hides live findings**, and
   **this bug has already shipped once**.
3. **`Alert` is the middle term.** A `Recommendation` is 1:1 with a **FIRED `Alert`**, not with a Rule
   and not with a run. `Alert` is what persists, and it persists all four outcomes.
4. **A `Rule` has no table and no foreign key** (**ADR-0027**). It resolves through
   `run_id → strategy_version.definition.rules`.
5. **Invariants run to `I-22`, not `I-18`.** RFC-0012 §4 added `I-19`–`I-22` and restated `I-14`;
   RFC-0000 §6 was never updated on disk. Precedence is **section-scoped and recency-ordered**
   (RFC-0012 §8), so RFC-0012 wins for the registry.

## Maintaining this

- **`docs/seed/` is read-only.** RFCs are never edited in place; a correction is a new amending
  document plus a row in `RFC-0000-index.md` §4.
- **Prefer adding a citation over adding a claim.** The value of this wiki is that every statement can
  be checked; an uncited assertion is worse than a gap.
- **When you find drift, fix it here and note the base commit.** Do not adjust the code to match the
  wiki.
- **Do not turn this into a changelog.** `docs/archive/HANDOFF-<date>.md` is the session ledger and
  records what is unreviewed, deliberately unfinished, or only looks like a bug.
- **Product-definition questions go to the product owner. An agent never invents one.**
