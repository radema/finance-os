# Product

<!-- impeccable:product-schema 1 -->

> **Status: ratified.** The product-definition questions were answered by the product owner on
> 2026-07-26 (see *Ratified decisions* below). Everything else is sourced from the project's frozen
> RFC corpus, cited inline. A handful of gaps the corpus does not cover remain marked **[inferred]**
> and may be overruled freely.

> **Provenance of this file.** The `init` interview was answered in two passes: the durable product
> facts below were first drafted by inference from the project's **authoritative frozen inputs**,
> then the four open definition questions were ratified by the product owner. Frozen inputs:
> RFC-0001/0002/0003
> (`docs/seed/rfcs/finance-os-sources-0001-0003.md`, marked *"Authoritative, frozen input"*),
> RFC-0004–0012, `docs/seed/ux/UX-0001-ui-reference.md` (non-normative), `docs/plans/EXECUTION-PLAN.md`,
> and `docs/plans/adr/ADR-L01…L03`. Facts below cite their source. Anything not in the corpus is
> marked **[inferred]** and is safe to overrule.
>
> **Language seam (ADR-L03 §5).** This file is a developer-facing artifact and is therefore in
> English, like the RFCs and ADRs. Everything a *user* reads in the product is Italian.

## Platform

web

## Ratified decisions

Answered by the product owner, 2026-07-26. These four were the only genuinely open
product-definition questions; the rest of this file is corpus-sourced.

1. **Posture: private now, productizable later.** Build it as a single-user, local-first
   instrument — the operator authored their own strategy and knows the domain, so there is no
   onboarding flow and no marketing surface. But design nothing into a corner: **copy avoids hard
   "you" assumptions, empty states teach rather than shrug, terminology is self-explaining, and
   there are no dead ends.** A second reader must be able to pick up a screen without a tutorial.
2. **Visual register: a hybrid of "editorial instrument" and "modern application", deliberately
   more colourful and more chart-forward than the reference mock.** The mock's
   muted-paper-plus-CSS-bars direction is the floor, not the target. Keep the editorial
   seriousness — hairlines, calm structure, real typographic hierarchy, the three voices — and add
   the confidence of a well-made modern product: a genuinely considered palette, and **charts as a
   primary way of reading the data rather than a decoration.** Colourful the way a good data
   publication is colourful: purposeful hue, carrying meaning. Not loud, not playful.
3. **Brand: none.** Finance OS gets its own independent identity, designed from the product's
   character. This is **not** an OpenEconomics deliverable and no OE brand asset or palette applies.
4. **Theme: light and dark from day one.** Tokens designed in pairs, `prefers-color-scheme`
   honoured, both treatments held to the same contrast bar, and all five component contracts
   verified in both.

Two constraints qualify decision 2 and **win wherever they conflict with it**:

- **Colour is never the sole carrier of meaning** for the four outcomes or for
  breach/in-tolerance state. Pair hue with shape, weight, texture or label. This is an
  accessibility requirement and an epistemic one (RFC-0010 §6.4).
- **Charts read the as-recorded series** (RFC-0009 §6), never a recomputation. And the visual
  system must **already have room** to distinguish a Class B (projection) finding from a Class A
  (observation) finding before the first projection ships — RFC-0010 §6.4 makes an
  indistinguishable Class B finding a *kill criterion*, so the channel is reserved now rather than
  retrofitted (RFC-0010 §2.1).

## Users

**One primary user: a self-directed retail investor who is also the product's only author.**

RFC-0001 *Utente ideale*, verbatim: *"Persona che investe in autonomia. Non cerca consigli. Vuole
strumenti per prendere decisioni migliori."* — A person who invests independently, is not looking
for advice, and wants instruments for making better decisions.

- **Situation.** Their financial life is currently scattered across home banking, Excel / Google
  Sheets, Portfolio Performance, a broker, personal documentation, and their own memory
  (RFC-0001 *Problemi*). None of those tools knows their strategy.
- **The job.** Deliberately sitting down at their own machine to answer a specific question —
  *"Am I still following my own strategy?"* — and then either act or consciously decide not to.
  This is a **reading and deciding session**, not a dashboard glance. **[inferred]** from RFC-0001's
  question list and ADR-0008's user-triggered ingestion model.
- **Real holdings shape** (UX-0001 §8 fixture, presented as representative of the real portfolio):
  broker ETFs, Italian government bonds (BTP), a corporate-bond ETF, a current account, a trading
  account, and a 24-month term deposit. Amounts in the €100k order of magnitude, EUR only.
- **Locale.** Italian. it-IT number, currency and date formatting (ADR-L03 §5.2).

No second audience is confirmed. ADR-0010 defers commercialization posture, so there is no
prospect, buyer, admin or team role to design for.

## Product Purpose

**Turn dispersed financial data into knowledge and decisions** (RFC-0001 *Mission*).

Finance OS is a **Decision Support System** (RFC-0001, verbatim), the single point of truth for the
user's economic, patrimonial and strategic situation. It exists to answer questions of the form:
*Come sta andando il mese? Sto rispettando la mia strategia? Quanto è cambiato il mio patrimonio?
Cosa dovrei fare oggi? Quali rischi sto assumendo?*

Its philosophy, verbatim from the Manifest: *"Le applicazioni finanziarie mostrano ciò che è
successo. Finance OS vuole spiegare cosa significa."* — Financial applications show what happened;
Finance OS wants to explain what it means.

**Success** is that the user made a better-informed decision *and* can reconstruct, months later,
exactly why the system said what it said and what they decided in response. Explicitly **not**
success: engagement, session length, or the user checking a number.

## Positioning

**It knows your strategy, and it can prove its arithmetic.**

Two mechanisms a neighbouring product could not truthfully copy without rebuilding its domain:

1. **Strategy is a first-class, frozen, versioned object** (Manifest P2: *"La strategia è un
   oggetto di primo livello. Non è una configurazione. Non è una percentuale."*). Every finding is
   measured against a specific immutable `StrategyVersion` the user froze with a mandatory
   `change_note`. Strategies are independent of instruments (P4): ETFs and BTPs are
   implementations, the strategy is permanent.
2. **The trace-replay contract.** Every finding carries an `EvaluationTrace` — ordered bindings and
   ordered steps, stored as data, decimals as strings — from which the finding replays
   **byte-for-byte** (RFC-0009 §4.1; the Hypothesis property test in EXECUTION-PLAN Wave 1b). The
   chain **Recommendation → Alert trace → Rule → StrategyVersion → your own change_note** is
   walkable by clicking. That is Manifest P7 as a sequence of links rather than a promise.
   *"If that test can't be maintained, the product's core promise is gone."* (EXECUTION-PLAN)

### What it is not

RFC-0001 *Cosa NON è*, verbatim: not trading software, not a robo-advisor, not tax software, not a
banking app, not a market-timing system. Enforced in the schema, not merely in copy: there is **no
instrument, direction or size column anywhere** (invariant I-12, ratified enum E7). The system
cannot say *"Buy ETF X"* because it has no field in which to keep such an opinion. It says, per the
Manifest's own canonical P3 example: *"Secondo la tua strategia, l'allocazione è fuori target del 6%."*

It is also not a tracker: expense tracking and investment monitoring are explicitly not why it
exists (RFC-0001 *Vision*).

## Operating Context

- **One process, one file, localhost.** `uv run financeos serve` starts uvicorn and opens
  `localhost` (RFC-0005 §5.7). One DuckDB file; backup is `cp`. No account, no installer, no
  Docker, no scheduler, no daemon (ADR-0008).
- **Local First (ADR-0008).** No network dependency for any core function. The interface must
  render completely **with the network disabled** — which is why fonts and the chart library are
  vendored static files rather than CDN references (ADR-L03 §4).
- **Privacy First (RFC-0005 §5.7).** Zero telemetry. The only egress in the entire product is an
  explicit, user-initiated market-data fetch. A CDN reference counts as egress and is banned by CI
  contract.
- **Ingestion is a user-initiated act, never a background job** (ADR-0008 / RFC-0005 §5.5). There is
  no 3am fetch quietly changing what a Rule would have fired on, and no notification channel — so
  the user's arrival at the app is the only trigger for anything.
- **CLI-first for the unglamorous half.** In V1.0, `seed` and `evaluate` are CLI-only
  (`financeos seed`, `evaluate`, `serve`) — there is no browser path to bulk-seed a store or trigger
  an evaluation run. Importing Operations/Strategy and exporting authored data also have a browser
  mirror as of RFC-0010 v0.3 ADR-0037 (`/data-io`) — thin routes over the same `import_operations` /
  `import_strategy` / `export_authored` use cases the CLI calls, no new domain logic. The web
  surface's write flows are: saving a bucket apportionment, freezing a strategy version (UX-0001
  §2.2), and the three `/data-io` actions. Entity CRUD (creating/editing `Portfolio`/`Bucket`/
  `Account`/`Asset` themselves) has no UI in any form — CLI/fixture-seed only until V1.1 (ADR-0037).
- **Time is part of the reading.** Under the correction model (ADR-0012) the same question has
  different true answers depending on which run you are reading, because a reclassification
  rewrites history. Screen 3's charts read the *as-recorded* series while the Reconcile block reads
  a *recomputation*. A user who cannot see which they are looking at will eventually be misled
  (UX-0001 §4.3) — hence `portfolio · as_of · run_id · mode · input_digest` is permanently on screen.
- **The language seam.** User-facing copy Italian; identifiers, YAML keys, trace keys, file names,
  CSS classes and CLI command names English (ADR-L03 §5). Contributors must always know which side
  of the seam they are on.

## Capabilities and Constraints

**Seven surfaces** (UX-0001 §2): Findings `/` · Explanation surface `/recommendations/{id}` ·
Allocation & Net Worth `/allocation` · Buckets & apportionment `/buckets` · Operations
`/operations` · Strategy `/strategies/{id}` · Run health `/runs`. Screens 1–3 are the walking
skeleton; 4–7 are V1.0. V1.1–V1.3 (Cash Flow, Decision capture, Goals, risk axes, return series)
are sketched only and out of scope.

**Hard technical constraints that shape the interface:**

- **FastAPI + Jinja2 + HTMX. No npm, no build step, no bundler** (ADR-0007). Hand-written CSS,
  vendored static assets, server-rendered fragments.
- **`Decimal` end to end; no float ever feeds evaluation.** Decimals render in the UI exactly as
  stored, as strings, never formatted through a float (UX-0001 §4.2).
- **Read-side SQL only, in `adapters/duckdb/queries/`, returning flat rows / typed DTOs.** No
  aggregate is ever loaded to render a page; no domain object and no DataFrame reaches a template
  (RFC-0005 §5.3). `web/` may import `adapters.duckdb.queries` and nothing from `core/` internals
  (import-linter C1–C5).
- **JavaScript is load-bearing in exactly one place: charts.** The whole explanation surface — the
  findings list, the trace ladder, the recommendation permalink — must remain complete with
  JavaScript disabled, and every chart carries a tabular or textual equivalent next to it
  (ADR-L03 §4).
- **Charts read the as-recorded series** (RFC-0009 §6), never a recomputation, and annotate
  reclassification dates. An unexplained jump is a bug; an annotated one is information.
- **URL-addressability is close to a domain requirement** (RFC-0005 §5.4):
  `/recommendations/{id}/trace` is a permalink into an audit artifact, bookmarkable and pasteable
  into a `Decision`'s rationale.

**Domain facts the interface must not smooth over:**

- **`severity` is dimensionless** — `|drift| ÷ effective_band` (RFC-0007 §3.1). This is what lets a
  single gauge be legible across every asset class and both tolerance kinds. A 6.00pp breach on a
  40% ABSOLUTE target and a 0.5pp breach on a 2% RELATIVE target must read comparably.
- **`severity` may legitimately be `null`**, and the ordering contract is literally
  `ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC` (RFC-0008 §3). Authored
  priority band dominates severity. The UI must not re-sort.
- **Four evaluation outcomes: `FIRED` / `NOT_FIRED` / `SKIPPED` / `ERROR`.** `SKIPPED` is not
  compliance and `ERROR` is not silence. ADR-0016 names silent false reassurance as the failure
  mode most likely to mislead the user; a UI that renders "0 findings" over 20 skipped rules
  re-introduces it at the presentation layer after the domain went to trouble to prevent it.
- **`rationale` is assembled from the user's own frozen `StrategyVersion`** — never authored
  per-rule prose (ADR-0023). The system holds no opinion of its own and has no field for one.
- **Correlated findings are shown separately, never collapsed** (RFC-0008 §4.1). One cause showing
  as three findings is correct, not a bug.
- **Legal states that look like errors:** a negative `UNASSIGNED` residual is a deficit and is legal
  (ADR-0025); over-apportionment *warns and does not block*; mixed governance across buckets yields
  `SKIPPED(heterogeneous_strategies)`, **never an average** (RFC-0007 §5); untargeted and unassigned
  capital stay in the denominator (RFC-0007 §4.1).
- **Ubiquitous Language, kept verbatim in both languages:** Asset, Bucket, Holding, Strategy, Rule,
  Recommendation, Alert, Operation, Snapshot, Decision, Goal.

**Explicitly undecided product facts** (do not invent answers):

- Suppression visibility — *"why is this finding hidden?"* — UX-0001 §6.6, confidence **None**,
  deferred to V1.1 when `Decision` capture lands.
- Cash-leg display collapsing (RFC-0011 §8.2, medium confidence).
- Interior-node tolerances in the UI (RFC-0007 §12.3, medium confidence).
- CLI output language (ADR-L03 §7.2, open item).

## Brand Commitments

- **Name:** Finance OS. **No external brand applies** (ratified decision 3): the identity is its
  own, designed from the product's character. No wordmark, logotype, icon or brand asset exists in
  the repository, and none may be fabricated as if it did.
- **The three voices are load-bearing, not decorative** (UX-0001 §4.5, elevated by ADR-L03 §6):
  **IBM Plex Sans** speaks for the system, **IBM Plex Mono** for machine-verifiable values, and
  **IBM Plex Serif** for *the user's own words* (declared principles, `change_note`, assembled
  `rationale`, `userRationale`). ADR-L03 records why this stopped being optional: once the UI and
  the user's prose are both Italian, typography is the **only remaining signal** distinguishing the
  system's arithmetic from a restatement of the user's own prior declaration. The system never
  speaks in serif.
- **Fonts and the chart library are vendored static files** — IBM Plex (SIL OFL 1.1) and Apache
  ECharts (Apache-2.0), committed with their licences. No CDN, anywhere, ever (ADR-L03 §4).
- **Voice of the copy:** Italian, plain, declarative, and unflattering. It states what is true and
  what could not be evaluated. It does not congratulate, reassure, gamify, or recommend an
  instrument. Per ratified decision 1 it also **avoids hard "you" assumptions in structural copy**
  and **teaches in every empty state** — the Manifest's own P3 sentence keeps its *tua* ("secondo
  la tua strategia"), because there the possessive is the point; what is avoided is chrome that
  only makes sense to the one person who built the thing. ADR-L03 §5.3 requires that the sharp copy — *skipping is not compliance*, the
  negative-residual explanation, the "no band on this node" marker — be **authored in Italian, not
  translated**, because a limp rendering would quietly undo the discipline it exists to enforce.
- **No net-worth hero number on the landing surface** (UX-0001 §5.3). Manifest P1 says the
  decisions are the product, so the landing screen is the findings list and net worth lives one
  click away. A big-number dashboard as the home screen would contradict P1 in the first thing the
  user sees.

## Evidence on Hand

- **A complete, reconciling fixture** — the one piece of real evidence, and it is unusually good.
  UX-0001 §8: nine assets with prices at `as_of = 2026-07-24`, apportionment in units, derived
  totals where **net worth €107,586.33 = buckets + UNASSIGNED exactly**, two deliberately different
  strategies, and a 28-evaluation run splitting **10 FIRED / 9 NOT_FIRED / 8 SKIPPED / 1 ERROR**.
  The canonical row, preserved exactly from RFC-0005 §8.3: Equity/Developed **34.00%** against a
  **40.00%** target, **±2.00pp ABSOLUTE**, drift **−6.00pp**, `severity = 3.00`, drift value
  **−€3,240.00**. Its ten ordered findings exercise all three ORDER BY clauses. Use these numbers
  in every preview, mock and demo; do not invent alternatives.
- **The fixture encodes a narrative** (UX-0001 §8.6): on 19 Jul 2026 one asset was reclassified
  `EQUITY_DEVELOPED → EQUITY_GLOBAL`, which under the correction model rewrites history and produces
  one cause showing as three findings, plus a Reconcile divergence.
- `docs/seed/ux/finance-os-ui-mock.html` — a static mock with fake data. **Illustrative only.** Most
  of its visual language is invented (UX-0001 §5.2) and its own maintenance rule says: if the mock
  and the corpus drift, **delete the mock**.

**Absences that must never be fabricated:** no users other than the author, no testimonials,
customers, case studies, press, logos, benchmarks, pricing, licensing terms, or deployment claims.
No performance or return figures beyond the fixture. No AI features — the Manifest's *Visione
futura* is explicit that a future assistant *"non prenderà decisioni"*.

## Product Principles

Distilled from the Manifest's eight `Principi` (RFC-0002, authoritative), kept to the ones that
change design decisions:

1. **Decisions are the product; data is not.** *"I dati non sono il prodotto. Le decisioni sono il
   prodotto."* (P1) Every surface is judged by whether it moves the user toward a decision they can
   defend — not by how much it displays. The landing screen is a list of findings.
2. **Every suggestion must be explainable, and every decision reconstructable.** (P3 + P7) The
   explanation is not a tooltip appended to an answer; the derivation *is* the answer. Nothing may
   be shown that cannot be traced to a stored input.
3. **The system supports judgment; it never replaces it.** *"L'applicazione non sostituisce il
   giudizio umano."* (P6) The user's frozen declaration is the only authority. The system's job is
   to hold them to their own words and to make the distinction between its arithmetic and their
   declaration visible at a glance.
4. **Never reassure falsely.** Corollary of P3/P7 and the operative reading of ADR-0016: what could
   not be evaluated must be as visible as what passed. Absence of a finding is not evidence of
   compliance, and the interface must say so in words rather than by omission.
5. **The domain outlives the technology.** *"Il dominio è più importante della tecnologia."* (P8)
   Presentation must never become the place a domain fact is decided, softened, rounded, averaged
   or re-sorted.

## Accessibility & Inclusion

No formal standard was established by the corpus; the following are the product-specific needs that
follow from its own constraints. **[inferred, except where cited]**

- **Real contrast ratios,** not approximately-passing ones. This is a dense numeric reading surface
  where a misread digit has financial consequence, and it will be read on an ordinary laptop screen
  in ordinary room light.
- **Colour is never the only carrier of meaning.** Breach, in-tolerance, and each of the four
  outcomes must remain distinguishable in greyscale and to a red–green colour-blind reader — which
  matters more than usual here, because the two most consequential states in the product are
  conventionally coded red and green.
- **Full keyboard reachability with visible focus.** The primary user is a keyboard-driven desk
  user working through a list.
- **`prefers-color-scheme` and `prefers-reduced-motion` honoured.** A long reading session at a desk
  at either end of the day.
- **The entire explanation surface works with JavaScript disabled,** and every chart has an adjacent
  tabular or textual equivalent (ADR-L03 §4, cited — this is an accessibility guarantee as much as
  a degradation one).
- **Tabular figures everywhere numbers are compared vertically,** so columns of digits align
  (follows from the mono voice, UX-0001 §4.5).
