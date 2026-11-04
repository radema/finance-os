import type { CSSProperties } from "react";
import type { GoalAnalysis, GoalDetailView } from "../../engine/goalViews.ts";
import type { PerformanceView } from "../../engine/trackingViews.ts";
import { useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatAmount, formatPercent, formatUnitPrice } from "../money.ts";
import { GOALS_LIST_ROUTE } from "../nav.ts";
import { Card, PriorityTag, ProductTag, Resource } from "../setup/ui.tsx";
import { percentText, scopeQuery, xirrNote } from "../tracking/model.ts";
import { FanChart } from "./FanChart.tsx";
import { GoalTracking } from "./GoalTracking.tsx";
import { Kpi } from "./Kpi.tsx";
import { horizonText, requiredText, usesSlotLine } from "./outlook.ts";
import { RangeChart } from "./RangeChart.tsx";
import { StatusChip } from "./StatusChip.tsx";
import { ValueChart } from "./ValueChart.tsx";

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });
const NOT_FOUND = "goal not found";
const MISSING = "–";

const orMissing = (amount: number | null) => (amount === null ? MISSING : formatAmount(amount));

function Exhibit({ goal }: { goal: GoalDetailView }) {
  const last = goal.series.at(-1);
  if (!last) {
    return (
      <Card title="Value against money put in">
        <p className="note">This goal has no transactions yet.</p>
      </Card>
    );
  }
  const month = last.month;
  const moneyIn = last.moneyIn;
  const gain = last.value === null ? null : last.value - moneyIn;
  const title =
    gain === null
      ? `${goal.name} has ${formatAmount(moneyIn)} put in, and a product has no price`
      : `${goal.name} is worth ${formatAmount(last.value ?? 0)}, ${formatAmount(Math.abs(gain))} ${gain >= 0 ? "above" : "below"} the money put in`;

  return (
    <figure className="exhibit" style={{ "--slot": `var(--slot${goal.slot})` } as CSSProperties}>
      <div className="tag">Value and money put in</div>
      <h2 className="exhibit-title">{title}</h2>
      <p className="unit">Euros, at the end of each month.</p>
      <ul className="legend">
        <li>
          <span className="swatch swatch-area" />
          Value
        </li>
        <li>
          <span className="swatch swatch-line" />
          Money put in
        </li>
      </ul>
      <ValueChart
        points={goal.series}
        slot={goal.slot}
        label={`Value and money put in for ${goal.name}, month by month`}
      />
      <p className="callout">
        Money put in is cash paid for buys and pension contributions, minus sells and coupons, with
        commissions. It is {formatAmount(moneyIn)} at the end of {month}.
      </p>
      <figcaption className="source">
        Source: your transactions and the prices you saved, to {month}.
      </figcaption>
    </figure>
  );
}

const slotStyle = (slot: number) =>
  ({
    "--slot": `var(--slot${slot})`,
    "--line": usesSlotLine(slot) ? `var(--slot${slot})` : "var(--ink2)",
  }) as CSSProperties;
const bandLegend = (
  <>
    <li>
      <span className="swatch swatch-band" />
      <TermPopover term="badcase">Bad case</TermPopover> to{" "}
      <TermPopover term="goodcase">good case</TermPopover>
    </li>
    <li>
      <span className="swatch swatch-median" />
      <TermPopover term="typical">Typical case</TermPopover>
    </li>
    <li>
      <span className="swatch swatch-target" />
      Target
    </li>
  </>
);

function FanExhibit({ goal, analysis }: { goal: GoalDetailView; analysis: GoalAnalysis }) {
  const { pSuccess, requiredP, fan, targetAtGoalDate } = analysis;
  const reached = pSuccess >= requiredP;
  const title = `${goal.name} reaches its target in ${formatPercent(pSuccess)} of simulated markets${
    reached
      ? `; ${formatPercent(requiredP)} is required`
      : `, below the ${formatPercent(requiredP)} required`
  }`;
  const last = fan.at(-1);
  return (
    <figure className="exhibit" style={slotStyle(goal.slot)}>
      <div className="tag">Fan of outcomes</div>
      <h2 className="exhibit-title">{title}</h2>
      <p className="unit">
        Net value if sold at the end of that year, in euros of that year. The band runs from the{" "}
        <TermPopover term="badcase">bad case</TermPopover> to the{" "}
        <TermPopover term="goodcase">good case</TermPopover>.
      </p>
      {fan.length > 1 ? (
        <>
          <ul className="legend">{bandLegend}</ul>
          <FanChart
            fan={fan}
            target={targetAtGoalDate}
            slot={goal.slot}
            label={`Fan of outcomes for ${goal.name}: bad, typical and good case by year, against the target`}
          />
        </>
      ) : (
        <p className="note">
          This goal is due this year, so there is no path to draw. The range below shows the
          outcome.
        </p>
      )}
      <p className="callout">
        The target is {formatAmount(goal.target)} in{" "}
        <TermPopover term="real">today’s euros</TermPopover>, {formatAmount(targetAtGoalDate)} at
        the goal date.
        {last ? ` The typical case ends at ${formatAmount(last.typical)}.` : null}
      </p>
      <figcaption className="source">
        Source: your holdings and prices to {goal.asOf.slice(0, 7)}; {analysis.paths} simulated
        markets, seed {analysis.seed}; after tax and fund costs.
      </figcaption>
    </figure>
  );
}

function RangeExhibit({ goal, analysis }: { goal: GoalDetailView; analysis: GoalAnalysis }) {
  const { range } = analysis;
  const gap = range.typical - range.target;
  const title = `In the typical case ${goal.name} ends ${formatAmount(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} its target`;
  return (
    <figure className="exhibit" style={slotStyle(goal.slot)}>
      <div className="tag">Range of outcomes</div>
      <h2 className="exhibit-title">{title}</h2>
      <p className="unit">Net value at the goal date, 31 December {goal.targetYear}, in euros.</p>
      <ul className="legend">{bandLegend}</ul>
      <RangeChart
        range={range}
        slot={goal.slot}
        label={`Range of outcomes for ${goal.name} at the goal date: bad ${formatAmount(range.bad)}, typical ${formatAmount(range.typical)}, good ${formatAmount(range.good)}, target ${formatAmount(range.target)}`}
      />
      <p className="callout">
        The bad case is {formatAmount(range.bad)} and the good case is {formatAmount(range.good)}.
        The target at the goal date is {formatAmount(range.target)}.
      </p>
      <figcaption className="source">
        Source: {analysis.paths} simulated markets, seed {analysis.seed}; after tax and fund costs.
      </figcaption>
    </figure>
  );
}

function WhatItWouldTake({ analysis }: { analysis: GoalAnalysis }) {
  const { required, requiredP, horizonYears } = analysis;
  const { deterministic, probability, currentMonthly, unit } = required;
  const against = (amount: number | null) => {
    if (amount === null || amount === 0 || currentMonthly === null) return null;
    const gap = amount - currentMonthly;
    if (Math.abs(gap) < 0.005) return "The same as now";
    return `${formatAmount(Math.abs(gap))} ${gap > 0 ? "more" : "less"} than now`;
  };
  const rows: { label: string; hint: string; amount: number | null }[] = [
    {
      label: "To reach the target",
      hint: "The lowest amount that reaches the target on the typical growth of each product",
      amount: deterministic,
    },
    {
      label: `For a ${formatPercent(requiredP)} chance`,
      hint: "The lowest amount that meets the required probability",
      amount: probability,
    },
  ];
  return (
    <Card title="What it would take">
      <ul className="take-list">
        {rows.map((row) => (
          <li key={row.label}>
            <span>
              {row.label}
              <small className="take-hint">{row.hint}.</small>
            </span>
            <span className="take-value">
              {requiredText(row.amount, unit)}
              <small>{against(row.amount)}</small>
            </span>
          </li>
        ))}
        <li>
          <span>Time to the goal date</span>
          <span className="take-value">{horizonText(horizonYears)}</span>
        </li>
      </ul>
      <p className="sub">
        {currentMonthly === null
          ? "For the pension goal the answer is a multiple of its contribution schedule: 1 is the schedule as it is."
          : `You put in ${formatAmount(currentMonthly)} a month now.`}
      </p>
    </Card>
  );
}

function Analysis({ goal }: { goal: GoalDetailView }) {
  const { analysis } = goal;
  if (!analysis) {
    return (
      <Card title={<TermPopover term="simulated">Monte Carlo</TermPopover>}>
        <p className="note">{goal.projectionNote ?? "The simulation cannot run for this goal."}</p>
      </Card>
    );
  }
  return (
    <>
      <FanExhibit goal={goal} analysis={analysis} />
      <RangeExhibit goal={goal} analysis={analysis} />
      <WhatItWouldTake analysis={analysis} />
    </>
  );
}

/** The goal's XIRR from the performance of its bucket; the dash and a reason when there is none. */
function XirrKpi({ goalId }: { goalId: string }) {
  const loaded = useLoad<PerformanceView>(
    `/api/performance?${scopeQuery({ kind: "bucket", goalId })}`,
  );
  const { data } = loaded;
  const note = data
    ? (data.note ?? xirrNote(data.summary?.xirr ?? null))
    : (loaded.error ?? "Loading.");
  return (
    <Kpi
      label={<TermPopover term="xirr">XIRR a year</TermPopover>}
      value={percentText(data?.summary?.xirr ?? null)}
      note={note}
    />
  );
}

function Detail({ goal }: { goal: GoalDetailView }) {
  const net = goal.projection?.net ?? null;
  const goalDate = `31 December ${goal.targetYear}`;
  return (
    <div style={{ "--slot": `var(--slot${goal.slot})` } as CSSProperties}>
      <div className="tag">Goal</div>
      <h1 className="title">{goal.name}</h1>
      <p className="unit">
        <PriorityTag priority={goal.priority} />{" "}
        {goal.analysis ? <StatusChip status={goal.analysis.status} /> : null} Goal date {goalDate}.
        Values at the end of {goal.asOf.slice(0, 7)}.
      </p>

      <div className="kpis">
        <Kpi
          label={<TermPopover term="prob">Chance of success</TermPopover>}
          value={goal.analysis ? formatPercent(goal.analysis.pSuccess) : MISSING}
          note={
            goal.analysis
              ? `${formatPercent(goal.analysis.requiredP)} required.`
              : "The simulation cannot run for this goal."
          }
        />
        <Kpi
          label="Value"
          value={formatAmount(goal.value)}
          note={
            goal.missingPrices ? "A product has no price, so this value is partial." : undefined
          }
        />
        <Kpi
          label={`Deterministic net at ${goal.targetYear}`}
          value={orMissing(net)}
          note={
            goal.projection
              ? `After ${formatAmount(goal.projection.tax)} of tax, on a gross of ${formatAmount(goal.projection.gross)}.`
              : goal.projectionNote
          }
        />
        <Kpi
          label="Target at the goal date"
          value={formatAmount(goal.targetAtGoalDate)}
          note={
            <>
              {formatAmount(goal.target)} in <TermPopover term="real">today’s euros</TermPopover>,
              grown by inflation.
            </>
          }
        />
        <XirrKpi goalId={goal.id} />
      </div>

      <Analysis goal={goal} />

      <Card title="Holdings">
        {goal.holdings.length === 0 ? (
          <p className="note">This goal holds nothing yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Units</th>
                  <th className="num">Price</th>
                  <th className="num">
                    <TermPopover term="pmc">PMC</TermPopover>
                  </th>
                  <th className="num">Value</th>
                  <th className="num">Gain</th>
                  <th className="num">Tax if sold</th>
                </tr>
              </thead>
              <tbody>
                {goal.holdings.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      {row.name} <ProductTag regime={row.regime} />
                    </td>
                    <td className="num">{quantity.format(row.units)}</td>
                    <td className="num">
                      {row.price === null ? "No price" : formatUnitPrice(row.price)}
                    </td>
                    <td className="num">{formatUnitPrice(row.pmc)}</td>
                    <td className="num">{orMissing(row.value)}</td>
                    <td className="num">{orMissing(row.gain)}</td>
                    <td className="num">{orMissing(row.taxIfSold)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={6}>
                    Tax if the whole goal were sold
                  </th>
                  <td className="num">{orMissing(goal.taxIfSoldTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="sub">
          Price and <TermPopover term="pmc">PMC</TermPopover> are for one unit: a government bond is
          quoted per 100. Each row's tax is for that holding alone; the total uses the goal's loss
          credits and <TermPopover term="zainetto">zainetto</TermPopover> once.
        </p>
      </Card>

      <Exhibit goal={goal} />
      <GoalTracking goal={goal} />
    </div>
  );
}

function Loader({ goalId }: { goalId: string }) {
  const loaded = useLoad<GoalDetailView>(`/api/goal-detail?id=${encodeURIComponent(goalId)}`);
  if (loaded.error === NOT_FOUND) {
    return (
      <>
        <div className="tag">Not found</div>
        <h1 className="title">Goal not found</h1>
        <p className="unit">
          This goal does not exist. It may have been deleted.{" "}
          <a href={`#/${GOALS_LIST_ROUTE}`}>Back to the Goals list</a>.
        </p>
      </>
    );
  }
  return <Resource loaded={loaded}>{(goal) => <Detail goal={goal} />}</Resource>;
}

/** Goals > Detail: value, P vs required, fan, range, what it would take, holdings, value vs money put in. */
export function GoalDetailScreen({ goalId }: { goalId: string | undefined }) {
  if (goalId === undefined) {
    return (
      <>
        <div className="tag">Goal</div>
        <h1 className="title">Pick a goal</h1>
        <p className="unit">
          Open a goal from the <a href={`#/${GOALS_LIST_ROUTE}`}>Goals list</a>.
        </p>
      </>
    );
  }
  return <Loader goalId={goalId} />;
}
