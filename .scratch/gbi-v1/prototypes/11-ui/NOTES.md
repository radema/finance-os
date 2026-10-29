# Ticket 11 — UI prototype notes

Throwaway static prototype. Open `index.html` (no build, no network). Five screens, a goals list, and one placeholder page for every navigation item that is not built.
Sample data comes from the mock's own engine (`reference/mock-app.html`, `sampleState` + `analyse`, valuation date 2026-10-31), dumped into `data.js` and, for savings capacity and the chance-of-success trend, into `content.js`.
Screenshots (27 files in `screens/`): 1440 and 1920 px light for every screen (import at step 3), dashboard also dark, dashboard at 1024, 1280 and 390 px (390 also dark), goal detail and import at 390 px, and the open phone menu.

## What is here

| File | Content |
|---|---|
| `tokens.css`, `fonts.css`, `fonts/` | Palette D as CSS custom properties (slots 1-6 as `--slot1..6`), light + dark (`prefers-color-scheme`, `?theme=`, toggle), OE type scale and spacing; Geist and Geist Mono with their OFL licences |
| `app.css`, `app.js` | Fluid layout (container queries), exhibit anatomy, sidebar and phone menu, goal colours (`GOAL_SLOT`), one shared ECharts theme built from the tokens, a `ResizeObserver` per chart, glossary popover |
| `dashboard.html` | Overview: headline, key numbers, then a grid of 9 cells (6 charts, attention list, goals, price freshness) |
| `goals.html`, `placeholder.html` | Goals list (same rows as the Overview); one page for every unbuilt nav item, `placeholder.html?s=<key>` |
| `goal.html` | Goal detail, `?g=g1..g6` |
| `transactions.html` | Transactions list, and Import in 4 steps (`#import`) |
| `start.html` | First run: empty Overview as a checklist, then forms for products, goals, positions |
| `independence.html` | Three levels (one segment per counted goal), % of target per year, projection fan, "what counts" |
| `data.js`, `content.js` | Sample data, savings capacity and probability snapshots (second dump of the mock engine), glossary, price dates, fabricated import rows |
| `vendor/` | ECharts 6.1.0 + LICENSE (copied from `src/financeos/web/static/vendor/echarts/`) |

## Update 2: feedback round (desktop width, colour, navigation)

Decisions from the user, all applied:
1. **Dashboard A kept, B and the switcher removed.** The page is a grid that follows the width of the content area (container queries, not the viewport): 1 column below 720 px, 2 from 720, 3 from 1080. At 1440 px the sidebar leaves 3 columns; at 1920 px each column is about 500 px. Cells: key numbers, chance of success per goal, net worth by goal (stacked), needs attention, chance-of-success trend, range of outcomes, savings capacity vs plan, goals, % of FI target per year, price freshness. On phones the order is key numbers, chart, attention, goals, then the other charts.
2. **Fluid at 390, 1024, 1280, 1440, 1920.** No fixed-width wrapper: text is capped (titles, units, callouts), charts and grids fill the width. The goals list switches from cards to a row by its own width. The rail on the goal and independence pages appears when the content is 900 px wide; at 1500 px the independence page puts two exhibits side by side. Every chart has a `ResizeObserver`: on a width change it calls `resize()` and rebuilds the options, because label sizes depend on the width. Checked: no horizontal overflow and every chart as wide as its box, on all pages at the five widths, and after resizing a loaded page 1920 > 1440 > 1024 > 390 > 1280 > 1920.
3. **Goal colours.** One fixed colour per goal, by palette slot, the same in every chart and next to the name in lists and chips: Retirement slot 1 (highlight `#b75a26`), Support for parents slot 2 (orange), Children bucket slot 3 (green), MIP OpenEconomics slot 4 (ochre), Long-term investment slot 5 (teal), Emergency fund slot 6 (olive). Stacks (net worth, contributions, FI levels) follow slot order 1 to 6. Lines colour only slots 1, 2, 5 and draw the other goals grey (chance-of-success trend). Monte Carlo fans are the series colour at 22% (30% in dark) with a thin line at 60%; the median is solid. Text stays in greys; every coloured line has a direct label; the six-goal stacks have no direct labels (six labels in a band 13-21k thick would overlap); their legend is above the chart (Update 3).
4. **Navigation.** Desktop sidebar (from 960 px, scrolls if the window is short): Overview; Goals (List, Detail, History); Independence; Analysis (Optimizer, Performance, Plan vs actual); Pension; Operations (Transactions, Import, Prices); Setup (Products, Allocation, Cash flow, Assumptions, Glossary). Unbuilt items carry a "soon" tag and open `placeholder.html?s=<key>`. On phones the tab bar is gone: a Menu button in the top bar opens the same list full screen. Goals > List is built (the Overview's goal rows on their own page); History is a placeholder.
5. **Old prices: flagged only, still counted in net worth.** The flag stays in the chip, the key number, the callout, the price list and each holding. The attention text now says "They are still counted."
6. **Font A (Geist, Geist Mono).** Option B, its two font files and licences, the `?font` switch and the stored choice are removed.
7. **Glossary wording unchanged.** The Setup > Glossary item is a placeholder.
8. Ticket 07 FI rules are untouched (net of tax, pension in by default, Level 1 without pension, targets follow `expenseGrowth`). Only colours changed there.

Where colour and the old rules collide (your call, see questions):
- **Highlight has two jobs.** It is now Retirement's goal colour, and it still marks "the message": status triangles, old-price dots, the flag rule, the FI charts (Level 2, the fan). In the sample data Retirement is also the one at risk, so they agree; with other data they would not. FI charts keep highlight + grey because they do not encode a goal.
- **Slots 3, 4, 6 outside stacks.** The chance-of-success bars and the range chart give each goal its colour on single bars; the palette says slots 3, 4, 6 only in stacks. Each bar has a name beside it, so colour is not the only channel. The single-goal fan uses the goal's colour whichever slot it is, because one coloured series next to grey passes the colour-vision checks.
- **Dark mode.** Teal (slot 5) and the context grey are weak on `#14181c` (palette file); stack segments have a surface-coloured edge and every series is named.

Data added for the new charts (from the mock engine, not invented): savings capacity per year and the planned contribution per goal (`cashflow(st, 10)`), and the chance of success per goal at each quarter end (the mock's retro snapshots, re-run with 1,000 paths; the last point is the live value, so Retirement moves from 85.2% to 84.3% from sampling, not from the data).

## Update 3: chips, cards, tags, legends, bigger type, sticky headers

User feedback: "much better, but still monochrome"; later "Finally, great work", with two refinements. All applied.

**Soft tints (tokens.css).** Each is a palette colour mixed into the page surface: light 12%, dark 18% (a few stronger). Separate light and dark hex values. Text on a tint stays `--ink`; colour lives in dots, bars, fills, tinted backgrounds and 1 px borders (`color-mix` of the same colour at 35-42%).

| Token | Light | Dark | From |
|---|---|---|---|
| `--tint1` .. `--tint6` | `#f0e7e1` `#f7efea` `#e3eae6` `#f1ede3` `#dee8e9` `#eaece3` | `#31241e` `#3c302a` `#1e2825` `#332e21` `#172528` `#282b20` | palette slots 1-6 (the goal colours) |
| `--tint1-strong` | `#e8d4c8` | `#4b2e1f` | slot 1 at 24% / 34%: Off track |
| `--blue` | `#116496` | `#5496b7` | vik cool arm: card accent, priority, icons |
| `--tint-blue-faint`, `--tint-blue`, `--tint-blue-strong` | `#eaf1f5` `#dce8ef` `#c1d6e3` | `#1a252c` `#202f38` `#28404e` | blue at 6 / 12 / 24% (dark 10 / 18 / 32%) |
| `--tint-sand` | `#efe0d7` | `#3d3836` | vik `#e1b8a0`: BTP tag |
| `--tint-pink` | `#fadedf` | `#43373a` | batlow `#fdb4b4`: Pension tag |

**Components** (`app.css`, helpers in `app.js`): goal chip (`gchip`: goal-colour dot, name, tint and border; also on the goal chips, filters, lists), priority tag (`prTag`: Need filled dot, Want half, Wish ring, on a strong / medium / faint blue, so shape carries it too), status chip (icon + word: On track grey tint, At risk slot-1 tint, Off track stronger tint with border), product tag (`kindTag`: ETF blue, BTP sand, Pension pink; the kind comes from the product name in this prototype), price-freshness pill (grey fresh, slot-1 tint for old), KPI cards (3 px accent bar, tinted icon; accent is the goal colour on a goal page, blue elsewhere), section cards (raised surface, accent bar, tinted header strip with icon and mono label). Applied on the Overview, goal detail, independence, transactions, import and first-run.
- Blue now means "general / information" (KPI, priority, headers). The highlight family means attention, goals have slots 1-6. One more hue than before; say so if you want it out.

**Legends.** Every multi-series chart has a compact legend above the chart, top left, using the goal swatches (stacks, capacity, trend) or line / band / tick / dashed samples (fans, FI, range, hero tick). Direct labels stay where they help. This overrides the palette file's "direct labels replace the legend" rule. The hero and range charts show only their marks, not the goals, because the goal names are already the row labels.

**Type scale, one step up.** Body 15 to 16 px, sub / table text 14 to 15, labels 12 to 13, axis and small labels 11 to 12 (also in ECharts: axis 12, labels 13), callout 13 to 14, page title 26 to 28, KPI value 24 to 28. Sidebar 216 to 232 px (248 from 1280 px). Checked at 1280 px: no overflow on any page; goals list, transactions and the cards fit; chart label margins were widened.

**Sticky table headers (rule).** Every table header row (`.lt .head`, `.goals-head`; the prototype has no `<table>`, the same rule applies to `thead th`) is `position: sticky` with `top: var(--topbar)` (53 px under the phone top bar, 0 with the sidebar), the surface colour as background (raised inside a card) and a hairline bottom border. It sticks in the page scroll, not in an inner scroller, and leaves when its table ends. Cards use `overflow: clip`, not `hidden`, so they do not become a scroll container. Checked: the goals list head sticks at 0, leaves at the end of the list, and sticks at 53 px at 800 px width.

**Ticket 08 (import) input.**
- Applied: coupon rows are recorded by default as a coupon (cash received, no unit change); "Leave it out" is the other choice; the "leave it out" default and its open question are gone. Coupons now count as Ready.
- Not applied (listed for the build): "one bucket / split by weights / split by units" with parts summing to the broker quantity; the "Current portfolio" form (units + fiscal PMC per product, pension included, as-of date); skipping import rows on or before the opening date ("already in the opening position"); Fineco XLSX as the only preset. The first-run "opening positions" form still asks for a value in euros.

## Choices per weak point

### 1. Dense dashboard
- One message first. The page opens with an action title built from the data: "Five of six goals are on track. Retirement is the one to watch." One chart under it (chance of success per goal, highlight bar for the exception, tick for the required probability), one callout, one source line.
- Order: message, three key numbers (hairline list, not a card grid), then the grid (see Update 2). The first draft's right rail is gone.
- Net worth by goal is a stacked area again (six goal colours, dashed grey line for money put in); the first draft had two lines.

### 2. Nine-column goals table on phones
- Goals are rows that become cards at 390 px: name and priority, status, chance of success against required, value against target, plan gap. The mock's other columns are gone from the list: the trend sparkline is dropped, "target at date" lives in the goal detail, and the long goals-page columns (deterministic, median, P10–P90, needed) are replaced by the goal detail's range chart and "What it would take".
- Same markup on desktop as a five-column row (by the goals list's own width).
- Transactions use the same idea: a table at desktop, two-line cards at phone.

### 3. No onboarding
- `start.html`: the empty Overview is a checklist of three tasks (products, goals, opening positions), each with one sentence of plain explanation and a count. A dashed placeholder shows where the answer will appear. "Opening positions" is optional and locked until a product and a goal exist.
- Forms are short. ISIN lookup fills name, type and ticker when the code is known (the 10 mock products with an ISIN + 1). Goal presets (Emergency fund, Retirement, Children) fill the form; priority shows its default required probability.
- A link to the broker import is offered as the faster path.

### 4. Jargon before the glossary
- Every jargon term is a dotted-underline button. Tap, focus or hover opens a popover: plain sentence first, the Italian term in small italics above it. Works on touch (no `title=`).
- Raw "P10–P90" is never shown. Labels are "bad case", "typical case", "good case"; the popover says "10th percentile, P10".
- Terms covered: probability of success, required probability, simulated markets, bad/typical/good case, future vs today's euros, time-weighted and money-weighted return, drawdown, average cost (PMC), tax-loss carry-forward (zainetto), FIRE and Barista FIRE, opening position, Need/Want/Wish, ISIN, coupon, old price, minimum efficient ticket.
- The Italian wording of Need/Want/Wish and of a few others is my guess, not the project's. See question 4.

### 5. Stale prices hidden in alerts
- The mock has no per-price date, so I added one in `content.js`: Yahoo ETFs are 1 day old; BTPs and the three pension funds are typed by hand and dated 30 Sep (31 days), one BTP 27 Oct. This is an invented tweak to make the case visible. 5 of 13 held products are "old" (more than 7 days).
- Freshness shows in four places: a chip beside the date on every Dashboard; the Net worth key number ("€61,756 of it (34%) uses prices up to 31 days old"); a callout under the net worth chart; a Price freshness list with date and age per product; and an "Old price · 30 Sep (31 days old)" line on every holding in the goal detail.
- Old = highlight dot plus the word "Old price". Fresh = grey ring. The value is still counted.

### 6. Status without red/amber/green
- A status is an icon plus a word: On track (grey check in a circle), At risk (outline triangle), Off track (filled triangle). Shape differs, so colour is not the only channel.
- Highlight (`#b75a26`) marks only the exception: the triangle, a 3 px rule on the row, the bar, the old-price dot. All other goals stay grey. The highlight is never used for text, buttons or links, so it keeps its meaning. Buttons and focus rings use ink.
- Import row check uses the same rule (Ready, Already in your records, Needs a goal, Product not found, Coupon).

### 7. Eight goal hues
- First draft: zero goal colours. Replaced by Update 2 (one palette slot per goal).
- Charts follow the exhibit anatomy: tag, action title with a number, unit line, chart, callout, source. Direct labels instead of legends, bars from zero, hairline gridlines only, no red/green.

## Update: fonts (bundled locally)
Geist (text and display, weight 500 for titles) and Geist Mono (tag line), chosen by the user. Files are in `fonts/`, loaded by `fonts.css`: no Google Fonts link, no CDN. SIL OFL 1.1, Latin subset, variable weight, from `@fontsource-variable/*` 5.3.0 (licence file next to each font). The OE pair (Hedvig Letters Serif, Atkinson Hyperlegible Next) is not used; the OE type scale is unchanged. The page waits for the fonts before it draws charts, so ECharts measures labels with the real glyphs. The Latin subset has no arrows (← →): the "Back" links use a system font.

## Update: FI levels (ticket 07)
- FI wealth is net of tax everywhere (today's value and the projection). Targets are in today's euros and follow `target(t) = target(0) × ((1 + expenseGrowth) / (1 + inflation))^t`; the sample has both at 2%, so the lines are flat.
- Pension counts by default and is shown as its own share: on the Independence screen each level bar is split by goal, so the pension is the Retirement segment; the Dashboard key number says "of it pension". Level 1 is measured without pension, as the ticket says.
- New chart "% of target per year" (median projected FI wealth ÷ target(t)) on the Dashboard and on the Independence screen. Highlight = Level 2, grey = Level 3.
- Update 2: each level bar is now split by goal colour (Retirement is the pension share) instead of solid/light.
- Deviation: Level 1 is not drawn in that chart. It is above 200% from year 0 (213% today, 1,360% in 2066) and would leave the scale. The callout says so. The ticket says "one line per level"; your call.
- Sample numbers come from a second run of the mock's engine with `includePension = true`, plus the earlier run without pension (used for Level 1). Pension share in the projection would be the gap between the two medians; the prototype only shows today's pension share.
- Known gaps: ticking goals in "What counts" updates today's numbers (bars, title, levels list) but not the projections; the probability line for Level 1 is not shown; the Dashboard shows no per-level "year reached" table, only the chart and its title.

## Palette notes
- Palette D hex values are used as given. Four tokens are mine because the palette file has no value for them: `--raised` (`#ffffff` light, `#1a1f24` dark) for inputs and popovers, `--wash` (`#eef1f4`, `#1b2025`) for hover, shadows, and (the switcher bar is gone).
- Dark mode: context grey `#494e52` on `#14181c` is 2.1:1 (the palette file flags this). Every grey bar and line has a direct label.
- No contrast check was run on the finished screens; I relied on the palette file's numbers.

## Left out on purpose
- The other mock screens: optimizer, performance, goal history, plan vs actual, pension, prices (full), setup, glossary page. They are placeholders in the navigation.
- Italian UI strings, real storage, the real engine, undo of imports, the "Fetch online prices" and "Enter prices by hand" actions (buttons only).
- A tooltip and hover design beyond ECharts defaults; keyboard-only and screen-reader pass.

## Open questions for you
1. **Highlight and Retirement.** Should `#b75a26` belong to one goal (now Retirement), or stay free for "the message" (status, old prices, FI) with goals using slots 2 to 6? The second keeps the palette rule "the message is always the highlight", but leaves only five goal colours.
2. **When is a price old?** Still 7 days for everything. Pension funds publish monthly, so they are almost always flagged. Per-product-kind thresholds? (Flagged and counted is settled.) Is icon-plus-word status enough?
3. **Italian terms:** wording stays as it is and you will fix it; popover only, or also a Setup > Glossary page? (Placeholder for now.)
4. **Goal colours beyond six.** The palette has six slots and the mock allowed more goals. What happens with goal 7: grey, or a cap at six?
5. **Chance-of-success trend** needs saved snapshots (Goals > History, not built). The sample uses the mock's recomputed quarter ends. Does the real app save them, or recompute?
