import type { ReactNode } from "react";
import type { GoalListRow } from "../../engine/goalViews.ts";
import type { OverviewView } from "../../engine/overviewView.ts";
import type { Alert } from "../../engine/rules.ts";
import { EmptyState } from "../EmptyState.tsx";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { GoalChip } from "../goals/GoalChip.tsx";
import { pVsRequired } from "../goals/outlook.ts";
import { SeverityChip } from "../goals/SeverityChip.tsx";
import { StatusChip } from "../goals/StatusChip.tsx";
import { FanChart } from "../independence/FiCharts.tsx";
import { formatAmount, formatEuro, formatPercent, formatSignedAmount } from "../money.ts";
import { goalDetailHref } from "../nav.ts";
import { PriceFreshnessPill } from "../prices/PriceFreshnessPill.tsx";
import { Alert as ErrorNote } from "../setup/ui.tsx";
import { gapText, nextTicketText, percentText } from "../tracking/model.ts";
import { alertRoute, hrefOf, levelRows, OVERVIEW_ROUTES } from "./model.ts";

export function Cell({
  id,
  title,
  href,
  children,
}: {
  id: string;
  title: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="card cell" data-cell={id}>
      <h2 className="card-head">{href ? <a href={href}>{title}</a> : title}</h2>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function GoalsCell({ goals }: { goals: readonly GoalListRow[] }) {
  if (!goals.length) return <p className="note">There are no goals.</p>;
  const rank = { off_track: 0, at_risk: 1, on_track: 2 } as const;
  const ordered = [...goals].sort(
    (a, b) => (a.outlook ? rank[a.outlook.status] : 3) - (b.outlook ? rank[b.outlook.status] : 3),
  );
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Goal</th>
            <th>Status</th>
            <th>Probability vs required</th>
            <th className="num">Value</th>
            <th className="num">Of target</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((goal) => (
            <tr key={goal.id}>
              <td>
                <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
              </td>
              <td>{goal.outlook ? <StatusChip status={goal.outlook.status} /> : "No analysis"}</td>
              <td>
                {goal.outlook ? (
                  <a href={goalDetailHref(goal.id)}>
                    {pVsRequired(goal.outlook.pSuccess, goal.outlook.requiredP)}
                  </a>
                ) : (
                  "–"
                )}
              </td>
              <td className="num">{formatAmount(goal.value)}</td>
              <td className="num">
                {goal.target > 0 ? formatPercent(goal.value / goal.target) : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlanCell({ plan }: { plan: OverviewView["plan"] }) {
  const { latest, next } = plan;
  return (
    <>
      <p className="unit">Since {plan.trackingStart}.</p>
      {latest ? (
        <p>
          {formatSignedAmount(latest.gap / 100)} {gapText(latest.gap)}:{" "}
          {formatEuro(latest.cumActual)} put in against {formatEuro(latest.cumPlanned)} planned.
        </p>
      ) : (
        <p className="note">No tracking months yet.</p>
      )}
      {next ? (
        <>
          <p>
            Next contribution: <GoalChip id={next.goalId} name={next.goalName} slot={next.slot} />{" "}
            {formatEuro(next.amount)}
          </p>
          <p className="note">{nextTicketText(next)}</p>
        </>
      ) : (
        <p className="note">No next contribution advised.</p>
      )}
    </>
  );
}

export function AttentionCell({
  alerts,
  error,
  onDismiss,
}: {
  alerts: readonly Alert[];
  error: string | undefined;
  onDismiss: (alert: Alert) => void;
}) {
  return (
    <>
      <ErrorNote message={error} />
      <ul className="alerts">
        {alerts.map((alert) => (
          <li key={`${alert.ruleId}|${alert.scope.kind}|${alert.key}`}>
            <div className="alert-rule">
              <a href={hrefOf(alertRoute(alert))}>{alert.name}</a>
              <SeverityChip severity={alert.severity} />
            </div>
            <p className="sub">{alert.condition}</p>
            <button className="btn" type="button" onClick={() => onDismiss(alert)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function OperationalCell({
  alerts,
  loading,
  loadError,
  onRetry,
  dismissError,
  stalePrices,
  onDismiss,
}: {
  alerts: readonly Alert[] | undefined;
  loading: boolean;
  loadError: string | undefined;
  onRetry: () => void;
  dismissError: string | undefined;
  stalePrices: OverviewView["stalePrices"];
  onDismiss: (alert: Alert) => void;
}) {
  return (
    <>
      {loadError ? (
        <div className="alert state-box" role="alert">
          <p>{loadError}</p>
          <button className="btn" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {loading && !alerts ? <p className="note">Loading alerts…</p> : null}
      {alerts ? (
        <AttentionCell alerts={alerts} error={dismissError} onDismiss={onDismiss} />
      ) : (
        <ErrorNote message={dismissError} />
      )}
      {stalePrices.length ? (
        <>
          <p>
            <a href={hrefOf(OVERVIEW_ROUTES.prices)}>Prices needing an update</a>
          </p>
          <ul className="prices">
            {stalePrices.map((price) => (
              <li key={price.productId}>
                <a href={hrefOf(OVERVIEW_ROUTES.prices)}>{price.name}</a>
                <PriceFreshnessPill age={price.age} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!loading &&
      !loadError &&
      !dismissError &&
      alerts &&
      !alerts.length &&
      !stalePrices.length ? (
        <p className="note">
          Nothing needs attention. <a href={hrefOf(OVERVIEW_ROUTES.prices)}>View prices</a>.
        </p>
      ) : null}
    </>
  );
}

export function FiCell({ fi }: { fi: OverviewView["fi"] }) {
  const levels = levelRows(fi);
  if (!fi.result || !levels.length)
    return <EmptyState message={fi.note ?? "There is no projection yet."} />;
  const configured = levels.filter((level) => level.set);
  if (!configured.length)
    return (
      <EmptyState
        message="Set your expenses to see the levels and when you reach them."
        action={{ label: "Set your expenses", href: hrefOf(OVERVIEW_ROUTES.fiLevels) }}
      />
    );
  const reached = configured
    .filter((level) => level.progress !== null && level.progress >= 1)
    .at(-1);
  const next = configured.find((level) => level.progress !== null && level.progress < 1);
  return (
    <>
      <p>Highest level reached today: {reached ? reached.name : "None yet"}.</p>
      {next ? (
        <p>
          Next: {next.name}, {percentText(next.progress)} reached today. Typical year:{" "}
          {next.median ?? "Not within 40 years"}.
        </p>
      ) : (
        <p>All configured levels reached.</p>
      )}
      <p className="unit">
        Euros today, net of liquidation tax, to {fi.result.points.at(-1)?.year}.
      </p>
      <ul className="legend">
        <li>
          <span className="swatch swatch-fi-band" />
          <TermPopover term="badcase">Bad case</TermPopover> to{" "}
          <TermPopover term="goodcase">good case</TermPopover>
        </li>
        <li>
          <span className="swatch swatch-solid" />
          <TermPopover term="typical">Typical case</TermPopover>
        </li>
        <li>
          <span className="swatch swatch-level" />
          Level target
        </li>
      </ul>
      <FanChart result={fi.result} label="FI wealth by year, with the level targets" />
    </>
  );
}
