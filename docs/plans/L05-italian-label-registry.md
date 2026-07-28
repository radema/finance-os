# L05 — The Italian label registry, with grammatical agreement

| | |
|---|---|
| **Status** | Proposed — design settled; the Italian *wording* is proposed and awaits product-owner ratification (§8) |
| **Date** | 2026-07-28 |
| **Closes** | HANDOFF-2026-07-26 §5.5 gap 1; the second follow-up in §3.6 (`asset_class_label` is mechanical) |
| **Implements** | ADR-L03 §5.1 consequence 1 ("a display-label module is first-class, not a `.title()` call") and §5.1 consequence 2 ("templates interpolate labels, never identifiers") |
| **Depends on** | ADR-L03 (P2, Italian copy / English code) · ADR-0023 (rationale assembled from the frozen `StrategyVersion`) · RFC-0008 §5.1 (`observation` and `rationale` frozen at creation) · RFC-0005 §7 contracts C1–C5 · RFC-0006 §11 (registry completeness fails the build) · P14 (dot decimals stored, localised in the view) · P8 (private now, productizable later) · **P16** (`over_apportioned` findings may name the instrument) · ADR-L04 |
| **Constrains** | W1c plumbing (§7.4, §9.2) · W1d screens (§4, §5) · gap 2, the it-IT filters (§7) |
| **Non-goals** | The it-IT number/currency/date filters (gap 2 — this document fixes only the boundary, §7) · a general i18n layer (ADR-L03 §3.2 option 3, rejected) · Italian for identifiers (rejected, ADR-L03 §5) |

This is a specification. It contains no production code and touches nothing under `src/`. Every
Italian surface string in §5 is **proposed** and is the product owner's to ratify (§8); everything in
§2, §3, §4, §6 and §7 is design and grammar, which is not the owner's burden.

---

## 1. The problem, stated precisely

ADR-L03 fixed the language: Italian for everything a user reads, English for every identifier. It also
named the consequence that makes Italian different from English assembly — **agreement**. English
concatenates: *"Equity/Developed is below target"*. Italian does not:

- the article inflects with the noun: *il* target, *la* classe, *l’*allocazione, *le* Azioni;
- prepositions fuse with the article: *in* + *le* → **nelle** Obbligazioni, *di* + *la* → **della** classe;
- the verb agrees in number: *"le Azioni **sono** al 34%"* but *"la Liquidità **è** al 12%"*;
- participles and adjectives agree in gender and number: *investit**o** / investit**a** / investit**i** / investit**e***.

Today none of this exists. There is one function, `asset_class_label` in
`src/financeos/core/shared/ids.py:52`, which mechanically transliterates the key:

```python
def asset_class_label(asset_class: str) -> str:
    return "/".join(part.capitalize() for part in asset_class.split("_"))
```

`EQUITY_DEVELOPED → Equity/Developed`. Its own docstring calls it a placeholder: *"A real label table
is a V1.0 taxonomy concern."* It is called from exactly two places, and they are on opposite sides of
the freeze boundary:

| Call site | What it feeds | Frozen? |
|---|---|---|
| `core/engines/rule_engine.py:110` (`FactSet.label_for`) → `:620` (`_drift_message_bindings`) | the `asset_class_label` message binding → `Recommendation.observation` | **yes**, at creation |
| `core/engines/decision_engine.py:201` (`assemble_rationale`) | `Recommendation.rationale` | **yes**, at creation |

Both produce Italian prose *today* — `rule_engine.py:645` and `decision_engine.py:199–213` are full of
hardcoded Italian — with an English-looking taxonomy label wedged into the middle of it:

> *"Equity/Developed è al 34.00% contro un target del 40.00% (banda ±2.00pp)…"*

So the registry is not new machinery being introduced into a clean core. It is **one declared table
replacing Italian copy that is already scattered across two engines.** That reframing decides §2.

---

## 2. Where it lives in the layering

### 2.1 The criterion

> **An entry belongs to the core tier if, and only if, its surface form can be interpolated into a
> string that is frozen into a persisted row — `Recommendation.observation` or
> `Recommendation.rationale`. Everything else is chrome and lives in the web tier.**

This is not a taste boundary; it is the freeze boundary, and it is mechanically checkable (§6.3). The
answer therefore **does differ for rationale versus chrome**, exactly as the brief anticipated, and
here is the split it produces:

| Tier | Module | Holds | Why it cannot live in the other tier |
|---|---|---|---|
| **Core** | `src/financeos/core/shared/labels.py` | taxonomy keys (asset classes, interior target nodes, `UNASSIGNED`), the two `ToleranceKind` values, the single fallback frame noun, and all composition machinery | `assemble_rationale` and `_drift_message_bindings` run **inside `core/engines/`**, and **C1 forbids `core` importing `web`**. There is no legal way for a web-layer table to reach them. |
| **Web** | `src/financeos/web/labels.py` | `Outcome`, `Priority`, `SkipReason`, `SuggestionClass`, `ScopeKind`, `RunMode`, `OperationType`, `RiskLevel`, the frame nouns, and the Jinja filter registration | None of these ever enters a frozen row. Keeping them out of `core` means a copy revision — the most frequent change this table will see — never touches the domain layer. |

### 2.2 Argued against C1 (core purity), verbatim

C1's `forbidden_modules` (`pyproject.toml`, quoted from the live file) are
`financeos.adapters`, `financeos.web`, `financeos.app`, `duckdb`, `fastapi`, `pandas`, `polars`,
`httpx`, `requests`. **C1 is a statement about I/O, frameworks and layer direction. It says nothing
about human language**, and it cannot, because Italian prose is already in `core/engines/` today and
C1 is green. A frozen mapping of `str → str` is exactly as pure as `Percentage`: no I/O, no clock, no
framework, deterministic, total.

The stronger purity argument is the one *for* the core tier: `core/shared/labels.py` **reduces** the
copy surface in `core`. Two engines currently hold ad-hoc Italian fragments; afterwards they hold
sentence skeletons plus lookups against one declared table. ADR-L03 §6 already accepted "a label
registry with grammatical metadata is real work" as a consequence of P2; this is where that work lands.

`core/shared` is also the *only* correct package within `core`: its own docstring calls it "the only
`core` package a bounded context may import", and it is where `AssetClass` and `asset_class_label`
already live — for the reason §3.6 C-1 records, that these types cross contexts and C3 would otherwise
be unsatisfiable. This document completes an existing module rather than inventing a layer.

### 2.3 Argued against C3 and C4

**C3 — context isolation** (`independence` over `core.{cashflow,portfolio,strategy,market,decision}`).
`core.shared` is outside that list, so the contract does not name it — but importing `core.strategy`
from `core.shared` would create a cycle, since `core.strategy` imports `core.shared`. Therefore:

> **The registry keys on plain `str` and imports no enum.** `Mapping[str, LabelEntry]`.

Every enum involved is a `StrEnum`, so a member is already a `str` and indexes a `str`-keyed mapping
directly: `CHROME_LABELS[Outcome.SKIPPED]` works with no `.value` and no import edge. The registry
therefore has **zero import edges into any bounded context** — the cleanest possible answer to C3 —
and the completeness test (§6.3) is where the enums get imported, because tests are outside the
contracts.

**C4 — read/write split.** `adapters.duckdb.queries` may be imported only by `web`. The registry is
neither a query nor a repository, so C4 does not reach it. It does bear on §7.2: the localised
`observation` a template renders is assembled in `adapters/duckdb/queries/` as a field of a typed DTO
(RFC-0005 §5.3), so no domain object crosses into a template merely to get a label.

### 2.4 The one thing not duplicated

`web/labels.py` **imports the asset-class entries from `core.shared.labels` rather than restating
them.** Nothing forbids `web → core` (C1 constrains `core`'s imports, C4 constrains `app`'s), and a
second taxonomy table is the actual architectural defect available here: two tables drifting apart is
precisely the failure P12 recorded when the chrome committed to one identity and the charts to another.
One table, two consumers.

---

## 3. The data shape

### 3.1 Two entry kinds, because two grammatical situations exist

A label that can take an article ("le Azioni", "delle Azioni") is grammatically different from a chip
that never can ("Non valutata"). Conflating them produces `la Scattata`. So:

```python
class LabelEntry(DomainModel):        # nominal: composes with articles and prepositions
    noun: str                        # bare noun phrase, no article, capitalised per §5.1
    form: ArticleForm                # one of eight; determines gender, number and every surface
    short: str | None = None         # non-syntactic compact form (axis, legend, cell, rail)
    gloss: str | None = None         # one teaching sentence, where a contract demands one

class TermEntry(DomainModel):        # atomic: never takes an article or a preposition
    text: str
    short: str | None = None
    gloss: str | None = None
```

`label(key, role=…)` **raises** for any role other than `BARE` against a `TermEntry`. The registry can
refuse an ungrammatical request; that is most of its value.

### 3.2 `ArticleForm` — gender and number, made unrepresentable-if-wrong

Storing five preposition strings per entry as free text invites an entry whose gender and articles
disagree. Instead each nominal entry declares **one** field, and all articles and contractions derive
from an eight-row constant. Gender and number are then *derived properties* of the entry — carried, as
the brief requires, but impossible to declare inconsistently. This is the corpus's own idiom (I-14,
RFC-0004: "made unrepresentable-if-violated").

| `ArticleForm` | gender | number | definite | indefinite | `di` + | `a` + | `da` + | `in` + | `su` + |
|---|---|---|---|---|---|---|---|---|---|
| `MS_IL` | M | SG | il | un | del | al | dal | nel | sul |
| `MS_LO` | M | SG | lo | uno | dello | allo | dallo | nello | sullo |
| `MS_ELIDED` | M | SG | l’ | un | dell’ | all’ | dall’ | nell’ | sull’ |
| `MP_I` | M | PL | i | — | dei | ai | dai | nei | sui |
| `MP_GLI` | M | PL | gli | — | degli | agli | dagli | negli | sugli |
| `FS_LA` | F | SG | la | una | della | alla | dalla | nella | sulla |
| `FS_ELIDED` | F | SG | l’ | un’ | dell’ | all’ | dall’ | nell’ | sull’ |
| `FP_LE` | F | PL | le | — | delle | alle | dalle | nelle | sulle |

`MS_LO` / `MP_GLI` exist because Italian requires them before *s* + consonant, *z*, *gn*, *ps*, *x*,
*y* and semivocalic *i* — "lo Zinco", "gli Pseudo-titoli". **The forms are stored, never computed from
spelling**: an orthographic rule for Italian articles has enough exceptions that deriving them is a
guaranteed source of wrong output, and the cost of storing them is one enum member per entry.

### 3.3 Which prepositions, and why exactly these

The table covers **the five prepositions Italian obligatorily contracts with the definite article** —
`di`, `a`, `da`, `in`, `su`. That is the whole obligatory set; it is a closed fact about the language,
not a guess about future copy, and it costs five columns of one eight-row constant.

Deliberately absent, with reasons:

- **`per`** never contracts. `per le Azioni` is the article form preceded by a literal word, so a
  template may safely write `per` next to a label. The precise rule is therefore: *a template never
  hard-codes a **contracting** preposition adjacent to a label slot.*
- **`con`** contracts only optionally and `col`/`coi` now read as colloquial; modern standard Italian
  writes `con il`, which is again article-plus-literal.

Of the five, **only `di`, `a`, `in` and `su` appear in emitted copy today**; `da` is included because
excluding one member of a closed obligatory set is how the table later becomes inconsistent.

### 3.4 The elision join rule

Elided forms bind to the noun with no space (`l’allocazione`, `dell’Immobiliare`); the others take one
space (`le Azioni`, `delle Azioni`). One total rule, provable against the table in §3.2:

> **If the resolved prefix ends in `’` (U+2019), join with the empty string; otherwise join with one
> space.**

The registry uses **U+2019** throughout, matching the guillemets `«…»` already used in
`decision_engine.py:207`. A validator rejects any form or noun containing an ASCII `'`, so the join
rule cannot be defeated by a typo.

### 3.5 `short` — and the hard rule attached to it

`short` exists because real contracts demand it: `chart` takes a `legend`, `tolerance_rail` takes a
`target_label`, and the allocation table takes cell values. "Obbligazioni societarie investment grade"
does not fit an axis label.

> **`short` is used only in non-syntactic positions — axis labels, legends, table cells, chips, rail
> captions. It is never composed with an article, a preposition or a verb.**

This rule is load-bearing, not stylistic: shorts such as "Sviluppati" are adjectives standing in for an
elided masculine noun (*paesi*), so their apparent gender contradicts the entry's. Composing them
would produce `le Sviluppati`. `label(key, role=…)` never reads `short`; only the `label_short` filter
does.

### 3.6 `gloss`

One optional teaching sentence, present only where a shipped interface asks for one:
`skip_notice.html` requires `reasons[{reason, count, explanation}]`, and the `UNASSIGNED` pseudo-row
carries RFC-0011 §7's teaching burden (a negative residual is a deficit, and is legal). Not
speculative: every `gloss` in §5 has a named consumer.

---

## 4. The composition rule

### 4.1 The template declares the role; the registry supplies the surface

```python
class Role(StrEnum):
    BARE = "bare"          # Azioni dei paesi sviluppati
    THE  = "the"           # le Azioni dei paesi sviluppati
    A    = "a"             # una Liquidità   (indefinite; illegal for plurals)
    OF   = "of"            # delle Azioni dei paesi sviluppati
    TO   = "to"            # alle …
    FROM = "from"          # dalle …
    IN   = "in"            # nelle …
    ON   = "on"            # sulle …

def label(key: str, *, role: Role = Role.BARE, sentence_initial: bool = False) -> str
def copula(key: str) -> str                    # "è" | "sono"
def agree(key: str, masculine_singular: str) -> str   # investito → investita | investiti | investite
```

Three notes that are each a bug prevented:

1. **`sentence_initial` uppercases the first character only** — `s[0].upper() + s[1:]`. Never
   `str.capitalize()`, which lowercases the remainder and would turn `le Azioni` into `Le azioni`,
   silently destroying the §5.1 capitalisation convention.
2. **`agree` handles only regular adjectives**, keyed on the final vowel of the masculine singular:
   `-o` → `-o/-a/-i/-e`, `-e` → `-e/-e/-i/-i`. That covers every adjective the copy uses
   (*investito, esposto, allocato, dichiarato, sovrappesato, coerente*). An irregular adjective must
   not be routed through `agree`; rewrite the sentence instead.
3. **`Role.A` raises for plural entries** — Italian has no plural indefinite article, and the honest
   answer is a template rewrite, not a silent partitive.

### 4.2 Three access paths, because the render mechanisms genuinely differ

| Where | Mechanism | How the registry is reached |
|---|---|---|
| `assemble_rationale` (core, f-strings) | Python f-string | **calls `label()` directly** |
| `observation` (core, `str.format` over flat `Mapping[str, str]`) | `rule.message.format(**message_bindings)` — **cannot call a function** | **agreement is resolved at binding time**, into extra message bindings |
| Chrome (`web`, Jinja) | Jinja filters | `{{ key\|label("in") }}`, `\|label_cap`, `\|label_short`, `\|label_gloss` |

The middle row is the constraint that shapes the design. `render_observation`
(`decision_engine.py:168–180`) validates `Formatter().parse(rule.message)` against the binding names
and then calls `str.format`; there is no filter, no expression, no function call available inside a
`MessageTemplate`. **So the core tier must pre-resolve every needed surface form into bindings.**
`_drift_message_bindings` (`rule_engine.py:615`) gains, per label-bearing param:

```
asset_class_label            Azioni dei paesi sviluppati      (existing key, unchanged)
asset_class_label_the        le Azioni dei paesi sviluppati
asset_class_label_the_cap    Le Azioni dei paesi sviluppati
asset_class_label_of         delle Azioni dei paesi sviluppati
asset_class_label_in         nelle Azioni dei paesi sviluppati
asset_class_copula           sono
```

Naming rule: `<param>_label_<role>`, `<param>_label_<role>_cap`, `<param>_copula`. All English.

> **Message bindings are append-only.** A `MessageTemplate` is frozen inside `StrategyVersion.rules`
> (`core/strategy/rule.py:51`), so an old template must keep rendering against new traces — which it
> does, since `str.format` ignores surplus keys and `render_observation` only checks that required
> names are *present*. Removing or renaming a binding, by contrast, breaks every frozen template that
> cites it. This is the same append-only posture the schema already takes.

### 4.3 Worked, on four real strings

**(A) The canonical fixture observation** — UX-0001 §8's anchor row, EQ/DEV in Pension. Current
registered template, `rule_engine.py:644–648`:

```
{asset_class_label} è al {current_pct}% contro un target del {target_pct}%
(banda ±{tolerance_pct}pp): scostamento di {drift_pct}pp ({drift_value} {currency}).
```

It is **already grammatically wrong** for four of the fixture's six classes: `Azioni` is feminine
plural, so `è` must be `sono`. Proposed template:

```
{asset_class_label_the_cap} {asset_class_copula} al {current_pct}% contro un target del
{target_pct}% (tolleranza ±{tolerance_pct}pp): scostamento di {drift_pct}pp
({drift_value} {currency}).
```

Stored (P14 — dot decimals, canonical):

> Le Azioni dei paesi sviluppati sono al 34.00% contro un target del 40.00% (tolleranza ±2.00pp): scostamento di -6.00pp (-3240.00 EUR).

Displayed (§7):

> Le Azioni dei paesi sviluppati sono al 34,00% contro un target del 40,00% (tolleranza ±2,00pp): scostamento di −6,00pp (−€3.240,00).

The same template over `CASH` — a feminine **singular** — agrees without a second template:

> La Liquidità è al 12,00% contro un target del 10,00% (tolleranza ±3,00pp): scostamento di +2,00pp (+€2.151,73).

**(B) The assembled rationale** — `decision_engine.py:183–214`. The only change is the call at line
201: `asset_class_label(leaf.asset_class)` → `label(leaf.asset_class, role=Role.THE)`, since `per`
does not contract (§3.3).

> La tua strategia «Crescita di lungo termine» (congelata il 12/03/2026) prevede un target del 40.00% per **le Azioni dei paesi sviluppati** con una banda di ±2.00pp, su un orizzonte di 20 anni. Principio dichiarato: «Preservare il potere d’acquisto senza inseguire il mercato».

Today that same sentence reads *"…per Equity/Developed con…"*. Note also `_band_phrase`
(`decision_engine.py:225–230`) keeps its two authored phrases verbatim: **sentence skeletons stay
authored per ADR-L03 §5.1 point 3; the registry supplies nominal surfaces, never whole clauses.**

**(C) Chrome, with a contracted preposition** — the allocation screen, `nelle` being ADR-L03 §5.1's own
motivating example:

```jinja
Il {{ weight|pct }} del patrimonio netto è investito {{ "BOND_GOV_EUR"|label("in") }}.
```

> Il 27,90% del patrimonio netto è investito **nelle Obbligazioni governative in euro**.

And the elision path, on a class that will exist once E12 lands — `REAL_ESTATE`, `MS_ELIDED`:

> Il 4,00% del patrimonio netto è investito **nell’Immobiliare**.

**(D) Chrome, with a `TermEntry` and a `gloss`** — `skip_notice.html`, whose load-bearing sentence
already ships:

```jinja
{{ n }} regole {{ "SKIPPED"|label|lower }}: {{ "zero_portfolio_value"|label_short }}.
«Non valutato non significa conforme.»
{{ "zero_portfolio_value"|label_gloss }}
```

> 7 regole non valutate: valore di portafoglio nullo. «Non valutato non significa conforme.» Lo scopo di valutazione non detiene ancora nulla, quindi ogni peso sarebbe una divisione per zero. È uno stato iniziale legittimo, non un errore.

---

## 5. The label tables

### 5.1 Capitalisation convention — chosen, and applied throughout

> **An asset-class label is capitalised on its head noun only; qualifiers stay lowercase.**
> "Azioni dei paesi sviluppati", "Obbligazioni governative in euro", "Liquidità", "Capitale non
> assegnato".

Rationale: Italian does not title-case, so English `Title Case` is simply wrong; but these are
*declared taxonomy terms*, and the corpus already capitalises its declared terms in running prose
(`Bucket`, `Holding`, `Strategy` — RFC-0003's Ubiquitous Language, kept verbatim per RFC-0011's header
convention). Capitalising the head marks the term as declared while keeping the phrase Italian. The
consequence is deliberate and must not be "fixed" later: capitals appear mid-sentence, as in
*"…investito nelle **O**bbligazioni governative in euro."*

Chip labels are stored in **natural case** ("Non valutata"); the uppercase mono presentation is
`text-transform: uppercase` in CSS. Storing `NON VALUTATA` would make the same entry unusable in prose.

### 5.2 Core tier — taxonomy keys (`LabelEntry`)

The fixture holds **six** distinct `AssetClass` values, not five (see §9 D-L05-1): five are targeted by
*Long-term growth v3*, and `EQUITY_GLOBAL` is the untargeted sixth on which UX-0001 §8.6's whole
narrative turns. `EQUITY` and `BONDS` are the interior target nodes the depth-1 allocation tree renders
(UX-0001 §8.4).

| key | `noun` | `form` | derived | `short` |
|---|---|---|---|---|
| `EQUITY` | Azioni | `FP_LE` | F PL | Azioni |
| `EQUITY_DEVELOPED` | Azioni dei paesi sviluppati | `FP_LE` | F PL | Sviluppati |
| `EQUITY_GLOBAL` | Azioni globali | `FP_LE` | F PL | Globali |
| `EQUITY_EMERGING` | Azioni dei paesi emergenti | `FP_LE` | F PL | Emergenti |
| `BONDS` | Obbligazioni | `FP_LE` | F PL | Obbligazioni |
| `BOND_GOV_EUR` | Obbligazioni governative in euro | `FP_LE` | F PL | Gov. euro |
| `BOND_CORP_IG` | Obbligazioni societarie investment grade | `FP_LE` | F PL | Societarie IG |
| `CASH` | Liquidità | `FS_LA` | F SG | Liquidità |
| `UNASSIGNED` | Capitale non assegnato | `MS_IL` | M SG | Non assegnato |

`UNASSIGNED.gloss` (RFC-0011 §7's teaching burden, ADR-0025, ADR-0029):

> Capitale che non è stato assegnato ad alcun Bucket. Non è un Bucket: è il residuo, resta nel
> denominatore di ogni peso, e può essere negativo — un residuo negativo è un disavanzo, cioè capitale
> assegnato in eccesso rispetto a quanto è effettivamente detenuto.

### 5.3 Core tier — tolerance kinds (`LabelEntry`), and the fallback frame

Keyed on `ToleranceKind` values (`core/strategy/targets.py:40`). ADR-0018: ABSOLUTE is percentage
points, RELATIVE a proportion of the effective target.

| key | `noun` | `form` | `short` | `gloss` |
|---|---|---|---|---|
| `ABSOLUTE` | tolleranza assoluta | `FS_LA` | assoluta | Punti percentuali: la banda è ±X pp attorno al target, indipendentemente da quanto il target sia grande. |
| `RELATIVE` | tolleranza relativa | `FS_LA` | relativa | Proporzione del target: la banda è una frazione del target, quindi si restringe sui target piccoli e si allarga su quelli grandi. |

Note `noun` is lowercase here: "tolleranza assoluta" is a common noun phrase, not a declared taxonomy
term, so §5.1 does not apply to it.

One frame noun lives in core, because §6.2's fallback requires it:

| key | `noun` | `form` | `short` |
|---|---|---|---|
| `noun.asset_class` | classe | `FS_LA` | Classe |

### 5.4 Web tier — frame nouns (`LabelEntry`), keyed `noun.<english_name>`

The dotted prefix keeps this keyspace disjoint from every enum value (§6.3), including the lowercase
`SkipReason` values.

| key | `noun` | `form` | derived |
|---|---|---|---|
| `noun.position` | posizione | `FS_LA` | F SG → la posizione, della posizione, nella posizione |
| `noun.asset` | asset | `MS_ELIDED` | M SG → l’asset, dell’asset |
| `noun.bucket` | Bucket | `MS_IL` | M SG → il Bucket, del Bucket |
| `noun.portfolio` | portafoglio | `MS_IL` | M SG |
| `noun.net_worth` | patrimonio netto | `MS_IL` | M SG |
| `noun.strategy` | strategia | `FS_LA` | F SG |
| `noun.rule` | regola | `FS_LA` | F SG |
| `noun.finding` | rilievo | `MS_IL` | M SG |
| `noun.evaluation` | valutazione | `FS_LA` | F SG |
| `noun.target` | target | `MS_IL` | M SG → **il** target |
| `noun.threshold` | soglia | `FS_LA` | F SG |
| `noun.band` | banda | `FS_LA` | F SG |
| `noun.drift` | scostamento | `MS_IL` | M SG |
| `noun.allocation` | allocazione | `FS_ELIDED` | F SG → **l’**allocazione |
| `noun.severity` | severità | `FS_LA` | F SG |
| `noun.horizon` | orizzonte | `MS_ELIDED` | M SG → l’orizzonte |
| `noun.principle` | principio | `MS_IL` | M SG |

`noun.target`, `noun.allocation` and `noun.bucket` are the three ADR-L03 §5.1 names explicitly ("*il*
target", "*l’*allocazione"); `noun.bucket` declares a gender for an English loanword that has no
morphological cue, which is a ratification item (§8.3).

### 5.5 Web tier — the four outcomes (`TermEntry`)

All four are past participles agreeing with an elided **`regola`** — feminine singular — which is why
they end in `-a`. ADR-L03 §5.3 requires that SKIPPED and ERROR keep their bite.

| key | `text` | `gloss` |
|---|---|---|
| `FIRED` | Scattata | La condizione è risultata vera: esiste un rilievo. |
| `NOT_FIRED` | Non scattata | La condizione è stata valutata ed è risultata falsa. |
| `SKIPPED` | Non valutata | La regola non è stata valutata. Non valutato non significa conforme. |
| `ERROR` | Errore | La valutazione si è interrotta: il risultato non è né vero né falso. |

"Non valutata" is chosen over the literal "Saltata" precisely because the shipped sentence in
`skip_notice.html` is «Non valutato non significa conforme.» — chip and banner must use the same word,
or the banner stops referring to the chip.

### 5.6 Web tier — `SkipReason` (`TermEntry`)

**Keys are the lowercase enum *values*** (`core/shared/enums.py:73`), unlike every other enum here.

| key | `text` | `gloss` |
|---|---|---|
| `disabled` | Regola disattivata | La regola è disattivata nella versione congelata della strategia, quindi non è stata valutata. |
| `missing_fact` | Dato mancante | Un dato richiesto dalla condizione non era disponibile alla data di valutazione. |
| `stale_fact` | Dato non aggiornato | Il dato esisteva ma era più vecchio della soglia di aggiornamento ammessa dalla regola. |
| `zero_denominator` | Denominatore nullo | Il calcolo avrebbe richiesto una divisione per zero: la banda di tolleranza è nulla. |
| `zero_portfolio_value` | Valore di portafoglio nullo | Lo scopo di valutazione non detiene ancora nulla, quindi ogni peso sarebbe una divisione per zero. È uno stato iniziale legittimo, non un errore. |

The fixture also needs `heterogeneous_strategies`, which **is not yet a member in code** (HANDOFF
§4.3). Its entry is drafted here so that adding the member is a one-line change — and note the payoff
of §6.1: the build fails the moment the member lands without it.

| key (pending) | `text` | `gloss` |
|---|---|---|
| `heterogeneous_strategies` | Strategie non omogenee | I Bucket seguono strategie diverse, quindi lo scostamento a livello di portafoglio non ha un unico albero di target. Farne una media produrrebbe un numero privo di significato. |

### 5.7 Web tier — `SuggestionClass`, the closed E7 enum (`TermEntry`)

Impersonal infinitives, per P8 ("copy avoids hard *you* assumptions"). **None names an instrument, a
direction or a size** — I-12 and E7 are what this table must not violate.

| key | `text` |
|---|---|
| `REVIEW_ALLOCATION` | Rivedere l’allocazione |
| `CONSIDER_REBALANCE` | Valutare un ribilanciamento |
| `REVIEW_BUCKET_ASSIGNMENT` | Rivedere l’assegnazione ai Bucket |
| `REVIEW_STRATEGY` | Rivedere la strategia |
| `REVIEW_LIQUIDITY` | Rivedere la liquidità |
| `NO_ACTION` | Nessuna azione |

### 5.8 Web tier — the remaining closed enums (`TermEntry`)

Included with no exemption, because an exemption list is what rots (§6.3).

`Priority` — participles/adjectives agreeing with `priorità`, F SG:

| `CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO` |
|---|---|---|---|---|
| Critica | Alta | Media | Bassa | Informativa (`short`: Info) |

`Outcome` is §5.5. `ScopeKind`: `PORTFOLIO` → Portafoglio, `BUCKET` → Bucket.
`RunMode` — agreeing with `valutazione`, F SG: `ACTUAL` → Effettiva, `HYPOTHETICAL` → Ipotetica.

`OperationType` (`core/portfolio/operation.py:32`, seven values per E10 / ADR-0028):

| `BUY` | `SELL` | `DIVIDEND` | `COUPON` | `TRANSFER_IN` | `TRANSFER_OUT` | `CORRECTION` |
|---|---|---|---|---|---|---|
| Acquisto | Vendita | Dividendo | Cedola | Trasferimento in entrata | Trasferimento in uscita | Rettifica |

`RiskLevel` (`core/strategy/strategy.py:40`) — adjectives agreeing with `profilo`, M SG. **The members
themselves are invented and awaiting ratification** (HANDOFF §3.6), so these labels are contingent on
that decision:

| `CONSERVATIVE` | `MODERATE` | `BALANCED` | `GROWTH` | `AGGRESSIVE` |
|---|---|---|---|---|
| Conservativo | Moderato | Bilanciato | Orientato alla crescita | Aggressivo |

### 5.9 Naming a position — the instrument surface form (P16)

**P16 decides this**: `over_apportioned` findings *may* name the instrument, because I-12 forbids
*prescription* (instrument / direction / size given as an instruction), not *naming*; ERR-14 is
label-only and `REVIEW_BUCKET_ASSIGNMENT` sits in its allowlist. ADR-L04 makes `over_apportioned` the
first V1.0 kind to need this. So the registry needs an instrument surface form, and here it is.

#### The agreement convention — chosen

> **Instrument and account names are opaque proper nouns with no grammatical gender of their own.
> Agreement is carried entirely by a frame noun; the name is quoted in `«…»` and never takes an
> article, a preposition, or an inflected adjective.**

The frame noun is **`noun.position` — "posizione", `FS_LA`, feminine singular** (§5.4). Three reasons:

1. **It is P16's own word.** The finding is about a *position* being over-apportioned across Buckets,
   not about the security as an abstract instrument.
2. **It covers all nine fixture rows uniformly.** "il titolo" is the natural Italian for a security but
   excludes `Conto corrente` and `Conto deposito 24m`; "posizione" covers ETFs, government bonds, cash
   accounts and deposits with one word and therefore one agreement.
3. **It avoids putting an article on a Ubiquitous Language term.** `Asset` stays English and
   capitalised per RFC-0003; "l’Asset «…»" reads as a category error, where "la posizione «…»" reads as
   Italian.

This makes the absence of per-asset gender a *feature* rather than a gap: no gender is stored for an
asset because the convention makes gender unnecessary, not merely unavailable. Every adjective in the
sentence agrees with `posizione` — feminine singular — for every asset that will ever be imported:

> La posizione «Vanguard FTSE All-World» (IE00B3RBWM25) è **assegnata** ai Bucket per 53,0000 quote
> contro 46,0000 effettivamente **detenute**: 7,0000 quote assegnate in eccesso.

Never *"il Vanguard FTSE All-World è assegnato…"*, which would require guessing the gender of a
foreign brand name — the exact trap this convention closes.

#### Which name: **full name, plus the market identifier when there is one**

Recommended, and the convention:

> **`«{asset.name}»` followed by the market identifier in parentheses where the position has one; the
> parenthetical is omitted where it does not.**

`asset.name` alone is ambiguous in a way that matters here: "Vanguard FTSE All-World" exists as several
share classes and ISINs (accumulating and distributing, different listing currencies), and an
`over_apportioned` finding is exactly the case where the reader must act on **one** position. The ISIN
disambiguates. Conversely, `cash:acct-cc` and `dep:banca-x` are synthetic internal keys, not market
identifiers: "Conto corrente (cash:acct-cc)" shows the reader an implementation detail and buys no
precision, since the name is already unique among the user's own accounts.

> **The discriminator must be a declared field on the asset — an ISIN column that is null for cash and
> deposit positions, or an explicit identifier-kind — never inferred from the shape of the id string.**
> Keying on a `cash:` / `dep:` prefix is the same fragile inference C-L05-3 rejects for numeric
> bindings, and it breaks the first time an id scheme changes.

#### How it reaches a frozen `observation`

Because the frame noun is **invariant across assets**, no role bindings are needed: the template
hard-codes "La posizione", which is an authored sentence skeleton exactly as ADR-L03 §5.1 point 3
intends. Two pre-resolved bindings suffice, and the second uses §4.2's technique because `str.format`
has no conditionals:

```
asset_name                   Vanguard FTSE All-World
asset_identifier_suffix      " (IE00B3RBWM25)"      — or "" for a synthetic id
```

One consequence to accept, not to work around: a stored `observation` is plain text, so the three
voices (UX-0001 §4.5) cannot be applied *inside* it — the ISIN cannot be set in mono there. Do not
attempt to inject markup into stored prose; the identifier is set in mono wherever it appears as a
field of its own, and reads as plain text inside the sentence.

#### The nine fixture positions

`asset.name` is a database column populated by import — **open user data, in `demo/`, not registry
entries.** Listed so the screen builder does not re-derive them (UX-0001 §8.1):

| id | `asset.name` | parenthetical |
|---|---|---|
| `IE00B4L5Y983` | iShares Core MSCI World | (IE00B4L5Y983) |
| `IE00B3RBWM25` | Vanguard FTSE All-World | (IE00B3RBWM25) |
| `LU1681045453` | Amundi MSCI EM | (LU1681045453) |
| `IT0005494239` | BTP 3.85% 2035 | (IT0005494239) |
| `LU0478205379` | Xtrackers EUR Corp | (LU0478205379) |
| `IT0005482309` | BTP short 2028 | (IT0005482309) |
| `cash:acct-trd` | Conto trading | — |
| `cash:acct-cc` | Conto corrente | — |
| `dep:banca-x` | Conto deposito 24m | — |

`IE00B3RBWM25` is the one that matters: it is both the `over_apportioned` position (UX-0001 §8.2,
53 units apportioned against 46 held) and the asset reclassified on 19 Jul (§8.6), so it is the fixture
row where instrument naming is actually exercised.

Fixture `Bucket` names (Pension, Children, Emergency, Personal) and the portfolio name (`Patrimonio`)
are likewise data, in `demo/`. Whether they are Italianised is §8.8.

---

## 6. Completeness, and the mechanical fallback

RFC-0006 §11's registry-completeness test **fails the build** rather than defaulting silently, and
ADR-L02 exists because of it. The right posture here is not one posture but two, and the line between
them is not taste — it is whether the keyspace is closed.

### 6.1 Closed enums → fail the build. No fallback path exists.

`Outcome`, `Priority`, `SkipReason`, `SuggestionClass`, `ToleranceKind`, `ScopeKind`, `RunMode`,
`OperationType`, `RiskLevel` are all `StrEnum`s with finite members. A test can enumerate them, so it
must: `label()` raises `RegistryError` (already in `core/shared/errors.py`) for a missing key in a
closed keyspace, and the completeness test makes that unreachable in a shipped build. This is exactly
RFC-0006 §11's mechanism transposed, and it delivers what ADR-L03 §6 promised: *"every new enum member
needs a label with gender before it can be rendered… it fails loudly rather than silently."*

### 6.2 `AssetClass` is open → degrade, and degrade the *role*, not the grammar

`AssetClass` **is not an enum.** `core/shared/ids.py:38`:

```python
type AssetClass = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$")]
```

RFC-0004 §2.1 calls it an "Enumerated taxonomy node" but the corpus never enumerates it, and
ADR-0033 / E12 confirm the open direction — `AssetClass` becomes one axis among several, with values
in a `classification_axis` table. Values therefore arrive from imported data (`asset.asset_class
VARCHAR`). **There is no finite member set, so a build-time completeness test over `AssetClass` is not
merely undesirable — it is impossible.**

The fallback must therefore exist, and the elegant form is to degrade the *role* rather than the
grammar:

| Requested | Unlabelled key `REAL_ESTATE` renders |
|---|---|
| `BARE` | `Real/Estate` — the existing mechanical form, unchanged, so today's behaviour is preserved exactly |
| `THE` | `la classe «Real/Estate»` |
| `IN` | `nella classe «Real/Estate»` |
| `OF` | `della classe «Real/Estate»` |
| `copula` | `è` |

Agreement is carried by `noun.asset_class` (`classe`, F SG), so **the output is grammatical in every
role for every possible key** — which is why §5.3 puts that one frame noun in the core tier. The
canonical observation degrades to *"La classe «Real/Estate» è al 4.00% contro un target del…"*: plainer
than a labelled class, correct, and visibly unlabelled.

`FactSet.labels` (`rule_engine.py:96`) **stays**, and its resolution order becomes
`labels.get(k) or label(k, …)`. It is not redundant: when E12 lands, taxonomy labels move from a code
constant to a runtime table, and `labels` is already the injection point for that. Minimal diff now,
forward-compatible later.

### 6.3 The three tests

1. **Closed-enum completeness.** Import every enum in §5.5–§5.8, assert every member is a key.
   No exemption list. Fails the build.
2. **Keyspace disjointness.** `DOMAIN_LABELS` and `CHROME_LABELS` share no key, and no `noun.*` key
   collides with any enum value.
3. **Article-series consistency.** For every `LabelEntry`, the five contracted forms and two articles
   derived from `form` match the §3.2 table row, and the §3.4 join rule holds for every row (elided
   forms end in U+2019, others do not). Plus: no ASCII apostrophe anywhere in the data.

Two further guards, cheap and worth having:

4. **Fixture coverage.** Every `AssetClass` and `ToleranceKind` present in `demo/` has an entry. This
   is the fail-the-build guard for the open keyspace *scoped to the shipped fixture*, so the demo can
   never display a mechanical label even though the general case cannot be checked.
5. **Tier discipline.** No `CHROME_LABELS` key appears in any registered `explanation_template` or in
   `assemble_rationale` — the mechanical form of §2.1's criterion.

An unlabelled class encountered at runtime should be **visible, not silent**: screen 7 (run health) is
already scheduled before screens 4–6 precisely because it is "the only thing that makes a broken
configuration visible while you are still configuring" (UX-0001 §9.3), and a "classi senza etichetta"
count belongs there.

---

## 7. The ADR-0023 boundary, and P14

### 7.1 Does the assembled rationale's output change? Yes. Is it legal? Yes.

**It changes.** `…per Equity/Developed con…` becomes `…per le Azioni dei paesi sviluppati con…`, for
recommendations created after the change. Existing rows are untouched, because `rationale` is frozen
into the row at creation (RFC-0008 §5.1, ADR-L03 §5.1 point 4).

**Three reasons it does not violate ADR-0023.**

1. **No new input is read.** `assemble_rationale` (`decision_engine.py:183–222`) reads exactly
   `version.definition.{name, risk.principles, horizon}`, `version.frozen_at`,
   `version.targets.leaves()` and `rule.condition.params["asset_class"]`. The registry is consulted on
   `leaf.asset_class` — a value the function has **already read out of the frozen version**. Input set
   unchanged; a total pure function is applied to an existing input.
2. **The status quo already does this.** Line 201 already calls `asset_class_label`, a code-level
   renderer. If a table-driven renderer of a frozen key violates ADR-0023, so does the mechanical one
   shipping today. **HANDOFF §3.6's framing therefore needs correcting** (recorded additively at §9,
   D-L05-7): ADR-0023's rule bites on reaching for **live or derived state** — `asset.name` from the
   assets table, or a `version_number` obtained by walking `parent_version_id` (the sibling follow-up
   in §3.6, which *is* a genuine violation) — not on rendering a value the frozen version contains.
3. **A later copy revision cannot rewrite history.** Because the string is frozen at creation, a
   registry revision changes only future rows. That is P7-correct and is why ADR-L03 §5.1 point 4
   forbids golden-file assertions on rendered prose.

The honest cost, stated plainly: the *stored* rationale now depends on a code constant as well as on
the frozen version, so two runs of the same version across a registry revision produce two different
`rationale` strings. That is already true of the mechanical label and of every authored sentence
skeleton in `_band_phrase`. It is bounded by the next subsection.

### 7.2 Replay and severity are label-independent — verified, not asserted

Read against `src/financeos/core/engines/`, not inferred:

- **`replay_trace` (`rule_engine.py:789–841`)** reads `trace.bindings[*].{name, value}`,
  `trace.steps[*].{op, inputs, out, value}`, `trace.unavailable_facts` and `trace.stale_facts`. It
  **never reads `trace.message_bindings`**, which is where every label lives. Its own docstring states
  the contract: *"reads only binding names and values, step operands and the recorded skip evidence."*
- **Severity** is `DriftLine.severity`, precomputed by the Strategy Engine from `Decimal`s and merely
  passed through at `rule_engine.py:605–612` (*"the Rule Engine performs no financial computation"*).
  `_persisted_severity` (`decision_engine.py:121–125`) only nulls it for SKIPPED and ERROR. No label
  is reachable from either path.

So severity and replay cannot depend on labels — **provided two constraints hold, and both are
constraints on W1c rather than on this document:**

> **C-L05-1. `input_digest` must exclude `message_bindings`.** The digest is over
> `(condition, bound values, as_of)` (RFC-0006 §10 rule 5, HANDOFF §4.3). Labels are *message*
> bindings, not *fact* bindings. If they entered the digest, a wording revision would change the
> digest of an unchanged evaluation and break determinism and every golden file.
>
> **C-L05-2. `demo/expected/` must not pin `observation` or `rationale` prose, nor
> `message_bindings`.** ADR-L03 §5.1 point 4 already says golden files must compare canonical values
> only. Pinning prose makes the gate fail on every ratified wording change.

Both are live now: W1c is building `demo/expected/` in a parallel lane.

### 7.3 P14 — where the registry ends and the it-IT filters begin

The two pieces are orthogonal and must not be composed inside one another:

| | Registry (this document) | it-IT filters (gap 2, not built here) |
|---|---|---|
| Input | a key | a canonical numeric string |
| Output | a word | a localised numeric string |
| Knows about | gender, number, articles | decimal comma, thousands dot, `€`, `dd/mm/yyyy` |
| Knows nothing about | digits — it exposes no numeric API | words — it has no notion of gender |
| Meet at | exactly one Jinja slot | exactly one Jinja slot |

The trap P14 sets is that a stored `observation` contains dot decimals **inside a sentence**, so
localising it looks like a string transformation over prose. It must not be:

> **Never regex-localise stored prose.** A `.replace(".", ",")` over an `observation` corrupts the
> ISIN in "BTP 3.85% 2035", any URL in a source, and the thousands separator it is trying to create.

The legal mechanism, and it is already what the shipped partials expect
(`trace_ladder.html`: it-IT formatting *"applies to the OBSERVATION, never to the trace"*; RFC-0008
§5.1 explicitly sanctions re-rendering, *"re-rendering a March Recommendation in October reads only the
March trace"*):

> **`observation` is stored canonically and, for display, re-rendered from the frozen
> `MessageTemplate` over the frozen `message_bindings`, with the it-IT filters applied to the
> numeric bindings only.** The word bindings this document adds (`*_label_*`, `*_copula`) were resolved
> at write time and pass through untouched. The re-render happens on the read side
> (`adapters/duckdb/queries/`, reaching `render_observation` from `core`), never in `core` — ADR-L03
> §5.2's *"no formatting function may be called anywhere under `core/`"* is preserved because `core`
> is handed already-formatted binding strings.

That mechanism needs one thing this document does not supply, and it belongs to gap 2's owner:

> **C-L05-3. Which bindings are numeric must be *declared*, per condition kind — not inferred from
> binding names.** A `_pct`/`_value` naming convention looks sufficient and is not: it is silent when
> a future kind names a binding differently, and it would happily "localise" `asset_class`. The
> natural home is a field on `ConditionKindSpec`, along`side` `explanation_template`.

If gap 2's owner declines the re-render, the fallback is to display the stored `observation` verbatim
with dot decimals, marked as an as-recorded artifact — consistent with the trace ladder's rule, and
strictly worse for the reader. Recommended: re-render.

For **`rationale`** there are no captured bindings — it is assembled from f-strings with
`Percentage.canonical()` (`decision_engine.py:200`) — so it cannot be re-rendered from a trace. It
*can* be re-assembled, because `assemble_rationale(version, rule)` is pure and the version is frozen.
The clean seam, recommended to gap 2's owner:

> Give `assemble_rationale` an injected number renderer — a `Callable[[Decimal], str]` parameter
> defaulting to the canonical form. The write path passes the canonical renderer (P14: stored strings
> keep dot decimals); the read path passes the it-IT renderer. `core` gains a *parameter*, not a
> locale, so ADR-L03 §5.2 still holds. This changes a signature under `src/`, so it is a
> recommendation with an owner, not a change made here.

---

## 8. What needs the product owner's ratification

All Italian wording below is **proposed**. Tone and register are the owner's call, not the
implementer's. Grammar is not on this list; it is settled in §3 and §4.

1. **Person and register in the rationale.** `assemble_rationale` writes *"**La tua** strategia…"*
   (second person). P8 says copy avoids hard "you" assumptions. *"La strategia «…»"* is the impersonal
   alternative. Recommend impersonal, for P8 and for the productizable-later posture — but this is the
   single most visible sentence in the product and the owner should choose it.
2. **`target` or `obiettivo`.** The design proofs write "obiettivo" (`design_fixture.py:50,63,74`);
   `assemble_rationale` writes "target". **Recommend `target`** — a fully naturalised masculine
   loanword in Italian finance ("il target", as ADR-L03 §5.1 itself writes it) — and **reserve
   "obiettivo" for `Goal`**, which is a distinct V1.1 aggregate (E9, ADR-0030). Using "obiettivo" for a
   target allocation now would collide with `Goal` the moment V1.1 lands.
3. **Loanword tolerance, and the gender of English UL terms.** §5.2 proposes Italian heads
   (Azioni / Obbligazioni / Liquidità) per ADR-L03 §5.1's own examples, against the design fixture's
   "Bond governativi euro" and "Equity emergenti". Also: `Bucket`, `Asset`, `Holding` and `Snapshot`
   stay English per RFC-0003's Ubiquitous Language, so each needs a *declared* gender for Italian
   prose — proposed masculine (`il Bucket`, `l’asset`).
   Related: `BOND_CORP_IG` as "Obbligazioni societarie investment grade" (proper Italian head, market
   register tail) versus "Obbligazioni corporate IG".
4. **The four outcome chip labels** (§5.5): Scattata / Non scattata / **Non valutata** / Errore.
   ADR-L03 §5.3 makes SKIPPED the one that must keep its bite; "Non valutata" is proposed over
   "Saltata" so chip and banner use the same word.
5. **The six `SuggestionClass` phrasings** (§5.7) — impersonal infinitives, and none may name an
   instrument, a direction or a size (E7, I-12).
6. **The five skip-reason labels and their teaching glosses** (§5.6), plus the drafted
   `heterogeneous_strategies` entry.
7. **The `short` forms** (§5.2) used on chart legends, axis labels and the tolerance rail —
   Sviluppati / Globali / Emergenti / Gov. euro / Societarie IG / Liquidità / Non assegnato.
8. **Whether `demo/` data is Italianised.** Bucket names (Pension, Children, Emergency, Personal) and
   the portfolio name are fixture *data*, not registry entries. Deciding this **before the demo
   fixtures freeze** matters, exactly as P14's own note says. W1c is building them now.
9. **The capitalisation convention** (§5.1): head noun capitalised, qualifiers lowercase, capitals
   appearing mid-sentence by design.
10. **`UNASSIGNED`'s user-facing name** — "Capitale non assegnato", short "Non assegnato" — and its
    teaching gloss, which carries RFC-0011 §7's burden that a negative residual is legal and is a
    deficit.
11. **"non targettizzato"** (`design_fixture.py:372`) is a calque and reads badly. Proposed
    replacement: "non compreso nella strategia", short "senza target".
12. **`RiskLevel` labels** (§5.8) are contingent on ratifying the invented members themselves
    (HANDOFF §3.6).
13. **The instrument frame noun and the identifier convention** (§5.9). P16 settles *whether* a finding
    may name the instrument; what remains is register: **"posizione"** as the frame noun (over "titolo",
    which excludes cash and deposit positions), and **name plus ISIN in parentheses** where a market
    identifier exists. The agreement convention itself — proper nouns stay uninflected, the frame noun
    carries agreement — is grammar, not register, and is not on this list.

---

## 9. Divergences recorded, additively

Per RFC-0000 §10 the seed corpus is not edited; divergence is recorded in new documents. Nothing in
`docs/seed/` was touched. These extend HANDOFF §3, and D-L05-1 through D-L05-4 are observations about
artifacts owned by other lanes rather than requests to change them.

| # | Divergence | Note |
|---|---|---|
| **D-L05-1** | The fixture holds **six** `AssetClass` values, not five. HANDOFF §5.0 and the brief both say five. | Five are targeted; `EQUITY_GLOBAL` is the untargeted sixth that UX-0001 §8.6's reclassification narrative turns on. A label table stopping at five cannot render findings 3 and 7. |
| **D-L05-2** | `target` (core prose) versus `obiettivo` (design fixture) — the same concept, two words, in shipped artifacts. | §8.2. Recommend `target`, reserving `obiettivo` for `Goal`. |
| **D-L05-3** | `design_fixture.py` uses English taxonomy heads ("Bond governativi euro", "Equity emergenti"); §5.2 proposes Italian heads per ADR-L03 §5.1. | Fixture copy is owned by the design lane; it needs updating once §8.3 is ratified. |
| **D-L05-4** | `design_fixture.py:372` "non targettizzato" is a calque. | §8.11. |
| **D-L05-5** | The registered `drift_outside_tolerance` template (`rule_engine.py:644`) is **grammatically wrong today** for four of the six fixture classes — `Azioni` is feminine plural and takes `sono`, not `è`. | Fixed by §4.3(A). This is a live defect, not a future risk: it is wrong for the canonical anchor row. |
| **D-L05-6** | RFC-0004 §2.1 calls `AssetClass` an "Enumerated taxonomy node"; the corpus never enumerates it and the code implements an open constrained string. ADR-0033 / E12 confirm the open direction. | Why §6.2's fallback is mandatory and a build-time completeness test over `AssetClass` is impossible rather than merely unwanted. |
| **D-L05-7** | HANDOFF §3.6's stated reason for the mechanical label — *"ADR-0023 forbids reaching outside the frozen version"* — does not bite on a pure renderer of a frozen key. | §7.1. It bites on live state (`asset.name`) and on derived state (`version_number` via `parent_version_id`) — the latter being the sibling follow-up in that same paragraph, which remains a genuine constraint. |

---

## 10. Implementation checklist

Ordered; each line is verifiable. Nothing here is built by this document.

1. `core/shared/labels.py` — `Gender`, `GrammaticalNumber`, `ArticleForm`, the §3.2 constant,
   `LabelEntry`, `TermEntry`, `Role`, `label`, `copula`, `agree`, `DOMAIN_LABELS` (§5.2, §5.3).
   Keys are `str`; no enum imported. Export from `core/shared/__init__.py`.
   *Verify:* import-linter 5/5 still kept; mypy strict clean.
2. Keep `asset_class_label` as the documented mechanical fallback used by §6.2's `BARE` path. Do not
   delete it — `BARE` on an unlabelled key must render exactly as it does today.
3. `rule_engine.py` — `FactSet.label_for` resolves `labels.get(k) or label(k)`; extend
   `_drift_message_bindings` with the §4.2 role bindings (**append only**); update the registered
   `explanation_template` per §4.3(A).
   *Verify:* the replay property test still passes unchanged — it must, since it never reads
   `message_bindings` (§7.2).
4. `decision_engine.py:201` — `asset_class_label(...)` → `label(..., role=Role.THE)`.
   *Verify:* the canonical fixture rationale reads as §4.3(B).
5. `tests/test_labels.py` — the five checks of §6.3. Test 1 fails the build; no exemption list.
6. `web/labels.py` — `CHROME_LABELS` (§5.4–§5.8), importing the domain entries from
   `core.shared.labels` rather than restating them; `register_label_filters(env)` adding `label`,
   `label_cap`, `label_short`, `label_gloss`.
   *Verify:* registered in `build_environment()` (`web/preview.py:28`), the single environment factory,
   so the `/design` route and the preview dump get the filters together.
7. Screen 7's "classi senza etichetta" count (§6.3).
8. Hand C-L05-1 and C-L05-2 to W1c **now** (§7.2) and C-L05-3 to gap 2's owner (§7.3).
9. **V1.0 opening batch, when `over_apportioned` lands** (ADR-L04): its `explanation_template` follows
   §5.9 — "La posizione «{asset_name}»{asset_identifier_suffix} …" — and its binding assembly
   pre-resolves `asset_identifier_suffix` to the parenthetical or the empty string. The ISIN-versus-
   synthetic discriminator is a declared asset field, not a prefix test. `suggestion_class` stays
   `REVIEW_BUCKET_ASSIGNMENT`, inside ERR-14's allowlist.
