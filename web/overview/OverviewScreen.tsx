import { useState } from "react";
import type { OverviewView } from "../../engine/overviewView.ts";
import type { Alert } from "../../engine/rules.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { Kpi } from "../goals/Kpi.tsx";
import { formatAmount } from "../money.ts";
import { Resource } from "../setup/ui.tsx";
import { MISSING, percentText } from "../tracking/model.ts";
import { Cell, FiCell, GoalsCell, OperationalCell, PlanCell } from "./cells.tsx";
import {
  actionTitle,
  goalsOnTrack,
  hrefOf,
  OVERVIEW_ROUTES as ROUTES,
  signedAmount,
} from "./model.ts";

const amountOrDash = (value: number | null) => (value === null ? MISSING : formatAmount(value));

export function Dashboard({ view }: { view: OverviewView }) {
  const alerts = useLoad<Alert[]>("/api/alerts");
  const [error, setError] = useState<string>();
  const dismiss = async ({ ruleId, scope, key }: Alert) => {
    setError(undefined);
    try {
      await api("POST", "/api/alerts/dismiss", { body: { ruleId, scope: scope.kind, key } });
      alerts.reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const { keyNumbers: key, goals, fi } = view;
  const track = goalsOnTrack(goals);

  return (
    <>
      <div className="tag">Overview</div>
      <h1 className="title">Overview</h1>
      <p className="unit">
        Values at the end of {view.asOf.slice(0, 7)}. Every number links to its screen.
      </p>

      <h2 className="exhibit-title">{actionTitle(track, key.netWorth)}</h2>
      <div className="kpis kpis-no-goal kpis-overview" data-cell="key-numbers">
        <Kpi
          label="Net worth"
          value={amountOrDash(key.netWorth)}
          note="An old price is still counted."
          href={hrefOf(ROUTES.netWorth)}
        />
        <Kpi
          label="Market change this month"
          value={signedAmount(key.marketChange)}
          note="Change in value minus the money put in this month."
          href={hrefOf(ROUTES.marketChange)}
        />
        <Kpi
          label={
            <>
              <TermPopover term="twr">TWR</TermPopover> this year
            </>
          }
          value={percentText(key.ytdTwr)}
          note="Time-weighted, since 1 January."
          href={hrefOf(ROUTES.ytdTwr)}
        />
        <Kpi
          label="FI wealth"
          value={amountOrDash(key.fiWealth)}
          note="Goals that count toward FI, after tax."
          href={hrefOf(ROUTES.fiWealth)}
        />
        <Kpi
          label="Goals on track"
          value={`${track.onTrack} of ${track.total}`}
          href={hrefOf(ROUTES.goalsOnTrack)}
        />
      </div>

      <div className="overview-grid">
        <Cell id="goals" title="Goals" href={hrefOf(ROUTES.goals)}>
          <GoalsCell goals={goals} />
        </Cell>
        <Cell id="plan" title="Plan vs actual" href={hrefOf(ROUTES.plan)}>
          <PlanCell plan={view.plan} />
        </Cell>
        <Cell id="operational" title="Operational">
          <OperationalCell
            alerts={alerts.data}
            loading={alerts.loading}
            loadError={alerts.error}
            onRetry={alerts.reload}
            dismissError={error}
            stalePrices={view.stalePrices}
            onDismiss={dismiss}
          />
        </Cell>
        <Cell id="fi" title="Financial independence" href={hrefOf(ROUTES.fiLevels)}>
          <FiCell fi={fi} />
        </Cell>
      </div>
    </>
  );
}

/** The Overview dashboard: an action title, five key numbers and the grid of views. */
export function OverviewScreen() {
  const overview = useLoad<OverviewView>("/api/overview");
  return <Resource loaded={overview}>{(view) => <Dashboard view={view} />}</Resource>;
}
