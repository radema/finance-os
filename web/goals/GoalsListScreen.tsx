import { useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { formatAmount, formatPercent } from "../money.ts";
import { Alert, Card, PriorityTag, Resource } from "../setup/ui.tsx";
import { GoalChip } from "./GoalChip.tsx";

function SampleCard({ onLoaded }: { onLoaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/sample-data");
      setError(undefined);
      onLoaded();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Sample data">
      <p className="note">
        The data folder is empty. Load made-up products, goals and transactions to look around. They
        are not real, and you can only load them into an empty folder.
      </p>
      <div className="actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          Load the sample data
        </button>
      </div>
      <Alert message={error} />
    </Card>
  );
}

/** Goals > List: one row per goal with its priority and its value against its target. */
export function GoalsListScreen() {
  const list = useLoad<GoalListView>("/api/goal-list");

  return (
    <>
      <div className="tag">Goals</div>
      <Resource loaded={list}>
        {({ asOf, goals, sampleAvailable }) => {
          const value = goals.reduce((sum, goal) => sum + goal.value, 0);
          const target = goals.reduce((sum, goal) => sum + goal.target, 0);
          return (
            <>
              <h1 className="title">
                {goals.length === 0
                  ? "No goals yet"
                  : `${goals.length} ${goals.length === 1 ? "goal holds" : "goals hold"} ${formatAmount(value)} against ${formatAmount(target)} of targets`}
              </h1>
              <p className="unit">
                Value at the end of {asOf.slice(0, 7)}. Targets in today's euros.
              </p>

              {goals.length === 0 ? (
                sampleAvailable ? (
                  <SampleCard onLoaded={list.reload} />
                ) : (
                  <Card title="Goals">
                    <p className="note">There are no goals. Add one in Setup.</p>
                  </Card>
                )
              ) : (
                <Card title="Goals">
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Goal</th>
                          <th>Priority</th>
                          <th className="num">Value</th>
                          <th className="num">Target</th>
                          <th>Value vs target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {goals.map((goal) => {
                          const share = goal.target > 0 ? goal.value / goal.target : undefined;
                          return (
                            <tr key={goal.id}>
                              <td>
                                <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
                              </td>
                              <td>
                                <PriorityTag priority={goal.priority} />
                              </td>
                              <td className="num">
                                {formatAmount(goal.value)}
                                {goal.missingPrices ? (
                                  <span className="sub-line"> A price is missing.</span>
                                ) : null}
                              </td>
                              <td className="num">{formatAmount(goal.target)}</td>
                              <td>
                                {share === undefined ? (
                                  "–"
                                ) : (
                                  <span className="meter-cell">
                                    <span className="meter" aria-hidden="true">
                                      <span
                                        className="meter-fill"
                                        style={{
                                          width: `${Math.min(share, 1) * 100}%`,
                                          background: `var(--slot${goal.slot})`,
                                        }}
                                      />
                                    </span>
                                    {formatPercent(share)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          );
        }}
      </Resource>
    </>
  );
}
