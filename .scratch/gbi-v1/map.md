# Map — GBI planner v1 (restart of finance-os)

Label: wayfinder:map
Tracker: local markdown (`.scratch/gbi-v1/`), see `.claude/skills/setup-matt-pocock-skills/issue-tracker-local.md` (user scope)

## Destination

A reviewed v1 spec for the goal-based investing app at `.scratch/gbi-v1/spec.md`, and its implementation
tickets published as GitHub issues (parent + sub-issues) on `radema/finance-os`, ready for `/ticket-loop`.
v1 = the whole source spec (6 milestones, 13 screens), built incrementally.

Done when:

- [ ] `.scratch/gbi-v1/spec.md` exists; every item under "Open questions" in `reference/source-spec.md` is answered in it or listed as out of scope; a `spec-reviewer` pass reports no blocking finding.
- [ ] Every file in `.scratch/gbi-v1/issues/` has `Status: resolved` or is listed under Out of scope.
- [ ] `gh issue list -R radema/finance-os --label gbi-v1` shows the parent issue(s) and sub-issues; a `spec-reviewer` `MODE: briefs` pass maps every `AC-` id of the spec to a sub-issue.
- [ ] The spec names the keep/drop list for the current repo and the content of the new `CLAUDE.md`; the wipe itself is the first implementation sub-issue.

## Notes

Settled at charting (2026-10-29, with the user):

- **Scope:** the full v1 of `reference/source-spec.md`, not a first slice. Built incrementally: simple
  solutions first, more complex ones only where needed, code always clean.
- **Repo:** same repo `radema/finance-os`, emptied and restarted. Old code stays in git history only.
  Standalone app, not a Finance OS module (closes the source spec's open question on this).
- **Old governance does not apply.** The repo `CLAUDE.md`, the RFC corpus in `docs/seed/`, invariants
  I-*, contracts C1-C6 and ratifications P* describe the old app. Ignore them for this effort.
- **Language:** code, identifiers, commits and assets in English. UI in English with an Italian
  glossary (as the source spec and the mock). Chat with the user in Italian.
- **Look and feel:** colours = palette D of the user's Substack (`reference/palette-substack-d.md`).
  Tone, chart style and cleanliness = OE Data Viz exhibit rules (`reference/oe-dataviz-README.md`,
  `reference/oe-dataviz-tokens.json`) — the rules and type scale, not the OE brand colours.
  UI/UX of the mock is a starting point to improve, not a target.
- **Tracker:** hybrid. Map, decision tickets and spec live here in `.scratch/gbi-v1/`. Implementation
  tickets go to GitHub issues on `radema/finance-os` (ticket-loop reads GitHub parent issues).
- **GitHub account:** personal `radema`. Run `gh auth switch -u radema` before any `gh` call (the
  active account may be the work one). Git email `rauldemaio@gmail.com`.
- **Install and data:** the app is installed on the user's personal MacBook, with a fitting install
  mode (ticket 05). Data always stays local; nothing goes to a cloud service.
  Downloading public data (prices) from the internet is fine; user data is never sent out.
- **Excel v2:** `/mnt/c/Users/RaulDeMaio/Downloads/gbi-planner-v2.xlsx` (sha256 prefix
  `e94d5394c637673b`). The source spec's parity baseline, but it may contain errors: read it
  critically, never as ground truth. Do not commit it or its personal figures.
- **Stack:** TypeScript end to end, see ticket 05.
- **Mock:** `reference/mock-app.html` — its JS engine is the reference implementation of the formulas.
- **v2 backlog:** anything a ticket defers goes to the spec's "v2 candidates" section (ticket 10); ticket 15 publishes it as one issue "GBI v2 backlog".
- Skills: `/grilling` and `/domain-modeling` (default), `/prototype` (UI), `/research`, `dataviz`,
  then `/to-spec` and `/to-tickets` at the end.

## Assets

Folder: `.scratch/gbi-v1/` — research findings in `research/NN-<slug>.md`, prototypes in
`prototypes/`, copied inputs in `reference/`. Language: English.

## Decisions so far

<!-- one line per closed ticket -->

- [01 — Storage engine](issues/01-storage-engine.md) — SQLite (WAL, STRICT, money as cents/Decimal) recommended; DuckDB 2.0 server mode not useful for one local user; final call in 05.
- [02 — Price providers](issues/02-price-providers.md) — Yahoo for .MI ETFs only (tested, works; library is yahoo-finance2 per 05); BTP and pension manual/CSV; no second adapter in v1, EODHD as later fallback.
- [03 — Fineco facts](issues/03-fineco-facts.md) — 0.19%/2.95/19 holds only on the Trading plan; bond min 2.95 or 5.95; zero-commission = per-product flag; export format not public (needs 09).
- [04 — Excel v2 audit](issues/04-excel-v2-audit.md) — no cached values, so no parity baseline yet; deterministic tax logic agrees; Excel errors (typed PMC, unseeded MC…) and mock bug M1 listed; E9/S1/S4 go to ticket 12.
- [05 — Stack](issues/05-stack.md) — all TypeScript: Node 24 local server + React/Vite + ECharts, SQLite via node:sqlite + Kysely, pnpm with supply-chain guards, configurable data folder, `gbi` command on the MacBook.
- [06 — Keep/drop and new CLAUDE.md](issues/06-keep-drop.md) — tag `finance-os-legacy` then delete all old code/docs/design/demo; keep `.scratch/gbi-v1/` as source of truth during build; gate without Playwright; short CLAUDE.md drafted.
- [07 — Financial-independence levels](issues/07-fi-levels.md) — multipliers on monthly expenses (300/200) confirmed; L1 = EF goal or months, measured without pension; pension counts by default (net, exit tax of year t); FI wealth net everywhere; targets grow with expenseGrowth; dashboard adds % of target per year.
- [08 — Import: first broker format and multi-bucket trades](issues/08-import-rules.md) — Fineco XLSX preset only (ISIN match, `Operazione` date, A/V, fee column, Controvalore as check); multi-bucket rows: one bucket, split by weights or by units, always confirmed; opening via a "Current portfolio" form (fiscal PMC), rows before it skipped; new `coupon` type, recorded by default.
- [10 — Tracking model](issues/10-tracking-model.md) — snapshots monthly auto (catch-up on first start) + manual; contribution plan versioned, plan vs actual cumulative with monthly series; R1 after N=3 months behind (configurable); per-product caps only; dismissal keys per rule; v2 backlog section + one GitHub issue.
- [11 — UI direction](issues/11-ui-direction.md) — approved prototype in prototypes/11-ui: desktop-first fluid grid, 7-section sidebar, palette D with per-goal colours + tints, chips/tags, legends, sticky table headers, Geist, larger type, no card outlines.
- [09 — Fineco export sample](issues/09-fineco-sample.md) — XLSX in real/ (gitignored): 5 metadata rows, header row 6, text dates DD/MM/YYYY, Segno A/V, coupons as 'Stacco Cedole'; match by Isin.
- [12 — Engine reference when Excel, spec and mock disagree](issues/12-engine-reference.md) — spec/mock win over Excel (E1-E8, M1 fixed); pro-rata stub year, BTP `couponRate`, commissions in basis, yearly pension mix; pension valued in full with a 50%-capital warning; no Excel parity: golden cases + mock differential + synthetic JSON fixture.

## Not yet specified

- Perf budgets in the source spec (dashboard < 2 s, optimizer < 3 s): confirm or trim.
- Glossary content (Italian terms, plain explanations) and method notes.

## Out of scope

- Everything in the source spec's "Non-goals (v1)": multi-user, several broker accounts, automatic
  trading, tax filing, decumulation, glide paths, regime dichiarativo, non-EUR currencies.
- Building this as a module of the old Finance OS (shared Bucket/Rule/Alert concepts) — the user chose
  a standalone restart.
