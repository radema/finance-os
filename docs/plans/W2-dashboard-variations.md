# W2 · Three dashboard landing pages, for a pick

**Status** — prototype, throwaway, awaiting a product-owner choice.
**Route** — `uv run financeos serve`, then `http://127.0.0.1:8000/design/dashboard?variant=A`.
`←` and `→` cycle. Each variation is also linked from the floating bar at the bottom.
**Task** — #12. This is an exploration, not a decided design.

---

## What was and was not decided before this

A dashboard landing page **is wanted** — product owner, 2026-08-01. Nothing needs
overturning to build one. `UX-0001 §5.3` argues against one, but that section says of
itself that it is *"a reading of the Manifest, not a requirement"* (`UX-0001:155`), and
**P1 is the scope ratification, not a landing-page rule.** If a variation is picked,
§5.3's row becomes a pointer per `UX-0001 §10`.

**Still open, and not this prototype's to answer:** *what the landing page is for.* That
is a product-definition question, so it is offered as three options rather than resolved.
Each variation answers a different first question, and each states its own cost on the
page itself. Naming a variation is the same act as answering the question.

---

## The three

### A · «Il verbale della valutazione» — coverage first

The page reads top-to-bottom as one evaluation's report: the census of the four outcomes,
then the skip notice, then the findings in `mv_finding`'s order, then the holdings as
closing context. One column, no cards, no grid.

- **First question** — *can this run be trusted, and what did it not measure?*
- **Tradeoff** — puts coverage above findings, which no conventional dashboard does; a
  reader who opens the product to see what the portfolio is worth reads a run report
  instead and still has to go to `/allocation`. Also the least dashboard-like of the
  three: it is close to today's `/` with a coverage header.
- **Why it might be right** — `ADR-0016` calls silent false reassurance the failure mode
  most likely to mislead, and it is a presentation bug as much as a domain one. This is
  the only variation where the unmeasured rules cannot be scrolled past.
- **Refuses** — any net-worth figure above the findings, and any aggregate "health"
  score: one number over four non-summable outcomes is the average `ADR-0016` and
  `RFC-0007 §5` each forbid in their own domain.

### B · «Il quadro degli scostamenti» — deviation first, on one scale

A two-column instrument panel. Left: the cased cane per asset class, then one calibrated
column of tolerance rails, then severity over time. Right: net worth small, the Bucket
table, and a note on what the panel does not measure. Charts lead; no record blocks, and
no prose per finding — a row is designation · rail · severity.

- **First question** — *how far is everything from the shape that was declared?*
- **Tradeoff** — a calibrated column invites reading the longest bar as the most
  important thing, and `RFC-0008 §3` says declared priority orders first with severity
  only inside it. The rows here stay in `mv_finding`'s order, so the column is **not**
  the severity ranking it looks like. That mismatch is the honest reason to be suspicious
  of this variation.
- **Why it might be right** — severity is dimensionless (`RFC-0007 §3.1`), which is the
  only reason a panel is possible at all: an ABSOLUTE-pp breach and a RELATIVE reading
  can be compared by eye in one column. This is the only variation that uses the severity
  contract as a layout primitive, and the densest of the three.

### C · «Il patrimonio annotato» — aggregate first, findings as annotation

Net worth and the composition of the whole lead. Findings hang off it as an annotation
layer: one card per Bucket carrying value, share, open findings, rules that reached a
verdict, rules that did not, and worst severity. The ordered findings list is a compact
ledger below.

- **First question** — *what is held, and in which part of it are the deviations?*
- **Tradeoff** — this is exactly the page `UX-0001 §5.3` argues against. The first thing
  the product says becomes a total rather than a deliberation. Built with the cost
  visible so it can be priced rather than assumed.
- **Why it might survive anyway** — two guards. No Bucket card shows an open-findings
  count without its unevaluated count beside it (**Personale** is the proof case: zero
  findings *and* seven rules that never ran, on one card). And the whole reconciles in
  view — the composition segments close on the net-worth tick and the unassigned residual
  is one of them (`ADR-0029`) — so the hero number is checkable rather than asserted.

---

## What all three hold to

| Constraint | How |
|---|---|
| **I-12** — never an instruction | Not one imperative or call to action on any of the three. Facts in the impersonal register (P17). No row names an instrument, direction or size (E7). |
| **I-6** — every figure replayable | Each page carries a collapsed *Derivazione* table naming the read-side query module that would produce each summary figure. There is no decorative aggregate. |
| **ADR-0016** | The skip notice sits above whatever makes a count claim, on all three. No open-findings count appears without an unevaluated count. |
| **RFC-0008 §4.1** | Correlated findings stay separate; the in-tolerance reading is not filtered out. |
| **UX-0001 §4.1** | The tolerance rail is included unchanged from `partials/`. Three geometries in three places would lose the contract. |
| **P14 / P18 / P19 / P25** | Decimals localized in the view; `target`, never `obiettivo`; taxonomy prose forms in prose and short forms on axes. |
| **ADR-0008** | Vendored ECharts and htmx, zero off-origin references, chart colours declared as `"token:--name"` only. |
| **C4** | Nothing here reads the store, so there is no SQL to inline. The real version would read the modules named in *Derivazione*. |

---

## What the numbers are

All three render from `src/financeos/web/design_fixture.py` — the `UX-0001 §8` canonical
numbers, which reconcile from one holdings ledger. **Not** from `demo/`: that seed holds a
single finding and is being reshaped concurrently, so a layout judged against it would be
judged against the wrong shape.

The one figure the fixture does not carry is the run total, and a coverage-first variation
cannot be read without it. It is therefore stated as its addends in
`web/prototype_dashboard.py` — `FIRED 3 + NOT_FIRED 12 + SKIPPED 8 + ERROR 1 = 24` — and
is fixture arithmetic, not a corpus number. Nothing else is new.

---

## Files, and how to throw them away

| File | Role |
|---|---|
| `src/financeos/web/prototype_dashboard.py` | fixture adapter + the variation registry |
| `src/financeos/web/templates/design/dashboard_prototype.html` | host page, label block, *Derivazione*, prototype CSS |
| `src/financeos/web/templates/design/dashboard_variant_{a,b,c}.html` | the three |
| `src/financeos/web/templates/design/_prototype_switcher.html` | floating bar + `←`/`→` |
| `src/financeos/web/routes/design.py` | `GET /design/dashboard` added |

It lives under `/design` on purpose: `design_fixture.py` may only be read by the preview
surface, never by the running application. Once a variation is named, promote **that one**
to a real route reading real query modules and delete the rest — the prototype code was
written without tests or error handling and should not be promoted as-is. The full set
stays on branch `proto/w2-dashboard-variations` as the primary source.
