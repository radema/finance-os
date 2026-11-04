import { useMemo } from "react";
import type { NextContributionView, PlanVsActualView } from "../../engine/trackingViews.ts";
import { useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { GoalChip } from "../goals/GoalChip.tsx";
import { formatEuro, formatPercent } from "../money.ts";
import { Card, Resource } from "../setup/ui.tsx";
import { CumulativeChart } from "./CumulativeChart.tsx";
import { Exhibit } from "./Exhibit.tsx";
import { gapText } from "./model.ts";
import { TimeChart } from "./TimeChart.tsx";

const centsAxis = (cents: number) => formatEuro(cents).replace(/,00/, "");
const gapLine = (gap: number) =>
  gap === 0 ? "exactly on plan" : `${formatEuro(Math.abs(gap))} ${gapText(gap)} plan`;

function NextCard({ next }: { next: NextContributionView | null }) {
  if (!next) {
    return (
      <Card title="Next contribution">
        <p className="note">No goal is behind its plan, so there is nothing to catch up.</p>
      </Card>
    );
  }
  const commission = next.split.reduce((sum, row) => sum + row.commission, 0);
  return (
    <Card title="Next contribution">
      <p>
        Put <strong>{formatEuro(next.amount)}</strong> into{" "}
        <GoalChip id={next.goalId} name={next.goalName} slot={next.slot} />, the goal furthest
        behind its plan.
      </p>
      <p className={next.wait ? "wait" : "note"}>
        {next.wait
          ? `Wait. ${formatEuro(next.amount)} is below the minimum efficient ticket of ${formatEuro(next.minTicket)}, so the commission takes a larger share than your plan's rate. Add it to next month's contribution.`
          : `No need to wait. The minimum efficient ticket is ${formatEuro(next.minTicket)}.`}
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Amount</th>
              <th className="num">Commission</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {next.split.map((row) => (
              <tr key={row.productId}>
                <td>{row.productName}</td>
                <td className="num">{formatEuro(row.amount)}</td>
                <td className="num">{formatEuro(row.commission)}</td>
                <td className="num">{formatPercent(row.costPct)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">{formatEuro(next.amount)}</td>
              <td className="num">{formatEuro(commission)}</td>
              <td className="num">{formatPercent(commission / next.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sub">
        The amount is the gap of the goal: what the plan asked for since the tracking start minus
        what you put in. It is split by the goal's allocation weights. The pension goal is never
        chosen.
      </p>
    </Card>
  );
}

function Totals({ view }: { view: PlanVsActualView }) {
  const { total } = view;
  const names = useMemo(() => total.map((m) => m.month), [total]);
  const monthly = useMemo(
    () => [
      { name: "Put in", data: total.map((m) => m.actual), colour: "--hl", kind: "bar" as const },
      {
        name: "Planned",
        data: total.map((m) => m.planned),
        colour: "--ctx",
        dashed: true,
        endLabel: true,
      },
    ],
    [total],
  );
  const last = total.at(-1);
  if (!last) return null;
  const source = `Source: your transactions and your plan versions, ${view.trackingStart} to ${last.month}.`;
  return (
    <>
      <Exhibit
        tag="Planned vs put in"
        title={`Since ${view.trackingStart} you planned ${formatEuro(last.cumPlanned)} and put in ${formatEuro(last.cumActual)}`}
        unit="Euros, cumulative, all goals."
        legend={[
          { label: "Planned", kind: "dash", colour: "--ctx" },
          { label: "Put in", kind: "line", colour: "--hl" },
        ]}
        callout={`All goals together are ${gapLine(last.gap)}. A month with no contribution is not a failure: only the running total counts.`}
        source={source}
      >
        <CumulativeChart
          months={total}
          slot={null}
          label="Planned and put in, all goals, cumulative"
        />
      </Exhibit>

      <Exhibit
        tag="Monthly actual"
        title={`In ${last.month} you put in ${formatEuro(last.actual)} against ${formatEuro(last.planned)} planned`}
        unit="Euros put in each month, against the plan of that month."
        legend={[
          { label: "Put in", kind: "bar", colour: "--hl" },
          { label: "Planned", kind: "dash", colour: "--ctx" },
        ]}
        callout={
          <>
            Put in counts buys and pension contributions with commissions. Opening positions and{" "}
            <TermPopover term="coupon">coupon</TermPopover>s are not contributions.
          </>
        }
        source={source}
      >
        <TimeChart
          months={names}
          series={monthly}
          format={centsAxis}
          label="Money put in each month, against the plan"
        />
      </Exhibit>
    </>
  );
}

function ByGoal({ view }: { view: PlanVsActualView }) {
  const behind = view.goals.filter((goal) => (goal.months.at(-1)?.gap ?? 0) < 0).length;
  return (
    <Exhibit
      tag="Plan vs actual per goal"
      title={`${behind} of ${view.goals.length} goals are behind plan`}
      unit="Euros, cumulative since the tracking start."
      legend={[
        { label: "Planned", kind: "dash", colour: "--ctx" },
        { label: "Put in", kind: "line", colour: "--ink2" },
      ]}
      callout="The pension goal plans from its contribution schedule. Other goals plan from their plan versions."
      source={`Source: your transactions and your plan versions, from ${view.trackingStart}.`}
    >
      <div className="grid-charts">
        {view.goals.map((goal) => (
          <div key={goal.goalId}>
            <div className="mini-title">
              <GoalChip id={goal.goalId} name={goal.name} slot={goal.slot} />
              {goal.months.length > 0 ? gapLine(goal.months.at(-1)?.gap ?? 0) : null}
            </div>
            <CumulativeChart
              months={goal.months}
              slot={goal.slot}
              label={`Planned and put in for ${goal.name}, cumulative`}
            />
          </div>
        ))}
      </div>
    </Exhibit>
  );
}

function PlanVsActual({ view }: { view: PlanVsActualView }) {
  if (view.goals.length === 0) {
    return (
      <>
        <h1 className="title">Plan vs actual</h1>
        <Card title="Plan vs actual">
          <p className="note">There are no goals. Add one in Setup.</p>
        </Card>
      </>
    );
  }
  const last = view.total.at(-1);
  return (
    <>
      <h1 className="title">
        {last
          ? `You are ${gapLine(last.gap)}, ${formatEuro(last.cumActual)} put in against ${formatEuro(last.cumPlanned)} planned`
          : "Plan vs actual"}
      </h1>
      <p className="unit">
        Planned against put in since the tracking start, {view.trackingStart}. Values at the end of{" "}
        {view.asOf.slice(0, 7)}.
      </p>
      {last ? (
        <>
          <NextCard next={view.next} />
          <Totals view={view} />
          <ByGoal view={view} />
          <Card title="By goal">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Goal</th>
                    <th className="num">Planned</th>
                    <th className="num">Put in</th>
                    <th className="num">Gap</th>
                    <th>Against plan</th>
                  </tr>
                </thead>
                <tbody>
                  {view.goals.map((goal) => {
                    const end = goal.months.at(-1);
                    return (
                      <tr key={goal.goalId}>
                        <td>
                          <GoalChip id={goal.goalId} name={goal.name} slot={goal.slot} />
                        </td>
                        <td className="num">{formatEuro(end?.cumPlanned ?? 0)}</td>
                        <td className="num">{formatEuro(end?.cumActual ?? 0)}</td>
                        <td className="num">{formatEuro(end?.gap ?? 0)}</td>
                        <td>{gapText(end?.gap ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card title="Plan vs actual">
          <p className="note">
            Tracking starts in {view.trackingStart}, after the last month with prices. There is
            nothing to compare yet.
          </p>
        </Card>
      )}
    </>
  );
}

/** Analysis > Plan vs actual: planned against put in, the next contribution, and each goal's gap. */
export function PlanVsActualScreen() {
  const loaded = useLoad<PlanVsActualView>("/api/plan-vs-actual");
  return (
    <>
      <div className="tag">Analysis</div>
      <Resource loaded={loaded}>{(view) => <PlanVsActual view={view} />}</Resource>
    </>
  );
}
