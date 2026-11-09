import { useState } from "react";
import { DataFolderBanner } from "./DataFolderBanner.tsx";
import { GlossaryScreen } from "./glossary/GlossaryScreen.tsx";
import { GoalDetailScreen } from "./goals/GoalDetailScreen.tsx";
import { GoalsListScreen } from "./goals/GoalsListScreen.tsx";
import { ImportScreen } from "./import/ImportScreen.tsx";
import { IndependenceScreen } from "./independence/IndependenceScreen.tsx";
import {
  CURRENT_PORTFOLIO_ROUTE,
  DEFAULT_ROUTE,
  findPage,
  GLOSSARY_ROUTE,
  GOALS_HISTORY_ROUTE,
  GOALS_LIST_ROUTE,
  goalIdOf,
  INDEPENDENCE_ROUTE,
  isBuilt,
  NAV,
  navKeyOf,
  OPTIMIZER_ROUTE,
  PENSION_ROUTE,
  PERFORMANCE_ROUTE,
  PLAN_VS_ACTUAL_ROUTE,
  PRICES_ROUTE,
  TRANSACTIONS_ROUTE,
} from "./nav.ts";
import { TransactionsScreen } from "./operations/TransactionsScreen.tsx";
import { OptimizerScreen } from "./optimizer/OptimizerScreen.tsx";
import { FirstRunChecklist } from "./overview/FirstRunChecklist.tsx";
import { OverviewScreen } from "./overview/OverviewScreen.tsx";
import { PensionScreen } from "./pension/PensionScreen.tsx";
import { PricesScreen } from "./prices/PricesScreen.tsx";
import { SetupScreen } from "./setup/SetupScreen.tsx";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarState.ts";
import { GoalHistoryScreen } from "./tracking/GoalHistoryScreen.tsx";
import { PerformanceScreen } from "./tracking/PerformanceScreen.tsx";
import { PlanVsActualScreen } from "./tracking/PlanVsActualScreen.tsx";

function Sidebar({ route, collapsed }: { route: string; collapsed: boolean }) {
  const current = navKeyOf(route);
  return (
    <aside className="side" id="main-sidebar" hidden={collapsed}>
      <a className="brand" href={`#/${DEFAULT_ROUTE}`}>
        GBI planner
      </a>
      <nav className="nav" aria-label="Main">
        {NAV.map((section) => (
          <div className="nav-section" key={section.key}>
            {section.items.length === 0 ? (
              <a
                className="nav-head"
                href={`#/${section.key}`}
                aria-current={route === section.key ? "page" : undefined}
              >
                {section.label}
                {isBuilt(section.key) ? null : <span className="soon">soon</span>}
              </a>
            ) : (
              <>
                <div className="nav-head">{section.label}</div>
                {section.items.map((item) => (
                  <a
                    className="nav-item"
                    key={item.key}
                    href={`#/${item.key}`}
                    aria-current={current === item.key ? "page" : undefined}
                  >
                    {item.label}
                    {isBuilt(item.key) ? null : <span className="soon">soon</span>}
                  </a>
                ))}
              </>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SoonPage({ route }: { route: string }) {
  const page = findPage(route);
  if (!page) {
    return (
      <>
        <div className="tag">Not found</div>
        <h1 className="title">Page not found</h1>
        <p className="unit">
          There is no page at this address. <a href={`#/${DEFAULT_ROUTE}`}>Back to the Overview</a>.
        </p>
      </>
    );
  }
  return (
    <>
      <div className="tag">Soon</div>
      <h1 className="title">{page.label}</h1>
      <p className="unit">
        This page is not built yet. It is in the sidebar to show where it will live.
      </p>
    </>
  );
}

/** Sidebar plus content area. Every page shows the "soon" placeholder until it has a screen. */
export function AppShell({ route }: { route: string }) {
  const goalId = goalIdOf(route);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsed(next);
  }
  return (
    <div className="shell" data-sidebar-collapsed={collapsed}>
      <Sidebar route={route} collapsed={collapsed} />
      <main className="main">
        <div className="sidebar-toolbar">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!collapsed}
            aria-controls="main-sidebar"
            onClick={toggleSidebar}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d={collapsed ? "M7 4l6 6-6 6" : "M13 4l-6 6 6 6"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <DataFolderBanner />
        {route === DEFAULT_ROUTE ? (
          <FirstRunChecklist done={<OverviewScreen />} />
        ) : route === TRANSACTIONS_ROUTE ? (
          <TransactionsScreen />
        ) : route === CURRENT_PORTFOLIO_ROUTE ? (
          <ImportScreen />
        ) : route === PRICES_ROUTE ? (
          <PricesScreen />
        ) : route === GOALS_LIST_ROUTE ? (
          <GoalsListScreen />
        ) : goalId !== undefined ? (
          <GoalDetailScreen goalId={goalId} />
        ) : route === GOALS_HISTORY_ROUTE ? (
          <GoalHistoryScreen />
        ) : route === OPTIMIZER_ROUTE ? (
          <OptimizerScreen />
        ) : route === PERFORMANCE_ROUTE ? (
          <PerformanceScreen />
        ) : route === PLAN_VS_ACTUAL_ROUTE ? (
          <PlanVsActualScreen />
        ) : route === PENSION_ROUTE ? (
          <PensionScreen />
        ) : route === INDEPENDENCE_ROUTE ? (
          <IndependenceScreen />
        ) : route === GLOSSARY_ROUTE ? (
          <GlossaryScreen />
        ) : isBuilt(route) ? (
          <SetupScreen route={route} />
        ) : (
          <SoonPage route={route} />
        )}
      </main>
    </div>
  );
}
