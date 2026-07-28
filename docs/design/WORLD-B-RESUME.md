# World B · Vetro Sommerso — state of the build, and how to continue

| | |
|---|---|
| **Branch** | `worktree-agent-ab80a48e346dcf26c`, rebased onto `build/skeleton` @ `af86d2f` |
| **Commits** | `021ba33` palette search · `39a345c` caps + mark roles · `87acc52` token layer · `c34f32c` cased cane + audit |
| **Gates** | ruff clean · mypy strict clean (90 files) · import-linter 5 kept 0 broken · pytest **245 passed** (no regression) |
| **Stopped because** | the session closed, not because the work wedged. §7 is the honest list of what is missing. |

Everything below is a decision already taken and paid for. **Do not re-derive
it.** The two things genuinely unwritten are `DESIGN.md` and
`.impeccable/design.json` (§6).

---

## 1. What to look at first

```
docs/design/preview.html                  the component reference, BOTH schemes
docs/design/worlds/b-vetro-sommerso.html  the world statement, BOTH schemes
```

Both open straight from the filesystem with the network off. Regenerate with:

```
uv run python -m financeos.web.preview          # -> docs/design/preview.html
uv run python docs/design/worlds/build_proofs.py # -> the world statement
node docs/design/audit_offline.mjs               # the offline audit, exit 1 on failure
```

The preview is the reference: it renders the **real partials through the real
templates**, so if a component looks wrong there it is wrong everywhere. The
world page is a different question — "is this the world we chose, and did the
palette actually get pushed" — and it is generated *from* `palette.json` and
**fails if any solved value is absent from `tokens.css`**, so a proof can no
longer quietly disagree with the product.

---

## 2. Token groups: fully replaced vs. still carrying rejected-world values

**Fully replaced — every value solved, both schemes.** Nothing in `tokens.css`
carries a rejected-world value. The coherence check that proves it:

- 71 distinct custom properties are referenced by `base.css` / `components.css`
- every colour token is declared in all three scheme blocks (`:root` = dark,
  `@media (prefers-color-scheme: light)`, `[data-theme="light"]`, `[data-theme="dark"]`)
- the only names not defined in `tokens.css` are `--at` (set inline by the rail
  partial), `--chart-h` and `--swatch` (both have fallbacks)
- `--seal`, `--bollo`, `--verdigris` appear **nowhere** in the CSS

| Group | State |
|---|---|
| grounds (`--ground`, `--sheet`, `--sheet-sunken`) | replaced · chroma pushed, see §4 |
| inks (`--ink`, `-2`, `-3`) + rules | replaced · solved by bisection onto WCAG targets |
| reserved status (`--alarm`, `--caution` + tints) | replaced · renamed from `--seal` / `--bollo` |
| in-tolerance | **`--verdigris` DELETED.** Now `--band` / `--band-edge`, neutral |
| reference ink (`--annot`) | replaced · now the light source, see §4 |
| glass (`--edge`, `--lift`, `--lift-ink`) | **new** · the one elevation level |
| series 1-5 + `--series-void` | replaced · searched, validator-green both schemes |
| sequential + diverging ramps | replaced · pass the ordinal gates both schemes |
| chart chrome | replaced |
| Class B `--projection` (+ tint, texture) | replaced · still reserved and unused (RFC-0010 §6.4 kill criterion — do not delete) |

**Renames a future editor must know:** `--seal` → `--alarm`,
`--seal-tint` → `--alarm-tint`, `--bollo` → `--caution`,
`--bollo-tint` → `--caution-tint`, `--verdigris` → gone.
`.value--positive` no longer takes a "good" colour; it is `--ink`.

---

## 3. The palette: where it lives, how to regenerate, what it validates

```
docs/design/palette_search.py     the solver — owns every colour in the system
docs/design/palette.json          every token, both schemes, plus the measured report
docs/design/tokens.generated.css  the two token blocks, ready to diff against tokens.css
```

```
uv run python docs/design/palette_search.py            # seconds: uses the recorded solution
uv run python docs/design/palette_search.py --search   # ~2 min: re-derives it by annealing
```

The script re-implements, in Python, exactly the maths of
`dataviz/scripts/validate_palette.js` — sRGB↔linear, OKLab/OKLCH, WCAG contrast,
Machado–Oliveira–Fernandes 2009 CVD at severity 1.0, Euclidean OKLab ΔE×100 —
and gates on: the OKLCH lightness band per mode, a chroma floor **raised to
0.125** (the validator's is 0.10, and sitting on it is what made three candidate
worlds look alike), a chroma **ceiling** of 0.20 (jewel glass, not neon),
adjacent CVD ≥ **10.0** (the target is 8.0; the margin stops a future re-step
sliding into the 6–8 warn band), adjacent normal-vision ΔE ≥ 15, all-pairs
normal-vision ΔE ≥ 12, minimum pairwise hue 34°, contrast ≥ 3.05:1 against the
scheme's own sheet, and a minimum separation from every reserved ink.

**The search result is recorded as data (`SOLVED_SERIES`) and re-verified against
every gate on each run** — so changing a gate, a ground or a reserved ink *fails
the run* instead of silently invalidating the palette. Re-run with `--search`
and paste the answer back if that happens.

Confirmed independently with the real validator, all checks PASS in both modes,
plus the sequential ramps under `--ordinal`:

```
node <dataviz>/scripts/validate_palette.js "#ab2890,#507dff,#1fa31e,#0099cc,#8c4ace" \
  --mode light --surface "#f1f8ff"
node <dataviz>/scripts/validate_palette.js "#dd5bbe,#3056d5,#009105,#1a9ed1,#833fc4" \
  --mode dark  --surface "#06102c"
```

### The protan number, and what covers it

| | Candidate proof | **Now** |
|---|---|---|
| worst adjacent CVD, dark | **7.6 protan** (a WARN, 6–8 band) | **10.6 protan** |
| worst adjacent CVD, light | — | **10.8 deutan** |
| worst adjacent normal-vision ΔE | — | 24.2 dark / 21.9 light |
| mean series chroma | ~0.10 (on the floor) | **0.184** |
| minimum pairwise hue | — | 34° |

**The 7.6 protan warn is gone.** Two numbers still need covering and are covered
unconditionally, never by a promise:

- **tritan 4.8 in light** (8.3 dark). The validator *reports* tritan and does not
  gate it. It is not dismissable here either.
- **all-pairs CVD 2.8.** This one cannot be fixed and must not be chased: any
  five-hue set wide enough to look varied contains a red/green pair, and those
  collapse under protanopia by construction. Optimising for all-pairs was tried
  and it pushes the answer straight back to a blues-and-violets set — the exact
  thing the owner objected to. The applicable gate for bars, stacks and lines is
  the *adjacent* pairlist.

Secondary encoding, all of it mandatory and all of it shipped: a legend is always
present; every class is **also** direct-labelled on the axis (wrapped, never
truncated); every fill carries a 2px surface gap; the void cane carries a hatch
*decal drawn inside the canvas*; the luminous leading edge marks the value
without colour; and the cased cane's **polarity is geometric** (§5).

**Recorded consequence that will bind a future screen:** a scatter, bubble or
choropleth in this product may carry at most **three** series, because those
forms put any two marks side by side and so need all-pairs separation. Fold to
"altro" or facet — never re-hue.

---

## 4. Ground and mark: the decisions, and what was tried and rejected

The brief said the latitude is in the **ground** and the **mark**, not the five
series hues. That held up exactly.

**Ground.** A ground owes contrast to *text* only, never to a series, so it is
the one surface with real chromatic headroom. Chroma is a stated **target**, not
a fraction of the gamut: `#000223` / `#06102c` / `#151f38` in dark at chroma
0.075 / 0.058 / 0.050, hue 265°, against **0.028** in the candidate proof. The
deepest layer carries the most colour because in sommerso the thickest glass
does. **Rejected:** taking 92% of the sRGB gamut at the deepest step, which
returned a pure ultramarine black that reads as a colour field rather than a
ground.

**Dark is the base declaration**, not a preference — `:root` carries the dark
scheme and light is the override, so a reader with no stated preference gets the
world as designed.

**Rejected: no chroma ceiling on the reserved inks.** The first solve returned
`#ff046f`, `#00ecfe`, `#fa00fe` — legible, gated, entirely correct, and a rave.
Capped: a status ink is a stamp, and the reference ink is a cast of light.

**The rule the palette now rests on — the warm half of the wheel belongs to
status, data lives in the cool half.** This came out of a failure, not taste: a
distance-gated run parked a series slot at hue 13.6°, one lightness step off the
crimson alarm ink, and passed every measured check at exactly the threshold.
Measurably distinct, and still the alarm colour carrying a datum. So the status
hue *windows* are excluded outright. A warm mark in this interface is never a
measurement — and the reserved amber/crimson now read as *meaning* warmth.

**The reference ink is the light.** `--annot` is solved at an extreme lightness
(near-white in dark, near-black in light) in the same hue family as `--edge`,
not as a mid-lightness cyan. **Rejected:** mid-lightness cyan — it competed with
the data for hue space and the search could not place five classes while keeping
12 ΔE from it. Solving it by lightness instead separates it from every series by
ΔL ≥ 0.25 and hands the whole cool half back to the data. Links also always
carry an underline, so the reference is never colour-alone anyway.

**In-tolerance is neutral, not green.** The system reports; it does not
congratulate, and being inside your own band is the absence of a finding. The
rail's band is now the **casing** in the ground's own glass, and its index
marker is drawn in `--edge` — the same token as a cane's luminous edge, because
both are "where you read the exact value". One geometry, two states; the
`--breach` modifier is all that changes.

**Elevation:** one named level, `--lift`, an inset luminous hairline along the
top of a record. Nothing casts a shadow, because a submerged layer does not. The
sole exception is the chart tooltip, which genuinely floats.

---

## 5. The ECharts theme and the cased cane — **BUILT**, not outstanding

This is the one place the closing instruction and the repo disagree: both landed
in `c34f32c`. Verify rather than rebuild.

`static/js/charts.js` builds the theme from the CSS custom properties **in scope
on the chart element itself**, so one option renders correctly in both schemes
with no second code path, and role colours still arrive as `"token:--name"`
(never hex — the audit fails the build on a hex in a server option).

**The mark language is inherited, not retyped.** A series names its ROLE and the
helper supplies the geometry:

| role | what it is |
|---|---|
| `casing` | the **target** extent — translucent (alpha 0.30), no border, behind |
| `core` | the **current** quantity — opaque, 55% of the cane's height, 2px surface gap |
| `edge` | the luminous leading edge — 3px, `--edge`, one light source for the world |
| `void` | untargeted capital — no hue, hatch decal, **and no casing** |
| `segment` | a stacked part of a nested whole |

Plus a target tick in `--ink-2` on the same axis (never a second scale).

**It reads with no colour at all** — which is the whole point:
a core short of its casing is a **shortfall** (visible unfilled casing); a core
past the target tick is an **overshoot** (a protrusion). Polarity is geometry;
hue is identity only. CASH is deliberately over target in the fixture so the
overshoot reading is *on the page*.

Also shipped: **six** classes (`EQUITY_GLOBAL` untargeted, currents and targets
each summing to 100.00 — the void cane says "no target was declared" without a
word); the **nested cane** (net worth = its Buckets + the unassigned residual,
in euro because a percentage would hide a rounding gap, built only from numbers
that already reconcile in UX-0001 §8 — no cross-tab was invented; Personal's
zero-width segment is a fact, not a gap); **one point is never a line** (a
single-datum line series is forced to a labelled dot by the helper, so no caller
can forget); and **no series is not a zero** (the empty state renders
server-side as a state block, correct with JavaScript off).

**Sized for L05 today.** The label registry will render `EQUITY_DEVELOPED` as
`le Azioni dei paesi sviluppati`. The axis form drops the article; the y-axis
label **wraps at a fixed width rather than truncating** (a truncated class name
is not an identity, and identity may never rest on hue alone); the legend is a
**grid**, not a flex row, so one 41-character entry cannot leave a ragged hole;
and the layout is sized for `Obbligazioni corporate investment grade`.
`docs/plans/L05` owes the registry **two** forms — a prose form with gender
agreement and a shorter axis form. Two of the six prose labels I used
(`EQUITY_EMERGING`, `BOND_CORP_IG`) are **extrapolated by analogy** from the four
the orchestrator confirmed; the registry owns the canonical list.

The broken `drift_outside_tolerance` template is **not** reproduced anywhere: the
preview and the proof both say `le Azioni dei paesi sviluppati **sono** …`, since
`Azioni` is feminine plural.

---

## 6. What `DESIGN.md` and `.impeccable/design.json` must say — **NOT WRITTEN**

Both still describe the **rejected** world (Il Repertorio, sealing wax, revenue
stamp, verdigris, IBM Plex, cream-refusing paper). They are the largest
outstanding item, and §3.7 records why it matters: an incomplete `DESIGN.md` is
the root cause of the `design-system-color` false-drift reports, because the
detector has nothing complete to adjudicate a literal against.

`DESIGN.md` needs, keeping the existing **[CORPUS] / [DESIGN]** marker
convention (that split is the file's whole value — it tells a future reader which
decisions they may overturn without breaking a domain guarantee):

1. **Frontmatter `colors:`** — the **light** values, verbatim from
   `palette.json` (`palette.light`), since the frontmatter is normative for
   values and the detector reads it. Include `alarm`, `caution`, `annot`, `edge`,
   `band`, `band-edge`, `series-1..5`, `series-void`, `projection`, the grounds
   and the ink ladder. **The dark counterpart of every token lives in
   `tokens.css`, which stays the single source of truth for both** — say so.
2. **Frontmatter `typography:`** — Archivo / IBM Plex Mono / Faustina, with the
   same seven roles (severity, title, designation, declared, body, value, label).
3. **North Star**: *Vetro Sommerso*. Why this world and not a metaphor: sommerso
   is casing one colour inside another, which is *literally* what an apportioned
   allocation is — so the palette question and the chart-form question are one
   decision. Keep the two worlds refused by name (fintech dashboard, editorial
   broadsheet) and **add the third: the archival register is now anti-reference**
   (P12).
4. **The palette section** must state: no hex is hand-picked; the solver and its
   gates; the warm-half/cool-half rule and the failure that produced it; the
   protan/tritan/all-pairs numbers **and** their secondary encoding; the
   three-series cap on all-pairs chart forms; in-tolerance is neutral.
5. **Typography**: the cross-graft taken by half, with the measurement (§7).
6. **Elevation**: one named level, the luminous edge; no shadows except the
   tooltip.
7. **The chart language as a system** (P13): axis, grid, tooltip, legend, the
   five mark roles, the cased cane, the nested cane, empty and single-point
   states, `token:--name` and the no-hex rule, the it-IT formatting rule, the
   table-is-not-a-fallback rule, the HTMX lifecycle.
8. **Do's / Don'ts**: carry every existing entry across, retitling the ink names,
   and add — don't put a hex in a chart option; don't let a warm hue carry a
   datum; don't draw a line through one point; don't render an empty plot frame
   for an absent series; don't truncate a class label.

`.impeccable/design.json` mirrors it: regenerate `extensions.colorMeta` from
`palette.json` (canonical + an 8-step tonal ramp per key — `palette_search.py`
already has `tonal_ramp()`), retitle the roles (alarm/caution/reference/light),
update `typographyMeta` to the three new faces, replace the `shadows` entry with
the single `--lift` level plus the tooltip, and rewrite `narrative` (northStar,
overview, keyCharacteristics, rules, dos, donts) to match §3–§7 here. The
`components[]` array's inline CSS still carries **rejected-world hex fallbacks**
(`#963029`, `#f7f8fa`, `#5a3aa8`, …) — every one must be re-pointed at the new
tokens, or the detector will keep reporting drift that is real.

---

## 7. Remaining, exactly

1. **`DESIGN.md` + `.impeccable/design.json`** — §6. The big one.
2. **The typography call is made but not signed off.** Recorded so it is not
   re-litigated: **the cross-graft is taken by half.** Archivo **yes** — it was
   the strongest single asset of any candidate and one variable file serves
   400–700. **Martian Mono no**: its advance width is roughly 40% wider than
   Plex Mono's, and the mono voice carries the trace ladder, the densest and
   most load-bearing text in the product; a wrapped derivation is a worse
   explanation. Declared voice is Faustina **upright**, not the italic cut the
   candidate proof used, because it carries a whole authored `change_note` and
   fills a textarea the user types into.
3. **The six spare `woff2` stay.** They are unreferenced and deletable the day
   the voices are signed off: `ibm-plex-sans-var`, `ibm-plex-serif-400`,
   `ibm-plex-serif-400-italic`, `faustina-400-italic`, `martian-mono-400`,
   `martian-mono-500` (~130 KB). `fonts/FONTS.txt` lists them as the deletable
   set; `audit_offline.mjs` reports them as a **NOTE** — make it a hard failure
   once the faces settle. If IBM Plex Mono is ever dropped,
   `LICENSE-IBM-Plex.txt` must change with it; `FONTS.txt` already carries the
   OFL copyright and Reserved Font Name for all three shipped families.
4. **No detector waiver was added, and none is currently needed.** `impeccable`
   was not re-run against the new token layer, so this is unverified rather than
   clean. The two existing waivers in `.impeccable/config.json` both stand:
   `side-tab` (the rail's CSS-triangle clamp caret) is still correct and still
   scoped to `components.css`; `single-font` on `preview.html` is still correct
   but **its stated reason names the wrong faces** — it says the three faces are
   IBM Plex Sans/Mono/Serif, and they are now Archivo / IBM Plex Mono / Faustina.
   Fix that sentence when `DESIGN.md` lands.
   The waiver I would expect to need next, if the detector flags it: the cased
   cane's translucent casing (`opacity: 0.30`) and the `--lift` inset hairline
   may read as "low-contrast decoration" or "a shadow", and both are load-bearing
   here — the casing is the declared target and the lift is the world's only
   elevation level. Test before reinstating: if the flagged element is carrying a
   *quantity* or the single named elevation, it is a false positive; a
   decorative translucent panel is a genuine finding.
5. **No browser in the environment.** "Charts init, no console errors" is
   verified by `audit_offline.mjs` running the shipped `charts.js` under a DOM
   shim with the real tokens and rendering every option through ECharts' SSR
   renderer — real, but not a browser. Someone should open both pages once.
6. **Contrast was verified by computation, not by eye**, in both schemes: ink
   13.0:1 / 7.1:1 / 4.6:1 on their own sheet, `--rule-control` 3.06:1 non-text,
   every series ≥ 3.05:1 against its own surface, and both reserved status inks
   clear 4.5:1 as text against **both** the sheet and their own tint — which is
   the check that matters for `SKIPPED` and `ERROR` reading as caution in both
   themes rather than as reassurance.
