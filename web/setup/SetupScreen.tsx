import type { ComponentType } from "react";
import { AllocationTab } from "./AllocationTab.tsx";
import { AssumptionsTab } from "./AssumptionsTab.tsx";
import { CashFlowTab } from "./CashFlowTab.tsx";
import { GoalsTab } from "./GoalsTab.tsx";
import { ProductsTab } from "./ProductsTab.tsx";
import { SetupTabs } from "./SetupTabs.tsx";

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
      <SetupTabs route={route} />
      {Screen ? <Screen /> : null}
    </div>
  );
}
