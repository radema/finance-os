# Bauhaus UI visual acceptance checklist

Status: review scope approved by the user. No visual acceptance has been performed or claimed.
Scope: all existing screens, selected A contract and approved semantic motif studies.

## Evidence and environment

Use synthetic sample data in an isolated `GBI_DATA_DIR`, never personal data. Use a separate
empty data directory for first-run checks. Review the production implementation, with
no `variant` query parameter, no switcher, and no development-only activation requirement.

Use agent-browser for browser inspection and screenshot capture, then obtain the user's
visual review. Do not use Playwright. The CLI is absent in the current environment, and
cached Chromium cannot start because `libnspr4.so` is missing. During implementation,
provision agent-browser and a compatible Chromium runtime as environment tools, not app
dependencies. If that environment cannot support it, perform the required pass in a
supported environment, such as the user's Mac. Record the unperformed checks as pending;
PNG proposal exports, static HTML and unit checks do not replace browser evidence.

Store screenshots and a short findings/index file under this effort's `assets/visual-review/`.
Name screenshots by screen, width, theme and meaningful state. Record implementation commit,
viewport, fixture, browser/tool versions, result and any unresolved defect. Export only
synthetic data. Preserve existing chart render-after-font-load behaviour before capture.

## Viewport/theme matrix

- All screens: agent-browser inspection and one full-page screenshot at 1440 × 1000,
  in light and dark. Inspect content below the fold, sticky headers and popovers.
- All screens: check at 1024 × 768 and 1920 × 1080, in both themes, for page overflow,
  clipping, text/artwork collisions and usable controls. Capture evidence for failures.
- Additional boundary screenshots in both themes: Overview; Goal detail; Independence;
  Optimizer; Transactions; Prices; Setup Allocation; Setup Cash flow; Setup Assumptions.
  These exercise asymmetric layout, long labels, dense tables, form grids and chart labels.
- Check the expanded sidebar in the 768 px-high viewport, then collapse/restore and reload.
  Verify all navigation items remain reachable, active state is clear and content reflows.
- No mobile acceptance added; the established supported range remains desktop 1024–1920 px.

## Screen inventory

| Screen / route | Principal visual and interaction risks |
| --- | --- |
| Overview `#/overview` | Brand and Net worth artwork unchanged; five linked metrics; action title; four blocks; readable 3:2 split/fallback; FI plot unboxed; attention visible |
| Goals list `#/goals/list` | Long goal names, goal/priority/status marks, values and probability text; responsive table columns |
| Goal detail `#/goals/detail/<fixture-id>` | Goal colour identity, long values, switching/back link, KPI wrapping, range/fan labels, holdings and plan form |
| Goal history `#/goals/history` | Metric switch, direct line labels, snapshot table and save/delete confirmation |
| Independence `#/independence` | Level tiles, long labels, expenses, include-pension checkbox, full-width fan and level targets |
| Optimizer `#/analysis/optimizer` | Criterion labels, product universe, result comparisons, one/many mixes, action confirmation and scatter labels |
| Performance `#/analysis/performance` | Scope selector, KPI columns, charts/end labels, negative and missing values, scope table |
| Plan vs actual `#/analysis/plan-vs-actual` | Contribution note/split, next contribution details, aligned chart widths and signed gaps |
| Pension `#/pension` | Form alignment, annual cap/excess states, KPI wrapping, schedule table/chart, capital note |
| Transactions `#/operations/transactions` | Add/edit/filter forms, dates, money signs, cost warning, destructive confirmation |
| Import `#/operations/import` | All import tabs, row check/mapping, file picker, past imports, current portfolio and split control |
| Prices `#/operations/prices` | Old/current freshness tags, review list, month grid, positions, editable cells and wide tables |
| Products `#/setup/products` | Product type tags, checkboxes, create/edit form, long names and labels |
| Allocation `#/setup/allocation` | Dense weight controls, readonly pension weights, goal identities and totals |
| Goal definitions `#/setup/goals` | Need/Want/Wish tags, goal/plan forms and long labels |
| Cash flow `#/setup/cash-flow` | Numeric form grid, ten-year table, sticky header and Year column |
| Assumptions `#/setup/assumptions` | Long labels, correlations, mixed field types, collapsed cards and reset confirmation |
| Glossary `#/setup/glossary` | English/Italian text, long definitions, method headings and shared tabs |

Use representative fixture goals, including pension and a long name. Do not create arbitrary
motif variants for routes: placement follows the section's meaning in DESIGN.md.

## Shared component checks

- Motifs: exactly the two retained main artworks plus approved semantic two-shape studies.
  No random/sibling-order selection. Inspect target, allocation, comparison, coverage and
  entries in relevant sections. A copy motif appears only if an explicit copy context exists;
  absence is correct otherwise. One motif per relevant section, clear of text/focus/controls.
- Hierarchy: serif page titles/exhibit titles/KPI values; readable Geist card headers;
  bundled fonts only. Large titles/values wrap without colliding with art or clipping.
- Cards/tabs: square geometry, neutral outlines and rules, consistent padding, tinted
  collapsible headers, active tabs clearly marked, no charts inside boxed cards.
- Chips/tags: goal identity dots; priority fill/half-fill/ring; status icon plus word;
  severity; product type; old/current freshness. Check multiple adjacent labels, table
  rows, long names and glossary popover triggers. Text contrast and focus remain clear.
- Checkbox states: unchecked, checked, indeterminate, disabled unchecked and disabled checked.
  Verify label click, Tab/Shift+Tab, Space toggle, visible focus and no state change when
  disabled. Use a temporary isolated component specimen for unsupported business states;
  do not add new app states just to demonstrate a checkbox.
- Forms: labels/hints/errors align; required/invalid fields remain understandable;
  readonly/disabled inputs and buttons are distinguishable; browser controls remain usable.
- Tables: header sticks while scrolling; cash-flow Year remains sticky; horizontal table
  scroll stays inside its wrapper, with no unintended page-wide overflow.
- Keyboard: logical order through sidebar, tabs, forms and actions; focus visible; collapsible
  sections work; all text-labelled controls and glossary popovers operate with keyboard.
- Forced colours: checkbox uses native rendering and remains legible; decoration hidden;
  focus, selected tabs, status text and disabled states remain understandable.

## State coverage

Use the full sample for normal/dense screens, an empty database for first-run and empty
lists, and an isolated fixture variant for long labels/large and negative amounts. Inspect
loading and failed requests on representative API-backed form, table and chart screens;
no new production delay/error options. Confirm retry and preserved inputs still work.
Inspect all supported collapsed-card states, open glossary popovers and destructive/action
confirmations. Synthetic fixture mutations must remain in scratch data.

## Chart and regression checks

Preserve Palette D, goal slots, highlights/context, legend samples, direct end labels,
label room, axes, zero-baseline bars, fan fills, source lines, resize and bundled fonts.
No motif may become a data marker or status signal. Verify Overview links and screen
content are unchanged; UI work must not alter money calculations or REST behaviour.
Run `pnpm gate` against the final integrated change, including audit and build. Record
results; this checklist does not relax existing AC-77/performance or AC-93 visual gates.

## Completion and human review

The agent reports coverage, screenshot index, gate result and outstanding defects. The
user reviews all-screen evidence and explicitly approves or requests fixes. Fixes get
focused rechecks and updated affected screenshots; rerun the gate after code changes.
Do not report implementation ready for merge with required checks blocked or unperformed.
The user merges. No screenshot or full gate result is claimed by approving this checklist.
