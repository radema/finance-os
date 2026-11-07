import type { ComponentType } from "react";
import { SETUP_TABS } from "../nav.ts";
import { AllocationTab } from "./AllocationTab.tsx";
import { AssumptionsTab } from "./AssumptionsTab.tsx";
import { CashFlowTab } from "./CashFlowTab.tsx";
import { GoalsTab } from "./GoalsTab.tsx";
import { ProductsTab } from "./ProductsTab.tsx";

const SCREENS: Record<string, ComponentType> = {
  "setup/products": ProductsTab,
  "setup/allocation": AllocationTab,
  "setup/goals": GoalsTab,
  "setup/cash-flow": CashFlowTab,
  "setup/assumptions": AssumptionsTab,
};

/** Setup: one tab bar over the Products, Allocation, Goals, Cash flow and Assumptions screens. */
export function SetupScreen({ route }: { route: string }) {
  const Screen = SCREENS[route];
  return (
    <div className="setup-column">
      <div className="tag">Setup</div>
      <h1 className="title">Describe your plan</h1>
      <nav className="tabs" aria-label="Setup">
        {SETUP_TABS.map((tab) => (
          <a
            key={tab.key}
            className="tab"
            href={`#/${tab.key}`}
            aria-current={tab.key === route ? "page" : undefined}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      {Screen ? <Screen /> : null}
    </div>
  );
}
