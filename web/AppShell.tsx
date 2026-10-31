import { DataFolderBanner } from "./DataFolderBanner.tsx";
import { GoalDetailScreen } from "./goals/GoalDetailScreen.tsx";
import { GoalsListScreen } from "./goals/GoalsListScreen.tsx";
import { ImportScreen } from "./import/ImportScreen.tsx";
import {
  CURRENT_PORTFOLIO_ROUTE,
  DEFAULT_ROUTE,
  findPage,
  GOALS_DETAIL_ROUTE,
  GOALS_LIST_ROUTE,
  goalIdOf,
  isBuilt,
  NAV,
  PRICES_ROUTE,
  TRANSACTIONS_ROUTE,
} from "./nav.ts";
import { TransactionsScreen } from "./operations/TransactionsScreen.tsx";
import { FirstRunChecklist } from "./overview/FirstRunChecklist.tsx";
import { PricesScreen } from "./prices/PricesScreen.tsx";
import { SetupScreen } from "./setup/SetupScreen.tsx";

function Sidebar({ route }: { route: string }) {
  return (
    <aside className="side">
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
                <span className="soon">soon</span>
              </a>
            ) : (
              <>
                <div className="nav-head">{section.label}</div>
                {section.items.map((item) => (
                  <a
                    className="nav-item"
                    key={item.key}
                    href={`#/${item.key}`}
                    aria-current={
                      route === item.key || route.startsWith(`${item.key}/`) ? "page" : undefined
                    }
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
  return (
    <div className="shell">
      <Sidebar route={route} />
      <main className="main">
        <DataFolderBanner />
        {route === DEFAULT_ROUTE ? (
          <FirstRunChecklist done={<SoonPage route={route} />} />
        ) : route === TRANSACTIONS_ROUTE ? (
          <TransactionsScreen />
        ) : route === CURRENT_PORTFOLIO_ROUTE ? (
          <ImportScreen />
        ) : route === PRICES_ROUTE ? (
          <PricesScreen />
        ) : route === GOALS_LIST_ROUTE ? (
          <GoalsListScreen />
        ) : route === GOALS_DETAIL_ROUTE || goalIdOf(route) !== undefined ? (
          <GoalDetailScreen goalId={goalIdOf(route)} />
        ) : isBuilt(route) ? (
          <SetupScreen route={route} />
        ) : (
          <SoonPage route={route} />
        )}
      </main>
    </div>
  );
}
