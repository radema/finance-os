import { useState } from "react";
import type { OverviewView } from "../../engine/overviewView.ts";
import type { Alert } from "../../engine/rules.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { Kpi } from "../goals/Kpi.tsx";
import { formatAmount } from "../money.ts";
import { Resource } from "../setup/ui.tsx";
import { MISSING, percentText } from "../tracking/model.ts";
import {
  AttentionCell,
  CashFlowCell,
  Cell,
  FiProgressCell,
  GoalsCell,
  LevelsCell,
  NetWorthCell,
  PricesCell,
  ProbabilityCell,
  RangeCell,
  TrendCell,
} from "./cells.tsx";
import {
  actionTitle,
  goalsOnTrack,
  hrefOf,
  levelRows,
  OVERVIEW_ROUTES as ROUTES,
  signedAmount,
} from "./model.ts";

const amountOrDash = (value: number | null) => (value === null ? MISSING : formatAmount(value));

function Dashboard({ view }: { view: OverviewView }) {
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
      <div className="kpis kpis-blue kpis-overview" data-cell="key-numbers">
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
        <Cell
          id="p-success"
          title="Probability of success"
          href={hrefOf(ROUTES.pVsRequired)}
          unit={
            <>
              Each goal against the{" "}
              <TermPopover term="required">probability it must reach</TermPopover>.
            </>
          }
        >
          <ProbabilityCell goals={goals} />
        </Cell>
        <Cell
          id="net-worth"
          title="Net worth by goal"
          href={hrefOf(ROUTES.netWorthByGoal)}
          unit="Euros, at the end of each month."
        >
          <NetWorthCell view={view.netWorth} />
        </Cell>
        <Cell
          id="attention"
          title="Needs attention"
          unit="Alerts that are true now and not dismissed."
        >
          <Resource loaded={alerts}>
            {(visible) => <AttentionCell alerts={visible} error={error} onDismiss={dismiss} />}
          </Resource>
        </Cell>
        <Cell
          id="trend"
          title="Probability of success over time"
          href={hrefOf(ROUTES.trend)}
          unit="Monthly snapshots."
        >
          <TrendCell snapshots={view.snapshots} goals={goals} />
        </Cell>
        <Cell
          id="range"
          title="Range of outcomes"
          href={hrefOf(ROUTES.goals)}
          unit={
            <>
              <TermPopover term="badcase">Bad case</TermPopover>,{" "}
              <TermPopover term="typical">typical case</TermPopover> and{" "}
              <TermPopover term="goodcase">good case</TermPopover> of each goal at its date, as a
              percentage of its own target.
            </>
          }
        >
          <RangeCell ranges={view.ranges} />
        </Cell>
        <Cell
          id="cash-flow"
          title="10-year savings capacity"
          href={hrefOf(ROUTES.cashFlow)}
          unit="Euros a year, against what the goals take."
        >
          <CashFlowCell rows={view.cashFlow} />
        </Cell>
        <Cell id="goals" title="Goals" href={hrefOf(ROUTES.goals)} unit="Value against target.">
          <GoalsCell goals={goals} />
        </Cell>
        <Cell
          id="fi-progress"
          title="Share of the FI target, by year"
          href={hrefOf(ROUTES.fiProgress)}
          unit={
            <>
              <TermPopover term="typical">Typical case</TermPopover>, as a percentage of each level
              target.
            </>
          }
        >
          <FiProgressCell fi={fi} />
        </Cell>
        <Cell
          id="prices"
          title="Price freshness"
          href={hrefOf(ROUTES.prices)}
          unit="Age of the latest price of each product."
        >
          <PricesCell prices={view.prices} />
        </Cell>
        <Cell
          id="fi-levels"
          title="Financial independence levels"
          href={hrefOf(ROUTES.fiLevels)}
          unit="Share of each level reached today, and the year it is reached."
        >
          <LevelsCell levels={levelRows(fi)} note={fi.note} />
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
