import { type FormEvent, useMemo, useState } from "react";
import type { GoalDetailView } from "../../engine/goalViews.ts";
import type { SnapshotView } from "../../engine/snapshot.ts";
import type { PlanVsActualView } from "../../engine/trackingViews.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { eurosToCents } from "../forms.ts";
import { currentMonth, formatEuro, formatPercent } from "../money.ts";
import { CapitalNote } from "../pension/CapitalNote.tsx";
import { Alert, Card, NumberField, Resource, TextField } from "../setup/ui.tsx";
import { CumulativeChart } from "../tracking/CumulativeChart.tsx";
import { Exhibit } from "../tracking/Exhibit.tsx";
import { gapText, historyOf, lineColour, markColour } from "../tracking/model.ts";
import { TimeChart } from "../tracking/TimeChart.tsx";

function ProbabilityHistory({ goal }: { goal: GoalDetailView }) {
  const snapshots = useLoad<SnapshotView[]>("/api/snapshots");
  return (
    <Resource loaded={snapshots}>{(rows) => <History goal={goal} snapshots={rows} />}</Resource>
  );
}

function History({ goal, snapshots }: { goal: GoalDetailView; snapshots: SnapshotView[] }) {
  const history = useMemo(() => historyOf(snapshots, "prob"), [snapshots]);
  const values = history.lines.find((line) => line.goalId === goal.id)?.values ?? [];
  const series = useMemo(
    () => [
      {
        name: "Chance of success",
        data: values,
        colour: lineColour(goal.slot),
        markers: true,
        hollow: history.recomputed,
      },
    ],
    [values, history.recomputed, goal.slot],
  );
  const last = values.at(-1);
  if (values.length === 0) {
    return (
      <Card title="Chance of success over time">
        <p className="note">
          This goal has no snapshots yet. The first one is saved when a month closes. See{" "}
          <a href="#/goals/history">Goal history</a>.
        </p>
      </Card>
    );
  }
  const month = history.months.at(-1);
  return (
    <Exhibit
      tag="Chance of success over time"
      title={
        last == null
          ? `${goal.name} could not be analysed at the last snapshot, ${month}`
          : `${goal.name} reached its target in ${formatPercent(last)} of simulated markets at ${month}`
      }
      unit="Share of simulated markets that reach the target, at each monthly snapshot."
      legend={[
        { label: "Saved", kind: "dot", colour: markColour(goal.slot) },
        { label: "Recomputed", kind: "ring", colour: markColour(goal.slot) },
      ]}
      callout="A hollow marker is a recomputed snapshot: rebuilt later with today's assumptions. A gap means the goal could not be analysed that month."
      source={`Source: your monthly snapshots, ${history.months[0]} to ${month}.`}
    >
      <TimeChart
        months={history.months}
        series={series}
        format={formatPercent}
        label={`Chance of success of ${goal.name} over the monthly snapshots`}
      />
    </Exhibit>
  );
}

function ChangePlan({
  goalId,
  planned,
  month,
  onSaved,
}: {
  goalId: string;
  /** What the plan asks for in the last month compared, cents. */
  planned: number | undefined;
  month: string | undefined;
  onSaved: () => void;
}) {
  const [fromMonth, setFromMonth] = useState(currentMonth());
  const [monthly, setMonthly] = useState("");
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("PUT", "/api/goal-plan", {
        body: { goalId, fromMonth, monthlyCents: eurosToCents(monthly) },
      });
      setError(undefined);
      setMonthly("");
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  return (
    <Card
      title="Change the monthly plan"
      note="A new amount starts in the month you choose. Earlier months keep the amount they had."
    >
      {planned === undefined ? null : (
        <p>
          The plan in {month} is <strong>{formatEuro(planned)}</strong> a month.
        </p>
      )}
      <form className="inline-form" onSubmit={submit}>
        <TextField label="From month (YYYY-MM)" value={fromMonth} onChange={setFromMonth} />
        <NumberField
          label="Monthly amount (EUR)"
          value={monthly}
          onChange={setMonthly}
          step="0.01"
        />
        <button className="btn btn-primary" type="submit">
          Change plan
        </button>
      </form>
      <Alert message={error} />
    </Card>
  );
}

function Tracking({
  goal,
  view,
  reload,
}: {
  goal: GoalDetailView;
  view: PlanVsActualView;
  reload: () => void;
}) {
  const entry = view.goals.find((candidate) => candidate.goalId === goal.id);
  const isPension = view.pensionGoalId === goal.id;
  const last = entry?.months.at(-1);
  const source = `Source: your transactions and your plan versions, ${view.trackingStart} to ${last?.month}.`;
  return (
    <>
      {entry && last ? (
        <Exhibit
          tag="Plan vs actual"
          title={`${goal.name} is ${last.gap === 0 ? "exactly on plan" : `${formatEuro(Math.abs(last.gap))} ${gapText(last.gap)} plan`}: ${formatEuro(last.cumActual)} put in against ${formatEuro(last.cumPlanned)} planned`}
          unit="Euros, cumulative since the tracking start."
          legend={[
            { label: "Planned", kind: "dash", colour: "--ctx" },
            { label: "Put in", kind: "line", colour: lineColour(goal.slot) },
          ]}
          callout="A month with no contribution is not a failure: only the running total counts."
          source={source}
        >
          <CumulativeChart
            months={entry.months}
            slot={goal.slot}
            label={`Planned and put in for ${goal.name}, cumulative`}
          />
        </Exhibit>
      ) : (
        <Card title="Plan vs actual">
          <p className="note">
            There is nothing to compare yet: tracking starts in {view.trackingStart}.
          </p>
        </Card>
      )}
      {isPension && view.pensionPlanFromSchedule ? (
        <Card title="Monthly plan">
          <p className="note">
            The pension goal plans from its contribution schedule: change it on the{" "}
            <a href="#/pension">Pension</a> screen.
          </p>
        </Card>
      ) : (
        <ChangePlan goalId={goal.id} planned={last?.planned} month={last?.month} onSaved={reload} />
      )}
      {isPension ? <CapitalNote /> : null}
    </>
  );
}

/** What the Goal detail adds from tracking: P history, plan vs actual, the plan change, the pension note. */
export function GoalTracking({ goal }: { goal: GoalDetailView }) {
  const view = useLoad<PlanVsActualView>("/api/plan-vs-actual");
  return (
    <>
      <ProbabilityHistory goal={goal} />
      <Resource loaded={view}>
        {(data) => <Tracking goal={goal} view={data} reload={view.reload} />}
      </Resource>
    </>
  );
}
