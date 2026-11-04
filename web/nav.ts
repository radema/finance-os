export interface NavItem {
  /** Route key, used in the URL hash: `#/goals/list`. */
  key: string;
  label: string;
}

/** A sidebar section. A section without items is a page itself. */
export interface NavSection extends NavItem {
  items: readonly NavItem[];
}

const section = (key: string, label: string, items: [string, string][] = []): NavSection => ({
  key,
  label,
  items: items.map(([slug, itemLabel]) => ({ key: `${key}/${slug}`, label: itemLabel })),
});

export const NAV: readonly NavSection[] = [
  section("overview", "Overview"),
  section("goals", "Goals", [
    ["list", "List"],
    ["detail", "Detail"],
    ["history", "History"],
  ]),
  section("independence", "Independence"),
  section("analysis", "Analysis", [
    ["optimizer", "Optimizer"],
    ["performance", "Performance"],
    ["plan-vs-actual", "Plan vs actual"],
  ]),
  section("pension", "Pension"),
  section("operations", "Operations", [
    ["transactions", "Transactions"],
    ["import", "Import"],
    ["prices", "Prices"],
  ]),
  section("setup", "Setup", [
    ["products", "Products"],
    ["allocation", "Allocation"],
    ["cash-flow", "Cash flow"],
    ["assumptions", "Assumptions"],
    ["glossary", "Glossary"],
  ]),
];

export const DEFAULT_ROUTE = "overview";

/**
 * The Setup tabs. Goals is a tab only: the sidebar's Goals section is for the Goals screens, so the
 * Setup items of the sidebar keep the spec's list.
 */
export const SETUP_TABS: readonly NavItem[] = [
  { key: "setup/products", label: "Products" },
  { key: "setup/allocation", label: "Allocation" },
  { key: "setup/goals", label: "Goals" },
  { key: "setup/cash-flow", label: "Cash flow" },
  { key: "setup/assumptions", label: "Assumptions" },
];

/** Built screens outside Setup. The detail route takes a goal id: `goals/detail/<id>`. */
export const TRANSACTIONS_ROUTE = "operations/transactions";
export const CURRENT_PORTFOLIO_ROUTE = "operations/import";
export const PRICES_ROUTE = "operations/prices";
export const GOALS_LIST_ROUTE = "goals/list";
export const GOALS_DETAIL_ROUTE = "goals/detail";
export const GOALS_HISTORY_ROUTE = "goals/history";
export const PERFORMANCE_ROUTE = "analysis/performance";
export const PLAN_VS_ACTUAL_ROUTE = "analysis/plan-vs-actual";
export const PENSION_ROUTE = "pension";
export const INDEPENDENCE_ROUTE = "independence";

/** The goal id of a detail route, or undefined when the route is not a detail route or has no id. */
export function goalIdOf(route: string): string | undefined {
  const prefix = `${GOALS_DETAIL_ROUTE}/`;
  return route.startsWith(prefix) && route.length > prefix.length
    ? decodeURIComponent(route.slice(prefix.length))
    : undefined;
}

/** The hash link to a goal's detail page. */
export const goalDetailHref = (goalId: string): string =>
  `#/${GOALS_DETAIL_ROUTE}/${encodeURIComponent(goalId)}`;

/** Route keys that have a screen. The sidebar shows "soon" on the others. */
export const isBuilt = (key: string): boolean =>
  key === TRANSACTIONS_ROUTE ||
  key === CURRENT_PORTFOLIO_ROUTE ||
  key === PRICES_ROUTE ||
  key === GOALS_LIST_ROUTE ||
  key === GOALS_DETAIL_ROUTE ||
  key === GOALS_HISTORY_ROUTE ||
  key === PERFORMANCE_ROUTE ||
  key === PLAN_VS_ACTUAL_ROUTE ||
  key === PENSION_ROUTE ||
  key === INDEPENDENCE_ROUTE ||
  SETUP_TABS.some((tab) => tab.key === key);

/** The page behind a route key: an item, or a section that has no items. */
export function findPage(key: string): NavItem | undefined {
  for (const s of NAV) {
    if (s.items.length === 0 && s.key === key) return s;
    const item = s.items.find((i) => i.key === key);
    if (item) return item;
  }
  return undefined;
}
