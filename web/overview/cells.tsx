import { type CSSProperties, type ReactNode, useMemo } from "react";
import type { GoalListRow } from "../../engine/goalViews.ts";
import type { OverviewView } from "../../engine/overviewView.ts";
import type { Alert } from "../../engine/rules.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { GoalChip } from "../goals/GoalChip.tsx";
import { pVsRequired } from "../goals/outlook.ts";
import { RangeChart } from "../goals/RangeChart.tsx";
import { StatusChip } from "../goals/StatusChip.tsx";
import { ProgressChart } from "../independence/FiCharts.tsx";
import { formatAmount, formatPercent } from "../money.ts";
import { goalDetailHref } from "../nav.ts";
import { PriceFreshnessPill } from "../prices/PriceFreshnessPill.tsx";
import { Alert as ErrorNote } from "../setup/ui.tsx";
import { Legend } from "../tracking/Exhibit.tsx";
import {
  historyOf,
  historySeries,
  knownGoals,
  markColour,
  percentText,
} from "../tracking/model.ts";
import { TimeChart } from "../tracking/TimeChart.tsx";
import { alertRoute, hrefOf, type LevelRow } from "./model.ts";

const euroAxis = (value: number) => formatAmount(value).replace(/,00/, "");
const CENTS = 100;
const NOT_REACHED = "Not within 40 years";

/** A grid cell: a title that links to the screen that explains it, an optional unit line and the content. */
export function Cell({
  id,
  title,
  href,
  unit,
  children,
}: {
  id: string;
  title: ReactNode;
  /** Omit when no one screen explains the cell: its rows link on their own. */
  href?: string;
  unit?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card cell" data-cell={id}>
      <header className="card-head">{href ? <a href={href}>{title}</a> : title}</header>
      <div className="card-body">
        {unit ? <p className="unit">{unit}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** P(success) of each goal as a bar with a tick at the probability it must reach. */
export function ProbabilityCell({ goals }: { goals: readonly GoalListRow[] }) {
  return (
    <ul className="pbars">
      {goals.map((goal) => {
        const outlook = goal.outlook;
        const style = { "--slot": `var(--slot${goal.slot})` } as CSSProperties;
        return (
          <li key={goal.id} style={style}>
            <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
            {outlook ? (
              <>
                <span className="pbar" aria-hidden="true">
                  <span className="pbar-fill" style={{ width: `${outlook.pSuccess * 100}%` }} />
                  <span className="pbar-req" style={{ left: `${outlook.requiredP * 100}%` }} />
                </span>
                <a className="pbar-text" href={goalDetailHref(goal.id)}>
                  {pVsRequired(outlook.pSuccess, outlook.requiredP)}
                </a>
              </>
            ) : (
              <span className="sub-line">No analysis: a price or the pension plan is missing.</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Value of each goal stacked over time, and the money put in. */
export function NetWorthCell({ view }: { view: OverviewView["netWorth"] }) {
  const series = useMemo(
    () => [
      ...view.goals.map((goal) => ({
        name: goal.name,
        data: goal.values,
        colour: markColour(goal.slot),
        kind: "area" as const,
        stack: "value",
      })),
      { name: "Money put in", data: view.moneyIn, colour: "--ctx", endLabel: true },
    ],
    [view],
  );
  if (view.months.length === 0) return <p className="note">There are no transactions yet.</p>;
  return (
    <>
      <Legend
        items={[
          ...view.goals.map((goal) => ({
            label: goal.name,
            kind: "area" as const,
            colour: markColour(goal.slot),
          })),
          { label: "Money put in", kind: "line", colour: "--ctx" },
        ]}
      />
      <TimeChart
        months={view.months}
        series={series}
        format={euroAxis}
        label="Value of each goal over time, stacked, with the money put in"
      />
    </>
  );
}

/** The visible alerts, each with its rule, a link to the screen of the rule and a dismiss action. */
export function AttentionCell({
  alerts,
  error,
  onDismiss,
}: {
  alerts: readonly Alert[];
  error: string | undefined;
  onDismiss: (alert: Alert) => void;
}) {
  if (alerts.length === 0 && !error) return <p className="note">Nothing needs attention.</p>;
  return (
    <>
      <ErrorNote message={error} />
      <ul className="alerts">
        {alerts.map((alert) => (
          <li key={`${alert.ruleId}|${alert.scope.kind}|${alert.key}`}>
            <div className="alert-rule">
              <a href={hrefOf(alertRoute(alert))}>
                {alert.ruleId} {alert.name}
              </a>
              <span className="sub-line"> {alert.severity}</span>
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

/** P(success) of each goal over the snapshots; a hollow marker is a recomputed one. */
export function TrendCell({
  snapshots,
  goals,
}: {
  snapshots: OverviewView["snapshots"];
  goals: readonly GoalListRow[];
}) {
  const history = useMemo(() => historyOf(snapshots, "prob"), [snapshots]);
  const known = useMemo(() => knownGoals(history, goals), [history, goals]);
  const series = useMemo(() => historySeries(history, known), [history, known]);
  if (history.months.length === 0) return <p className="note">There are no snapshots yet.</p>;
  return (
    <>
      <Legend
        items={[
          ...known.map((goal) => ({ label: goal.name, kind: "dot" as const, colour: goal.colour })),
          { label: "Saved", kind: "dot", colour: "--ink2" },
          { label: "Recomputed", kind: "ring", colour: "--ink2" },
        ]}
      />
      <TimeChart
        months={history.months}
        series={series}
        format={formatPercent}
        label="Probability of success of each goal over the monthly snapshots"
      />
    </>
  );
}

/** The range of outcomes of one goal at its date, against its target. */
export function RangeCell({ range }: { range: NonNullable<OverviewView["range"]> }) {
  return (
    <>
      <p className="sub">
        <GoalChip id={range.goalId} name={range.name} slot={range.slot} /> has the smallest margin
        over its <TermPopover term="required">required probability</TermPopover>.
      </p>
      <RangeChart
        range={range.range}
        slot={range.slot}
        label={`Range of outcomes of ${range.name} against its target`}
      />
    </>
  );
}

/** What the household can save each year against what the goals take. Money in cents. */
export function CashFlowCell({ rows }: { rows: OverviewView["cashFlow"] }) {
  const years = useMemo(() => rows.map((row) => row.label), [rows]);
  const series = useMemo(
    () => [
      {
        name: "Savings capacity",
        data: rows.map((row) => row.capacity / CENTS),
        colour: "--blue",
        kind: "bar" as const,
      },
      {
        name: "Planned for goals",
        data: rows.map((row) => row.planned / CENTS),
        colour: "--hl",
        endLabel: true,
      },
    ],
    [rows],
  );
  return (
    <>
      <Legend
        items={[
          { label: "Savings capacity", kind: "bar", colour: "--blue" },
          { label: "Planned for goals", kind: "line", colour: "--hl" },
        ]}
      />
      <TimeChart
        months={years}
        series={series}
        format={euroAxis}
        label="Savings capacity against the plan, year by year"
      />
    </>
  );
}

/** The goals with their status and value against target. */
export function GoalsCell({ goals }: { goals: readonly GoalListRow[] }) {
  if (goals.length === 0) return <p className="note">There are no goals.</p>;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Goal</th>
            <th>Status</th>
            <th className="num">Value</th>
            <th className="num">Of target</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((goal) => (
            <tr key={goal.id}>
              <td>
                <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
              </td>
              <td>{goal.outlook ? <StatusChip status={goal.outlook.status} /> : "–"}</td>
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

/** Median wealth as a share of each level's target, year by year. */
export function FiProgressCell({ fi }: { fi: OverviewView["fi"] }) {
  if (!fi.result) return <p className="note">{fi.note ?? "There is no projection yet."}</p>;
  return (
    <ProgressChart
      result={fi.result}
      label="Median wealth as a percentage of each FI level target"
    />
  );
}

/** The price age of each product. An old price is still counted. */
export function PricesCell({ prices }: { prices: OverviewView["prices"] }) {
  if (prices.length === 0) return <p className="note">There are no products.</p>;
  return (
    <ul className="prices">
      {prices.map((price) => (
        <li key={price.productId}>
          <span>{price.name}</span>
          <PriceFreshnessPill age={price.age} />
          <span className="sub-line">
            {price.lastPrice ? `Close of ${price.lastPrice.priceDate}` : "No price"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Per FI level: today's share of the target, and the year it is reached. */
export function LevelsCell({ levels, note }: { levels: readonly LevelRow[]; note: string | null }) {
  if (levels.length === 0) return <p className="note">{note ?? "There is no projection yet."}</p>;
  const year = (value: number | null) => (value === null ? NOT_REACHED : String(value));
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Level</th>
            <th className="num">Reached today</th>
            <th className="num">
              Year, <TermPopover term="typical">typical case</TermPopover>
            </th>
            <th className="num">Year, deterministic</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level.name}>
              <td>{level.name}</td>
              <td className="num">{percentText(level.progress)}</td>
              <td className="num">{year(level.median)}</td>
              <td className="num">{year(level.deterministic)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
