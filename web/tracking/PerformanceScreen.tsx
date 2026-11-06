import { useMemo, useState } from "react";
import type { PerformanceScopesView, PerformanceView } from "../../engine/trackingViews.ts";
import { useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { Kpi } from "../goals/Kpi.tsx";
import { formatAmount, formatPercent } from "../money.ts";
import { Card, Resource, SelectField } from "../setup/ui.tsx";
import { Exhibit } from "./Exhibit.tsx";
import {
  historyMonths,
  lineColour,
  MISSING,
  markColour,
  percentText,
  scopeKey,
  scopeOfKey,
  scopeQuery,
  xirrTile,
} from "./model.ts";
import { TimeChart } from "./TimeChart.tsx";

const euroAxis = (value: number) => formatAmount(value).replace(/,00/, "");
const indexAxis = (value: number) => String(Math.round(value));
const TWR_NOTE = "Needs a month that follows a month with a value.";

function Kpis({
  summary,
  months,
}: {
  summary: NonNullable<PerformanceView["summary"]>;
  months: number;
}) {
  const { twr } = summary;
  const xirr = xirrTile(summary.xirr, months);
  const twrNote = (value: number | null) => (value === null ? TWR_NOTE : undefined);
  return (
    <div className="kpis kpis-blue">
      <Kpi label="Value" value={formatAmount(summary.value)} />
      <Kpi
        label="Gain"
        value={formatAmount(summary.gain)}
        note={`Value minus ${formatAmount(summary.moneyIn)} put in.`}
      />
      <Kpi
        label={
          <>
            <TermPopover term="twr">TWR</TermPopover> since start
          </>
        }
        value={percentText(twr.sinceStart)}
        note={twrNote(twr.sinceStart)}
      />
      <Kpi
        label={
          <>
            <TermPopover term="twr">TWR</TermPopover> this year
          </>
        }
        value={percentText(twr.ytd)}
        note={twrNote(twr.ytd)}
      />
      <Kpi
        label={
          <>
            <TermPopover term="twr">TWR</TermPopover> 12 months
          </>
        }
        value={percentText(twr.last12m)}
        note={twrNote(twr.last12m)}
      />
      <Kpi
        label={
          <>
            <TermPopover term="xirr">XIRR</TermPopover> a year
          </>
        }
        value={xirr.value}
        note={xirr.note}
      />
      <Kpi
        label={
          <>
            Max <TermPopover term="drawdown">drawdown</TermPopover>
          </>
        }
        value={formatPercent(summary.maxDrawdown)}
        note="The deepest fall of the index from its highest point."
      />
    </div>
  );
}

function Charts({
  view,
  summary,
}: {
  view: PerformanceView;
  summary: NonNullable<PerformanceView["summary"]>;
}) {
  const { months, label, slot } = view;
  const mark = markColour(slot);
  const line = lineColour(slot);
  const names = useMemo(() => months.map((point) => point.month), [months]);
  const series = useMemo(
    () => ({
      value: [
        { name: "Value", data: months.map((p) => p.value), colour: mark, kind: "area" as const },
        {
          name: "Money put in",
          data: months.map((p) => p.moneyIn),
          colour: "--ctx",
          endLabel: true,
        },
      ],
      index: [{ name: "Growth of 100", data: months.map((p) => p.index), colour: line }],
      drawdown: [
        {
          name: "Drawdown",
          data: months.map((p) => p.drawdown),
          colour: mark,
          kind: "area" as const,
        },
      ],
      returns: [
        {
          name: "Monthly return",
          data: months.map((p) => p.twrMonthly),
          colour: mark,
          kind: "bar" as const,
        },
      ],
    }),
    [months, mark, line],
  );
  const last = months.at(-1);
  const returns = months.flatMap((p) => (p.twrMonthly === null ? [] : [p.twrMonthly]));
  const up = returns.filter((r) => r > 0).length;
  const month = last?.month ?? "";
  const gain = summary.gain;

  return (
    <>
      <Exhibit
        tag="Value and money put in"
        title={`${label} is worth ${formatAmount(summary.value)}, ${formatAmount(Math.abs(gain))} ${gain >= 0 ? "above" : "below"} the money put in`}
        unit="Euros, at the end of each month."
        legend={[
          { label: "Value", kind: "area", colour: mark },
          { label: "Money put in", kind: "line", colour: "--ctx" },
        ]}
        callout={`Money put in is cash paid for buys and pension contributions and opening positions at cost, minus sells and coupons, with commissions. It is ${formatAmount(summary.moneyIn)} at the end of ${month}.`}
        source={`Source: your transactions and the prices you saved, to ${month}.`}
      >
        <TimeChart
          months={names}
          series={series.value}
          format={euroAxis}
          label={`Value and money put in for ${label}, month by month`}
        />
      </Exhibit>

      <Exhibit
        tag="Growth of 100"
        title={`100 euros at the start of ${label} are ${formatAmount(last?.index ?? 100)} now`}
        unit="Index, first month = 100. It is time-weighted: money you put in or take out does not move it."
        callout={`The index is chained from the monthly returns. Since the start the time-weighted return is ${percentText(summary.twr.sinceStart)}.`}
        source={`Source: your transactions and the prices you saved, to ${month}.`}
      >
        <TimeChart
          months={names}
          series={series.index}
          format={indexAxis}
          zeroBase={false}
          label={`Growth of 100 euros in ${label}, month by month`}
        />
      </Exhibit>

      <Exhibit
        tag="Drawdown"
        title={`The deepest fall from a peak was ${formatPercent(summary.maxDrawdown)}`}
        unit="Index against its highest earlier point, at the end of each month."
        callout={`The index is now ${formatPercent(last?.drawdown ?? 0)} from its highest point. A bar at 0 means it is at a new high.`}
        source={`Source: your transactions and the prices you saved, to ${month}.`}
      >
        <TimeChart
          months={names}
          series={series.drawdown}
          format={formatPercent}
          label={`Drawdown of ${label}, month by month`}
        />
      </Exhibit>

      <Exhibit
        tag="Monthly returns"
        title={`${label} rose in ${up} of ${returns.length} months`}
        unit="Time-weighted return of each month, in percent."
        callout="A month has no return when the month before it held nothing."
        source={`Source: your transactions and the prices you saved, to ${month}.`}
      >
        <TimeChart
          months={names}
          series={series.returns}
          format={formatPercent}
          label={`Monthly returns of ${label}`}
        />
      </Exhibit>
    </>
  );
}

function ScopesTable({ scopes }: { scopes: PerformanceScopesView }) {
  return (
    <Card title="All scopes">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Scope</th>
              <th className="num">Value</th>
              <th className="num">Gain</th>
              <th className="num">
                <TermPopover term="twr">TWR</TermPopover> since start
              </th>
              <th className="num">
                <TermPopover term="twr">TWR</TermPopover> this year
              </th>
              <th className="num">
                <TermPopover term="twr">TWR</TermPopover> 12 months
              </th>
              <th className="num">
                <TermPopover term="xirr">XIRR</TermPopover> a year
              </th>
              <th className="num">
                Max <TermPopover term="drawdown">drawdown</TermPopover>
              </th>
            </tr>
          </thead>
          <tbody>
            {scopes.rows.map(({ scope, label, summary, note }) => (
              <tr key={scopeKey(scope)}>
                <td>
                  {label}
                  {note ? <span className="sub-line"> {note}</span> : null}
                </td>
                <td className="num">{summary ? formatAmount(summary.value) : MISSING}</td>
                <td className="num">{summary ? formatAmount(summary.gain) : MISSING}</td>
                <td className="num">{percentText(summary?.twr.sinceStart ?? null)}</td>
                <td className="num">{percentText(summary?.twr.ytd ?? null)}</td>
                <td className="num">{percentText(summary?.twr.last12m ?? null)}</td>
                <td className="num">{percentText(summary?.xirr ?? null)}</td>
                <td className="num">{summary ? formatPercent(summary.maxDrawdown) : MISSING}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">
        <TermPopover term="twr">TWR</TermPopover> is the time-weighted return, chained from monthly
        returns. <TermPopover term="xirr">XIRR</TermPopover> is the annual rate of your dated cash
        flows and the final value.
      </p>
    </Card>
  );
}

/** Analysis > Performance: returns, drawdown and value per scope, and a table of all scopes. */
export function PerformanceScreen() {
  const scopes = useLoad<PerformanceScopesView>("/api/performance/scopes");
  const [key, setKey] = useState("all");
  const view = useLoad<PerformanceView>(`/api/performance?${scopeQuery(scopeOfKey(key))}`);
  const options = (
    scopes.data?.rows ?? [{ scope: { kind: "all" as const }, label: "All goals" }]
  ).map((row) => ({ value: scopeKey(row.scope), label: row.label }));

  return (
    <>
      <div className="tag">Analysis</div>
      <Resource loaded={view}>
        {(current) => {
          const { summary } = current;
          return (
            <>
              <h1 className="title">
                {summary
                  ? summary.twr.sinceStart === null
                    ? `${current.label} is worth ${formatAmount(summary.value)}`
                    : `${current.label} returned ${formatPercent(summary.twr.sinceStart)} since the start, on ${formatAmount(summary.value)}`
                  : "Performance"}
              </h1>
              <p className="unit">
                Returns, value and drawdown of one scope. Values at the end of{" "}
                {current.asOf.slice(0, 7)}.
              </p>
              <div className="scope-bar">
                <SelectField label="Scope" value={key} onChange={setKey} options={options} />
              </div>
              {summary ? (
                <>
                  <Kpis summary={summary} months={historyMonths(current)} />
                  <Charts view={current} summary={summary} />
                </>
              ) : (
                <Card title={current.label}>
                  <p className="note">{current.note}</p>
                </Card>
              )}
            </>
          );
        }}
      </Resource>
      <Resource loaded={scopes}>{(data) => <ScopesTable scopes={data} />}</Resource>
    </>
  );
}
