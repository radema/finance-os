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
- **Excel v2:** `/mnt/c/Users/RaulDeMaio/Downloads/gbi-planner-v2.xlsx` (sha256 prefix
  `e94d5394c637673b`). The source spec's parity baseline, but it may contain errors: read it
  critically, never as ground truth. Do not commit it or its personal figures.
- **Mock:** `reference/mock-app.html` — its JS engine is the reference implementation of the formulas.
- Skills: `/grilling` and `/domain-modeling` (default), `/prototype` (UI), `/research`, `dataviz`,
  then `/to-spec` and `/to-tickets` at the end.

## Assets

Folder: `.scratch/gbi-v1/` — research findings in `research/NN-<slug>.md`, prototypes in
`prototypes/`, copied inputs in `reference/`. Language: English.

## Decisions so far

<!-- one line per closed ticket -->

- [03 — Fineco facts](issues/03-fineco-facts.md) — 0.19%/2.95/19 holds only on the Trading plan; bond min 2.95 or 5.95; zero-commission = per-product flag; export format not public (needs 09).

## Not yet specified

- Packaging and running: one Docker image vs `uv run` only; how the monthly job (prices + snapshot)
  runs on a local app with no daemon. Depends on the stack ticket.
- Excel discrepancies: each one the audit finds may need its own decision, beyond the engine-reference
  ticket.
- Test tooling beyond the engine (Playwright smoke, perf budgets in the source spec): confirm or trim
  once the stack is known.
- Glossary content (Italian terms, plain explanations) and method notes.

## Out of scope

- Everything in the source spec's "Non-goals (v1)": multi-user, several broker accounts, automatic
  trading, tax filing, decumulation, glide paths, regime dichiarativo, non-EUR currencies.
- Building this as a module of the old Finance OS (shared Bucket/Rule/Alert concepts) — the user chose
  a standalone restart.
