# ADR-L03 — Charting library (ECharts, vendored) and UI language (Italian copy, English code)

| | |
|---|---|
| **Status** | Accepted — ratifies two choices already made by the product owner |
| **Date** | 2026-07-26 |
| **Resolves** | RFC-0005 §10.4 (chart library, deferred); RFC-0008 §12.1 + UX-0001 §6.1 (rationale localization / UI language) |
| **Depends on** | ADR-0007 (FastAPI + Jinja2 + HTMX, no build step, no npm), ADR-0008 (single process, on-demand ingestion → Local First), RFC-0005 §5.7 / §7 contract C5 (Privacy First, no HTTP client in `core`/`app`), ADR-0009 (strategy files as canonical derived artifacts), ADR-0023 (`rationale` assembled from `StrategyVersion`), RFC-0009 §6 (charts read the as-recorded series), RFC-0003 (Ubiquitous Language, Italian) |
| **Supersedes** | UX-0001 §6.4 (chart library "sidestepped" — CSS bars); UX-0001 §6.1 (English UI, self-described Low confidence) |

---

## 1. Context

Two decisions had been taken by the product owner but existed nowhere in the corpus, so both were on track to be re-litigated by whoever wrote the first chart or the first template.

**(a) Charts.** RFC-0005 §10.4 deferred the choice: *"Deferred until charts exist; both ECharts and Plotly.js are vendorable static files, and nothing depends on the choice."* RFC-0005 §5.4 had already fixed the shape — *"charts via a JS charting library from a vendored static file"* — and RFC-0005 §8.2 kept charts out of the skeleton entirely. The UX mock then sidestepped it again (UX-0001 §6.4: *"The mock's two charts are CSS bars with no library at all… Enough for a sparkline and a snapshot series; not enough for anything V1.2 wants"*, confidence *"Medium — it is a deferral, not a decision"*). Meanwhile UX-0001 §3 already routes `GET /findings/{key}/severity` for a severity sparkline (RFC-0008 §12.3), and RFC-0009 §6 requires the snapshot series to be annotated at reclassification dates from `asset_classification_audit` — neither of which CSS bars can render.

**(b) UI language.** RFC-0008 §12.1 deferred rationale localization *"until the UI language is fixed"*, warning that *"an Italian UI over English-authored `StrategyVersion` prose would mix languages mid-sentence"*. UX-0001 §6.1 took the opposite position — English UI over English-authored strategy prose — rated its own confidence **Low**, called it *"a real fork"*, and instructed: *"Decide this before writing rationale templates, not after"* (repeated as build-order step 5, §9). The corpus's source documents (RFC-0001–0003) are Italian, and the Manifest's P3 example is Italian: *"**Secondo la tua strategia**, l'allocazione è fuori target del 6%."*

This ADR records both decisions with their reasoning, so neither is re-opened by accident and both are traceable from the code that depends on them.

---

## 2. Decision Drivers

**Shared**

- **Local First (ADR-0008, RFC-0005 §5.7).** *"No account, no network dependency for any core function."* The app must render fully with no network.
- **Privacy First (RFC-0005 §5.7, contract C5).** *"Zero telemetry. The only egress is the explicit market-data fetch."* A CDN reference is egress — per page view, to a third party, carrying a referrer.
- **No build step, no npm (ADR-0007).** Anything adopted must be a committed static file that a browser loads directly.
- **Licence recorded in the ADR** — RFC-0005 §10.2 sets that expectation for external dependencies.
- **P3 / P6 / P7** — explainability in the user's own terms, and the user's own declarations as the only authority (ADR-0023).

**Charts specifically**

- Must render the two shapes the corpus already requires: a per-finding severity sparkline (RFC-0008 §12.3, UX-0001 §3) and an annotated time series over `snapshot` (RFC-0009 §5.1, §6).
- Must cooperate with HTMX fragment swapping (ADR-0007) rather than assume a single page load.
- Must not require DataFrames or any domain object to cross into `web/` (RFC-0005 §5.3: DataFrames appear only where feeding a chart, and never cross into `app/` or `core/`).

**Language specifically**

- **ADR-0023 is the constraint.** `rationale` is *assembled from* the user's frozen `StrategyVersion` — its name, targets, tolerances, horizon and declared principles. The template's language and the author's language are therefore the same sentence. Whichever language loses, that sentence code-switches.
- **The three voices (UX-0001 §4.5)**: serif is reserved for *the user's own words* — declared principles, `change_note`, assembled `rationale`, `userRationale`.
- **Canonicalization must not move.** RFC-0006 §10 and `evaluation_run.input_digest` (RFC-0009 §3.2) depend on canonical serialization; ADR-0009 makes strategy YAML a canonical derived artifact. Locale formatting must never touch any of them.
- **Solo product, one author, one user** (ADR-0010 defers commercialization posture): a full i18n layer would be machinery for a second locale that does not exist.

---

## 3. Considered Options

### 3.1 Charts

1. **CSS bars / inline SVG, no library** — the mock's status quo.
2. **ECharts, vendored** (Apache-2.0).
3. **Plotly.js, vendored** (MIT).
4. **D3, vendored** (ISC/BSD).
5. **Server-rendered images** (matplotlib/Vega-Lite → PNG/SVG endpoints).

### 3.2 UI language

1. **English UI over English-authored strategy prose** — UX-0001 §6.1's position.
2. **Italian for all user-facing copy; English for every code object** — chosen.
3. **Full i18n from V1.0** (gettext/Babel, locale negotiation).
4. **Italian everywhere, identifiers included.**

---

## 4. Decision Outcome (a) — Charts: **ECharts, vendored as a static asset**

Option 2. Apache ECharts is committed to the repository as a single minified file and served from the app's own static mount. **No CDN, no npm, no build step.** This closes RFC-0005 §10.4 and supersedes UX-0001 §6.4's deferral.

```
web/static/vendor/echarts/echarts.min.js      # pinned version, committed
web/static/vendor/echarts/LICENSE             # Apache-2.0, committed alongside
```

**Why ECharts over Plotly.js**, the only other candidate RFC-0005 §10.4 named: both are vendorable single files under permissive licences, so the tie is broken on payload and fit. ECharts' full distribution is roughly a quarter of Plotly.js' (~1 MB vs ~3.5 MB minified) and its API surface is a charting library rather than a scientific-plotting suite. It ships, in-box, the three things this product actually needs and CSS bars cannot do: `markLine`/`markPoint` annotations for RFC-0009 §6's reclassification markers on the snapshot series; a genuinely small sparkline mode (no axes, no grid, canvas-rendered) for RFC-0008 §12.3's per-finding severity series; and `dataZoom` for a multi-year series. It also has first-class light/dark theming, which the three-voice palette needs.

**Why not the others.** Option 1 cannot render an annotated series or a sparkline with a tooltip, and UX-0001 §6.4 already labels it a deferral, not a decision. Option 4 (D3) is a construction kit: every chart becomes bespoke code the single author must maintain, against ADR-0007's "no taste burden we can avoid" posture. Option 5 moves rendering server-side, adding a Python plotting dependency plus image endpoints, and losing the tooltips and zoom that make the trace-adjacent charts readable — and it would put chart rendering in the request path of the one process (ADR-0008).

**Binding rules that come with the decision**

- **No external host, anywhere.** Extend the Privacy First CI contract (RFC-0005 §7) with a test asserting that no template or static asset references an off-origin URL — `src="http`, `@import url(http`, `fetch("http`. This also closes UX-0001 §4.5's live loose end, where the mock links IBM Plex from a CDN purely so one file opens in a browser: **fonts are vendored on the same rule as the chart library**.
- **Charts read the as-recorded series** (RFC-0009 §6, ADR-0012), never a recomputation, and annotate reclassification dates from `asset_classification_audit`. An unexplained jump is a bug; an annotated one is information.
- **HTMX lifecycle.** Charts initialise on `htmx:load` for the swapped fragment and `dispose()` on `htmx:beforeSwap`, so repeated fragment swaps do not leak instances. Chart config is emitted as JSON in the fragment; no chart reads the DOM for its data.
- **Graceful degradation.** Every chart has a tabular or textual equivalent adjacent to it. The findings list, the trace ladder and the recommendation permalink — the entire P3/P7 surface (RFC-0008 §6) — must remain complete with JavaScript disabled. Charts are the one place in this app where JS is load-bearing, and nothing explanatory may live only there.
- **Typography inside charts** follows the three voices: numeric axis labels and tooltips in IBM Plex Mono, series names and titles in IBM Plex Sans.
- **DTO boundary unchanged** (RFC-0005 §5.3): a chart endpoint returns a typed DTO or JSON assembled in `adapters/duckdb/queries/`; no domain object and no DataFrame reaches a template.

---

## 5. Decision Outcome (b) — Language: **Italian user-facing copy, English code objects**

Option 2, overriding UX-0001 §6.1 and answering RFC-0008 §12.1.

| Surface | Language |
|---|---|
| Web chrome, navigation, labels, buttons, empty and error states | **Italian** |
| `observation` text and every `MessageTemplate` (RFC-0008 §5.1) | **Italian** |
| Assembled `rationale` templates (ADR-0023) | **Italian** |
| Enum *display labels* — `AssetClass`, `SuggestionClass`, `Priority`, outcomes | **Italian** |
| CLI human-readable messages, warnings, import summaries | **Italian** |
| Number, currency and date *formatting* in the UI | **it-IT** |
| Identifiers: modules, classes, functions, columns, enum members, template filenames, route paths | **English** |
| CLI command and flag names (`financeos evaluate`, `--as-of`) | **English** |
| Strategy YAML **keys** (ADR-0009 canonical artifact); trace JSON keys and step names (RFC-0006 §4.1) | **English** |
| Trace JSON values, `input_digest` inputs, `demo/expected/`, canonical exports | **canonical, locale-free** |
| RFCs, ADRs, code comments, commit messages | **English**, with Ubiquitous Language terms Italian verbatim (RFC-0011 header convention) |

**Why.** ADR-0023 settles it. The rationale is not authored per rule — it is *assembled by citing the user's own frozen strategy*: its name, its declared principle, its `change_note`. The user is Italian and authors that prose in Italian. An English template wrapping Italian principle text produces exactly the mid-sentence code-switch RFC-0008 §12.1 warns about, only with the languages swapped from the way UX-0001 §6.1 imagined — and it degrades the one sentence the entire product exists to produce (Manifest P3, whose canonical example is Italian). The three voices reinforce this: the serif voice *is* the user's own words; those words are Italian, so the surrounding sans-serif chrome must be too, or the typographic distinction becomes a language distinction and stops meaning "whose voice is this".

Option 1 is rejected on that ground: it forces the author to write their strategy's principles in English to keep one sentence coherent, which inverts P6 (the user's declaration is the authority; the system accommodates it). Option 3 is rejected as speculative machinery — an extraction/compilation step for one locale, against ADR-0007's no-build-step promise; it stays reachable additively (§6). Option 4 is rejected because RFC-0011's own header states the convention — *"Language: English. Ubiquitous Language verbatim per RFC-0003"* — and Italian identifiers would break every tool, library idiom and agent-assisted workflow the architecture depends on, for zero user benefit.

### 5.1 Implication for the assembled-rationale templates (ADR-0023)

Italian assembly is not English assembly with different strings, because Italian requires agreement where English requires none. *"Equity/Developed is below target"* concatenates cleanly; *"…è **inferiore** al target"* vs *"…è **inferiore** alla soglia"* does not, and neither does the article on an interpolated class name (*il* target, *la* classe, *l'*allocazione, *in* Azioni vs *nelle* Obbligazioni).

Consequences, all of which are code:

1. **A display-label module is first-class, not a `.title()` call.** Every enum that reaches a template — `AssetClass`, `SuggestionClass`, `Priority`, `Outcome`, `OperationType`, skip reasons — needs an explicit Italian label carrying its **grammatical gender and number**, plus the preposition form the templates need. Identifier-to-label mapping is a lookup table (a Jinja filter over a single label registry), never a string transformation of the identifier.
2. **Templates interpolate labels, never identifiers.** `EQUITY_DEVELOPED` must never reach a rendered sentence.
3. **Sentence skeletons are authored per template, with agreement baked in**, and the interpolation points are typed (label-with-gender, `Money`, `Percentage`, `Decimal`, date). This is also what keeps ADR-0023's promise checkable: the generator's only inputs are the user's frozen statements plus trace bindings.
4. **`rationale` and `observation` remain frozen into the row at creation** (RFC-0008 §5.1). A copy revision therefore does **not** retroactively change historical recommendations — correct under P7, and a reason golden-file tests must not assert on rendered prose.
5. **A weakly-articulated Strategy still produces a visibly weak rationale** (RFC-0008 §5.2). Unchanged, and now in the language the user wrote it in, so the feedback is legible.

### 5.2 Numbers, and the mono voice

Locale formatting is a **presentation function applied in templates only**. it-IT conventions (decimal comma, thousands dot, `dd/mm/yyyy`, `€` placement) apply to every number rendered in the UI — including numbers in the mono voice, since typography and numeral formatting are orthogonal: IBM Plex Mono continues to mark *"this is a machine-verifiable value"*, and it-IT formatting makes it readable to the person verifying it.

The canonical, locale-free form is what the trace JSON stores, what `input_digest` hashes (RFC-0009 §3.2), what `demo/expected/` compares, and what `financeos export --authored` (RFC-0009 §7.1) and ADR-0009's strategy YAML emit. **No formatting function may be called anywhere under `core/`.** Verifiability against the stored trace is preserved by the recommendation permalink's raw-trace view (RFC-0008 §6), which shows canonical values.

### 5.3 What must stay in Italian and keep its bite

ADR-0016's discipline is carried by copy, so the copy must be authored, not translated: the skip banner (UX-0001 §4.4 — *"skipping is not compliance"*), the `SKIPPED`/`ERROR` chip labels, the negative-`UNASSIGNED` explanation (RFC-0011 §7's teaching burden), and the "no band on this node" marker (UX-0001 §6.3). A limp Italian rendering of *"skipping is not compliance"* would quietly undo the decision it exists to enforce.

---

## 6. Consequences

**Positive**

- Two live open questions close (RFC-0005 §10.4, RFC-0008 §12.1 / UX-0001 §6.1), and UX-0001's build-order steps 5 and its §6.4 deferral are both discharged — templates can now be written.
- Local First and Privacy First become *stronger*, not just preserved: vendoring the chart library forces the no-external-host CI contract that also removes the mock's CDN font link, so the app genuinely renders offline with zero third-party egress.
- The corpus's requirements for charts (annotated as-recorded series, per-finding severity sparkline) are satisfiable now instead of at V1.2.
- ADR-0023's rationale becomes a single-language sentence in the user's language, making P3 literally true rather than nearly true.
- The three-voice typography stops being decorative. It is the only remaining signal distinguishing the system's arithmetic from the user's own words, since language no longer separates them — worth recording, because UX-0001 §5.2 lists the typography under *"invented, change freely"*, and after this decision it is load-bearing.

**Negative / accepted costs**

- **~1 MB of vendored JavaScript in the repository**, updated by hand with no dependency tooling, and a licence file to keep current. Irrelevant over localhost; a real (small) maintenance and supply-chain review obligation on each version bump.
- **JavaScript becomes load-bearing for one surface.** Mitigated by the mandatory tabular equivalent and by keeping the entire explanation surface JS-free.
- **A label registry with grammatical metadata is real work** and a real ongoing obligation: every new enum member needs a label with gender before it can be rendered. Mechanical, but it fails loudly rather than silently — which is the intent.
- **Two number formats exist in the system** (it-IT for display, canonical for storage/export/digest). The boundary is templates. Any leak into `core/` or into a golden file is a bug, and the golden-file tests must compare canonical values only, never rendered copy.
- **The technical corpus stays English while the product speaks Italian.** A permanent, deliberate seam: developer-facing artifacts (RFCs, ADRs, identifiers, YAML keys, trace keys) in English; everything a user reads in Italian. Contributors must know which side of the seam they are on — the same class of cognitive cost RFC-0005 §9 accepted for the read/write code shapes.
- **Localization is deferred, not designed.** If a second locale is ever wanted, the extraction points are the Jinja2 templates plus the label registry, and nothing in `core/` carries a locale — but the Italian templates will need restructuring for languages whose agreement rules differ, and ADR-0010's deferral of commercialization posture is what makes that acceptable today.

---

## 7. Open items for the product owner

1. **ECharts distribution flavour.** Full `echarts.min.js` (~1 MB, no tooling) or a pre-built custom bundle with only the used chart types (~300 KB, but built once by hand and therefore a step ADR-0007 would rather not have)? Recommend the full file until page weight over localhost becomes a complaint — i.e. never.
2. **CLI language.** This ADR puts CLI human-readable output in Italian while command and flag names stay English. If the CLI is regarded as a developer surface rather than a user surface, English output is equally defensible; the split above is the one that treats the single author-user consistently.
3. **Strategy YAML free-text expectations.** Keys are English and values (`name`, `change_note`, `principles`, `objective`) are the user's Italian prose. Worth confirming that `import-strategy` never validates or normalizes those values, since they flow verbatim into the serif voice under ADR-0023.
