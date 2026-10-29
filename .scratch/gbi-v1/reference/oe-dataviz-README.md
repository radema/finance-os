# OE Data Viz

A proposed chart layer for OpenEconomics, built on the OE Brand Manual 2025 and on how strategy firms (McKinsey, QuantumBlack, BCG, Bain) design exhibits. It is a draft for review, written to be read by the chart skill as well as by people.

Scope: charts for **reports and documents** and **territorial maps**, 16 chart types in all. Dashboard patterns (KPI tiles, filters) are out of scope for now. Every example uses **illustrative data**, not real figures.

## 1. What the strategy firms do

The "McKinsey look" is a method, not a palette. Across the sources, the same eight habits come back:

1. **Action titles.** The title is the conclusion, as a full sentence with a number. Reading only the titles should tell the whole story (Pyramid Principle, answer first).
2. **One exhibit, one message.** If the title needs "and", it is two exhibits.
3. **Colour is functional.** A neutral base, one strong colour for what matters ("our client", the recommended option), the same mapping across the whole document. No rainbows, gradients or heavy fills.
4. **Direct labels beat legends.** Values on the bars, names at the line ends; gridlines go when labels carry the values.
5. **Honest scales.** Bars start at zero; if that hides the variation, change chart type rather than cut the axis. Keep the same scale across exhibits that are compared.
6. **One call-out, not many.** A short phrase pointing at one place. If a chart needs many notes to be understood, the chart is wrong.
7. **Source on every exhibit.**
8. **A small, fixed chart library**: bars, lines, waterfall, stacked/100%, Mekko, scatter/2×2, heatmap. Templates reused rather than charts styled from scratch.

**QuantumBlack** has two relevant open-source projects, and neither is a slide style.

- **Vizro** (Plotly/Dash) is their charting and dashboard framework. Its rules match the consulting habits above: a qualitative palette for categories, sequential palettes for ordered data, diverging palettes "for data with a meaningful center point", all stated to be colour-blind safe. Waterfalls use blue for increases, dark purple for decreases and grey for totals, so no red/green, the same choice we made. Two practices we adopt: **pin each category to a colour by value**, so "Mezzogiorno" has the same colour in every chart even when filters remove other categories; and keep **data colours the same in light and dark themes**, changing only backgrounds and text. We deliberately break the second rule for the highlight (Bluette on white, Lime on black), because the OE brand forbids Lime on white and Bluette on black; every other data colour keeps its hue across themes.
- **QuantumBlack Design System (QBDS)**, open-sourced in 2026, is a component library for app interfaces (buttons, forms), not charts: it has no chart guidance to copy. What it does show is how to make a design system usable by coding agents: a `CLAUDE.md` that says when to read which file, a token **usage guide** separate from the token **source of truth**, and agent skills for syncing tokens from Figma and checking that components match the spec. We follow the same structure here (`tokens.json` as the source, these READMEs as the usage guide), and section 8 applies it to the chart skill.

**Firm differences worth knowing**: BCG keeps to three colours per chart and favours shorter titles and 2×2 frameworks; Bain rations one red highlight per slide with a "so-what" box; McKinsey titles are longer and more complete, with Georgia (serif) titles and Arial body. Our pairing of Hedvig (serif titles) and Atkinson (sans body) is close to McKinsey's serif-plus-sans logic.

**Samples.** I have not reproduced the firms' exhibits: they are copyrighted, and remote images can't load here. The patterns are described in each component's guidelines and rebuilt with OE tokens. To see originals: McKinsey's "The Week in Charts" and McKinsey Global Institute reports, BCG and Bain publications, and the Vizro visual vocabulary demo.

**Sources consulted**: Vizro documentation, *Themes and colors* (palettes, template colours, category colour mapping); `mckinsey/quantumblack-design-system` on GitHub (README and CLAUDE.md); Umbrex, *The Busy Consultant's Guide to Quantitative Charts* (ch. 3, McKinsey design principles, Zelazny's legacy); QuantumBlack on Medium, *Visualizing data science insights* (Vizro, 2024); Cannes Lions entry for McKinsey's Data Visualization Design System (2019); Financial Times, *Visual Vocabulary* (via GIJN and data.europa.eu); Slideworks and Deckary guides to McKinsey/BCG/Bain formatting; SlideSpeak style notes on Bain and other firms. These are secondary sources: the firms don't publish their internal chart manuals.

## 2. Where it conflicts with the OE brand, and the fix

| Topic | Consulting practice | OE Brand Manual | Conflict? | Proposed fix |
|---|---|---|---|---|
| Neutral greys | Most series in grey | No greys defined | **Yes, a gap** | Add `ink-muted`, `axis`, `rule`, `viz-context` (3.3:1), `viz-context-2/3` |
| Highlight on white | One strong colour | Bluette on white ✓; Lime on white ✗ | Partly | `viz-highlight` = Bluette on white, Lime on black |
| Secondary palette | Muted, accessible | Neon Magenta, Yellow, Green, Cyan, Blu | **Yes** | On white 4 of 5 fail 3:1 (Yellow 1.2, Cyan 1.2, Green 1.3, Magenta 2.7). Keep originals for black; darker variants for white (`cat-*`) |
| Blu vs Bluette | Distinct series colours | Both in the palette | Yes | Blu dropped from categorical: too close to Bluette |
| Max colours | 3 per chart (BCG) | "2–3 at a time" | No | Same rule: max 3 categorical |
| Maps / heatmaps | Sequential and diverging scales | None defined | **Yes, a gap** | `seq-1…6` (Bluette ramp), `div-a3…div-b3` (ochre ↔ Bluette) |
| Up/down colours | Often red/green | No red or green | Mild | `viz-down` = magenta, `viz-up` = Bluette. Also colour-blind safe |
| Titles | Serif (Georgia) at McKinsey | Hedvig for titles | No | Hedvig for action titles |
| Body/labels | Arial | Atkinson Light | No | Atkinson; Light for subtitles and notes, Regular for data labels (Light is too thin at 11–12px) |
| TAG | Rare | Mono uppercase TAG | No | Keep the TAG as the exhibit's topic line |
| Backgrounds | White | Bluette or black for brand; white for operative | No | Reports on white. A Bluette-ground theme is possible later |
| Radius | Square | Square blocks | No | `radius-0` for bars |

Bottom line: no hard conflict with identity (fonts, Bluette, Lime stay). The conflicts are **gaps** (greys, map scales) and **accessibility** (neon secondary palette on white). Both need a sign-off from whoever owns the Brand Manual.

## 3. Rules

**Exhibit**: TAG → action title → unit line → chart → callout → source (see *ExhibitAnatomy*). Left-aligned, never centred.

**Colour**, in order of preference:
1. Highlight + context: one `viz-highlight`, all else `viz-context`. Default.
2. `seq-*` for magnitudes, `div-*` for deviation from a reference.
3. `cat-1…cat-3` only when several series matter equally.

Never Lime on white. Never Bluette on black. Text on coloured fills: black or white by contrast (`OEViz.inkOn`).

**Labels**: direct labels; no legend when it can be avoided; round sensibly (one decimal at most for rates); label start, end and the key point, not every point.

**Scales**: bars from zero; same range for compared exhibits; index base stated in the unit line.

**Accessibility**: text ≥ 4.5:1, data marks ≥ 3:1 unless every mark is directly labelled; colour pairs differ in lightness, not hue alone.

## 4. Choosing the chart

Based on the FT Visual Vocabulary's nine families (the same base Vizro uses), mapped to our archetypes:

| The question | Family | Use |
|---|---|---|
| Who is ahead, where do we rank? | Ranking / magnitude | HighlightBar |
| How did it change over years? | Change over time | LineFocus |
| Before vs after, two points only? | Change over time | Slopegraph |
| How big is the gap between two values? | Magnitude / deviation | Dumbbell |
| Above or below the average? | Deviation | DivergingBar |
| How do we get from A to B? | Part-to-whole (flow) | Waterfall |
| What is the mix? | Part-to-whole | StackedShare |
| Where is the volume and what is its mix? | Part-to-whole | Mekko |
| Which units to prioritise? | Correlation | QuadrantScatter |
| Pattern across two dimensions? | Distribution / magnitude | HeatmapTable |
| Where in Italy? | Spatial | RegionTileMap (regions) or a choropleth (municipalities) |
| Where does the money / output go? | Flow | Sankey |
| The same trend for many units? | Change over time | SmallMultiples |
| Annual totals, with a forecast? | Change over time | ColumnTrend |
| Where are we heading, how sure are we? | Change over time | ForecastFan |
| Where does one unit sit among all the others? | Distribution | Distribution |

Avoid: pies with more than 3 slices, 3D, dual y axes, radar charts, donuts for comparisons.

## 5. Maps

Most OE work is territorial, so maps get their own rules.

- **Regions**: tile map by default (every region the same size). A geographic choropleth over-weights large, sparse regions.
- **Provinces and municipalities**: real choropleth. Hairline outlines (≤ 0.5px), provincial borders on top in `ink-muted`, label only the subject areas.
- 5–6 classes, breaks on round numbers or quantiles (say which). Never a continuous gradient for printed reports.
- No data is always `viz-nodata` with an outline and "n.d.", never a scale colour.
- Legend vertical, ranges written in full, unit in the legend title.

## 6. Interactivity

Static first, interactive second. Most OE output ends up in PDF or print, and an exhibit must make its point with no hover at all: the action title, highlight and direct labels already carry the message. Interaction is an **additive layer** for web output, never the only way to get a number.

| Worth it | Not worth it |
|---|---|
| Tooltips with exact values on dense charts: maps, histograms, scatter | Tooltips that repeat a label already on the chart |
| Hover to isolate one node's flows in a Sankey | Animated transitions between states |
| Toggling IT/EN or the highlighted unit on a web page | Zoom and pan on report charts |
| Keyboard focus on every interactive mark (done in the prototypes) | Interaction that hides data until clicked |

The prototypes Sankey, RegionTileMap, QuadrantScatter and Distribution have the layer switched on (`interactive: true`). For the skill this points to **Vega-Lite** if web output matters, since it covers static and interactive output from one spec. matplotlib is fine if it doesn't.

## 7. Italian and English

Every exhibit sets `lang`. Formatting follows the locale through `Intl.NumberFormat`:

| | Italian (`it-IT`) | English (`en-GB`) |
|---|---|---|
| Decimals / thousands | 1.234,5 | 1,234.5 |
| Percent | 12,5% | 12.5% |
| Change | +6,8 p.p. | +6.8 pp |
| Source line | Fonte: Istat; elaborazioni OpenEconomics | Source: Istat; OpenEconomics analysis |
| No data | n.d. | n/a |
| Negative | −3,2 (true minus sign) | −3.2 |

Titles are written in the language of the document, never machine-mixed. Region names stay in Italian in both languages.

## 8. Notes for the chart skill

- `components/bundle.js` (`window.OEViz`) is a **reference implementation** in plain SVG: layout logic, label collision, class-to-token mapping. Port it rather than copy it.
- **matplotlib**: map tokens to an `rcParams` style (fonts, colours, spines off, no top/right axes) plus helper functions per archetype (`highlight_bar`, `line_focus`, `waterfall`…). Best for static PNG/SVG/PDF in reports.
- **Vega-Lite / Altair**: tokens become a theme config; archetypes become spec templates. Good if you also want web output later.
- **Plotly**: excluded at your request. Note that open-source Plotly has no watermark; the logo in its toolbar turns off with `displaylogo: False`. Vizro, QuantumBlack's own tool, is built on it.
- **Fonts**: Hedvig Letters Serif and Atkinson Hyperlegible Next/Mono are on Google Fonts. Install them in the render environment (Databricks cluster, Docker image) or matplotlib will silently fall back to DejaVu.
- Every number formatter takes the language; every chart takes `source`.
- Pin category colours by value in one shared map (e.g. macro-areas, sectors), not by order of appearance.
- Like QBDS: one `CLAUDE.md` rule ("for any chart, read the chart skill first"), `tokens.json` as the only source of colour values, and lint checks that fail when a chart uses a hex code that is not a token.

## 9. Open decisions

1. Approve the added greys and the darker secondary variants (Brand Manual owner).
2. Approve the map scales: Bluette sequential; ochre ↔ Bluette diverging.
3. matplotlib or Vega-Lite as the skill's renderer.
4. Whether to add a Bluette-background theme for brand-mode slides.
5. A municipal choropleth prototype on real ISTAT boundaries (needs the geometry in the render environment).
6. Whether the highlight should stay theme-dependent (Bluette / Lime) or follow Vizro and keep one colour in both themes.
