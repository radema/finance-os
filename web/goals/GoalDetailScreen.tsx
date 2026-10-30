import type { CSSProperties, ReactNode } from "react";
import type { GoalDetail } from "../../engine/goalViews.ts";
import { useLoad } from "../api.ts";
import { formatAmount, formatUnitPrice } from "../money.ts";
import { GOALS_LIST_ROUTE } from "../nav.ts";
import { Card, PriorityTag, ProductTag, Resource } from "../setup/ui.tsx";
import { ValueChart } from "./ValueChart.tsx";

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });
const NOT_FOUND = "goal not found";
const MISSING = "–";

const orMissing = (amount: number | null) => (amount === null ? MISSING : formatAmount(amount));

function Kpi({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note ? <p className="sub">{note}</p> : null}
    </div>
  );
}

function Exhibit({ goal }: { goal: GoalDetail }) {
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

function Detail({ goal }: { goal: GoalDetail }) {
  const net = goal.projection?.net ?? null;
  const goalDate = `31 December ${goal.targetYear}`;
  return (
    <div style={{ "--slot": `var(--slot${goal.slot})` } as CSSProperties}>
      <div className="tag">Goal</div>
      <h1 className="title">{goal.name}</h1>
      <p className="unit">
        <PriorityTag priority={goal.priority} /> Goal date {goalDate}. Values at the end of{" "}
        {goal.asOf.slice(0, 7)}.
      </p>

      <div className="kpis">
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
          note={`${formatAmount(goal.target)} in today's euros, grown by inflation.`}
        />
      </div>

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
                  <th className="num">PMC</th>
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
          Price and PMC are for one unit: a government bond is quoted per 100. Each row's tax is for
          that holding alone; the total uses the goal's loss credits and zainetto once.
        </p>
      </Card>

      <Exhibit goal={goal} />
    </div>
  );
}

function Loader({ goalId }: { goalId: string }) {
  const loaded = useLoad<GoalDetail>(`/api/goal-detail?id=${encodeURIComponent(goalId)}`);
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

/** Goals > Detail: value, deterministic net, target at the goal date, holdings, value vs money put in. */
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
