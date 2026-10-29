# 11 — UI direction: redesign of the mock

Type: prototype
Status: resolved
Blocked by: —
Map: ../map.md

## Question

How should the app look and flow? Starting from `reference/mock-app.html`, prototype a few key screens (Dashboard, Goal detail, Transactions/Import, first-run empty state) with palette D and the OE exhibit rules: action titles, highlight + grey, direct labels, no red/green status, max 3 colours (the mock uses 8 goal hues). Address the mock's weak points: dense dashboard, 9-column goals table on phones, no onboarding, jargon before the glossary, stale prices hidden in alerts. Output: `prototypes/` plus a short note of the choices.

Input from ticket 06: pick the app fonts here (user prefers a fresher, modern face; old vendored fonts in tag `finance-os-legacy` are a fallback). Fonts are bundled, no CDN. The new `DESIGN.md` is built from this ticket's assets (impeccable if useful).

## Answer

Prototype: [prototypes/11-ui/](../prototypes/11-ui/) (start at `index.html`; serve the folder locally). Choices, tokens and open questions: [prototypes/11-ui/NOTES.md](../prototypes/11-ui/NOTES.md). Approved by the user on 2026-10-29 after two revision rounds.

UI direction decided with the user:

- **Desktop first, fluid:** works from 390 to 1920 px; content-width grids (1 / 2 / 3 columns), charts resize with their box; text width capped, chart grids not.
- **Dashboard:** one layout (old variant A, chart first) as a grid of cards: key numbers, P(success) per goal, net worth by goal, needs attention, P(success) trend, range vs target, savings capacity vs plan, goals, % of FI target per year, price freshness.
- **Navigation:** sidebar — Overview; Goals (list, detail, history); Independence; Analysis (Optimizer, Performance, Plan vs actual); Pension; Operations (Transactions, Import, Prices); Setup (Products, Allocation, Cash flow, Assumptions, Glossary). Menu button on phone.
- **Colour:** palette D, but not monochrome: a fixed slot colour per goal in every chart; soft tints of slot colours (light 12%, dark 18%) for chips, tags, KPI accents and card header strips; text stays in the text greys. Monte Carlo fans as soft bands in the goal colour.
- **Readability aids:** goal chips, Need/Want/Wish tags, status chips (icon + word), product-class tags, price-freshness pills, KPI cards with an accent bar.
- **Charts:** a compact legend on every multi-series chart (overrides palette D's "direct labels replace the legend"); direct labels kept where they help; OE exhibit anatomy and rules otherwise.
- **Tables:** sticky header on every table while it scrolls past.
- **Type:** Geist + Geist Mono, bundled (no CDN); scale one step up from the OE scale (body 16, tables 15, labels 13, axis 12).
- **Cards:** no outline border (too heavy); accent bar only.
- **Old prices:** flagged and still counted in net worth.
- **Coupons:** recorded by default (ticket 08).
- **Glossary wording:** the user writes it later.

Left for later polish (not blocking): spacing rhythm; the open questions in NOTES.md (highlight shared by Retirement and "the message", per-kind price-age threshold, glossary page, colour of a 7th goal, saved vs recomputed snapshots for the trend). Ticket 08 items not in the prototype (split by weights/units, "Current portfolio" form, skip rows before the opening date) go straight to the spec.

Check: `prototypes/11-ui/index.html` served locally shows the sidebar with the seven sections and the dashboard grid; the spec's UI section lists the rules above; `grep -c "legend" prototypes/11-ui/NOTES.md` > 0.
