import { useMemo, useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import type { SnapshotView } from "../../engine/snapshot.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { formatPercent } from "../money.ts";
import { Alert, Card, ConfirmButton, Resource } from "../setup/ui.tsx";
import { Exhibit } from "./Exhibit.tsx";
import {
  HISTORY_METRICS,
  type HistoryMetric,
  historyOf,
  historySeries,
  knownGoals,
  percentText,
} from "./model.ts";
import { TimeChart } from "./TimeChart.tsx";

function SourceLabel({ recomputed }: { recomputed: boolean }) {
  return recomputed ? (
    <span className="source-label source-label-recomputed">Recomputed</span>
  ) : (
    <span className="source-label source-label-saved">Saved</span>
  );
}

function History({
  snapshots,
  goals,
  asOf,
  onChange,
}: {
  snapshots: SnapshotView[];
  goals: GoalListView["goals"];
  asOf: string;
  onChange: () => void;
}) {
  const [metric, setMetric] = useState<HistoryMetric>("prob");
  const [error, setError] = useState<string>();
  const history = useMemo(() => historyOf(snapshots, metric), [snapshots, metric]);
  const known = useMemo(() => knownGoals(history, goals), [history, goals]);
  const series = useMemo(() => historySeries(history, known), [history, known]);
  const current = HISTORY_METRICS.find((candidate) => candidate.key === metric);
  const recomputed = history.recomputed.filter(Boolean).length;
  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      onChange();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <>
      <div className="switch" role="toolbar" aria-label="Metric">
        {HISTORY_METRICS.map(({ key, label }) => (
          <button
            key={key}
            className="btn"
            type="button"
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {history.months.length === 0 ? (
        <Card title="Snapshots">
          <p className="note">
            There are no snapshots yet. The app saves one when a month closes, or you can save one
            now.
          </p>
        </Card>
      ) : (
        <Exhibit
          tag="Goal history"
          title={`${current?.label} of ${known.length} ${known.length === 1 ? "goal" : "goals"} over ${history.months.length} monthly ${history.months.length === 1 ? "snapshot" : "snapshots"}, ${recomputed} of them recomputed`}
          unit={current?.unit ?? ""}
          legend={[
            ...known.map((goal) => ({
              label: goal.name,
              kind: "dot" as const,
              colour: goal.colour,
            })),
            { label: "Saved", kind: "dot", colour: "--ink2" },
            { label: "Recomputed", kind: "ring", colour: "--ink2" },
          ]}
          callout="A hollow marker is a recomputed snapshot: it was rebuilt later with today's assumptions, not saved at the time. A gap means the goal could not be analysed that month."
          source={`Source: your monthly snapshots, ${history.months[0]} to ${history.months.at(-1)}. Higher is better.`}
        >
          <TimeChart
            months={history.months}
            series={series}
            format={formatPercent}
            label={`${current?.label} of each goal over the monthly snapshots`}
          />
        </Exhibit>
      )}

      <Card title="Snapshot table">
        <Alert message={error} />
        <div className="actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => run(() => api("POST", "/api/snapshots"))}
          >
            Save snapshot
          </button>
          <span className="sub-line">
            Saves the analysis of {asOf.slice(0, 7)}, the last month with prices.
          </span>
        </div>
        {history.months.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Source</th>
                  {known.map((goal) => (
                    <th key={goal.id} className="num">
                      {goal.name}
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {history.months
                  .map((month, index) => ({ month, index }))
                  .reverse()
                  .map(({ month, index }) => (
                    <tr key={month}>
                      <td>{month}</td>
                      <td>
                        <SourceLabel recomputed={history.recomputed[index] ?? false} />
                      </td>
                      {history.lines.map((line) => (
                        <td key={line.goalId} className="num">
                          {percentText(line.values[index] ?? null)}
                        </td>
                      ))}
                      <td className="row-actions">
                        {history.recomputed[index] ? null : (
                          <ConfirmButton
                            label="Delete"
                            confirmLabel="Delete snapshot"
                            onConfirm={() =>
                              run(() => api("DELETE", "/api/snapshots", { query: { id: month } }))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="sub">
          Only saved snapshots can be deleted. The next monthly run stores a deleted month again,
          rebuilt as recomputed. Funded ratio is value divided by target; the spec does not define
          it.
        </p>
      </Card>
    </>
  );
}

/** Goals > History: one line per goal over the monthly snapshots, and the snapshot table. */
export function GoalHistoryScreen() {
  const snapshots = useLoad<SnapshotView[]>("/api/snapshots");
  const list = useLoad<GoalListView>("/api/goal-list");
  return (
    <>
      <div className="tag">Goals</div>
      <h1 className="title">Goal history</h1>
      <p className="unit">
        How the analysis of each goal changed over the monthly snapshots. A snapshot is frozen when
        it is saved.
      </p>
      <Resource loaded={snapshots}>
        {(rows) => (
          <Resource loaded={list}>
            {({ goals, asOf }) => (
              <History snapshots={rows} goals={goals} asOf={asOf} onChange={snapshots.reload} />
            )}
          </Resource>
        )}
      </Resource>
    </>
  );
}
