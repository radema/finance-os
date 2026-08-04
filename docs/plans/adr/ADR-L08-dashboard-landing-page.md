# ADR-L08 — `/dashboard`: a second landing page, alongside `/`, not instead of it

| | |
|---|---|
| **Status** | Accepted (task #12) |
| **Date** | 2026-08-01 |
| **Resolves** | UX-0001 §5.3's own row, "No net-worth hero number" — a reading of the Manifest (P1), not a corpus requirement, that this decision overrides |
| **Depends on** | RFC-0007 §4.1/ADR-0029 (untargeted/unassigned capital stays in the denominator; the net-worth tick reconciles the composition), P1 (decisions are the product — a scope ratification, not a landing-page rule) |
| **Supersedes** | The three-variation dashboard comparison plan doc this decision resolved (deleted once variation C was named, per its own instruction) |

## 1. Context

UX-0001 §5.3, as originally written, read "no net-worth hero number" as settled: P1 says the
decisions are the product, so the mock made the findings list the landing screen and put net worth
one click away on screen 3. That was an honest reading of the Manifest at the time, not a ratified
requirement — §5 of the same document says so of itself ("Specified vs invented").

On 2026-08-01 the product owner asked for a dashboard landing page (task #12). Three variations were
built and compared for cost against exactly this row; the owner picked variation C, «Il patrimonio
annotato».

## 2. Decision

A dashboard landing page is wanted. Variation C ships as a new route, **`/dashboard`**
(`web/routes/dashboard.py`), sitting *alongside* `/` rather than replacing it:

- `/` (screen 1) is untouched — it stays the findings-first landing page UX-0001 §5.3 originally
  described. P1 is unaffected: it is a scope ratification ("the decisions are the product"), not a
  rule that no other landing page may exist.
- `/dashboard` carries two guards, both required to keep it from becoming the false-reassurance
  dashboard the original §5.3 row warned against:
  1. No open-findings count is shown without its unevaluated count beside it.
  2. The composition reconciles on the net-worth tick (ADR-0029) — untargeted/unassigned capital
     stays in the denominator, so the number cannot read as "all is well" while real gaps exist.

## 3. Consequences

- The three-variation comparison plan doc is deleted, per its own instruction, now that a variation
  is named. This ADR is the durable record of the decision it captured; nothing under
  `docs/seed/rfcs/` is touched (a product-owner call, not a corpus ratification).
- UX-0001 §5.3 is a pointer to this ADR and to the shipped route/guards, per §10's maintenance rule.
