import type { GoalListView } from "../../engine/goalViews.ts";
import type { PlanVsActualView } from "../../engine/trackingViews.ts";
import { useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatAmount, formatEuro, formatPercent } from "../money.ts";
import { SampleCard } from "../setup/SampleCard.tsx";
import { Card, PriorityTag, Resource } from "../setup/ui.tsx";
import { gapText, MISSING } from "../tracking/model.ts";
import { GoalChip } from "./GoalChip.tsx";
import { pVsRequired } from "./outlook.ts";
import { StatusChip } from "./StatusChip.tsx";

/** Goals > List: one row per goal with its priority, status, P against the required probability, and value against target. */
export function GoalsListScreen() {
  const list = useLoad<GoalListView>("/api/goal-list");
  const plan = useLoad<PlanVsActualView>("/api/plan-vs-actual");
  /** A goal's cumulative gap against its plan, in cents; undefined while loading or before tracking starts. */
  const gapOf = (goalId: string): number | undefined =>
    plan.data?.goals.find((goal) => goal.goalId === goalId)?.months.at(-1)?.gap;

  return (
    <>
      <div className="tag">Goals</div>
      <Resource loaded={list}>
        {({ asOf, goals, sampleAvailable }) => {
          const value = goals.reduce((sum, goal) => sum + goal.value, 0);
          const target = goals.reduce((sum, goal) => sum + goal.target, 0);
          return (
            <>
              <h1 className="title">Goals</h1>
              {goals.length > 0 ? (
                <>
                  <p className="unit">
                    Value at the end of {asOf.slice(0, 7)}. Targets in{" "}
                    <TermPopover term="real">today’s euros</TermPopover>.
                  </p>
                  <h2 className="exhibit-title">
                    {`${goals.length} ${goals.length === 1 ? "goal holds" : "goals hold"} ${formatAmount(value)} against ${formatAmount(target)} of targets`}
                  </h2>
                </>
              ) : null}

              {goals.length === 0 ? (
                sampleAvailable ? (
                  <SampleCard onLoaded={list.reload} />
                ) : (
                  <Card title="Goals">
                    <p className="note">
                      There are no goals. Add one in <a href="#/setup/goals">Setup</a>.
                    </p>
                  </Card>
                )
              ) : (
                <Card title="Goals">
                  <GoalsTable goals={goals} gapOf={gapOf} />
                </Card>
              )}
            </>
          );
        }}
      </Resource>
    </>
  );
}

/** The Goals table. Narrow cards drop columns by priority (goals.css), so a row stays on one line without a scroll. */
export function GoalsTable({
  goals,
  gapOf,
}: {
  goals: GoalListView["goals"];
  gapOf: (goalId: string) => number | undefined;
}) {
  return (
    <div className="table-scroll goals-table">
      <table className="table">
        <thead>
          <tr>
            <th>Goal</th>
            <th className="col-opt-1">
              <TermPopover term="need">Priority</TermPopover>
            </th>
            <th>Status</th>
            <th>
              <TermPopover term="prob">P</TermPopover> vs{" "}
              <TermPopover term="required">required</TermPopover>
            </th>
            <th className="num">Value</th>
            <th className="num col-opt-1">Target</th>
            <th>Value vs target</th>
            <th className="num col-opt-2">Plan gap</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((goal) => {
            const share = goal.target > 0 ? goal.value / goal.target : undefined;
            const gap = gapOf(goal.id);
            return (
              <tr key={goal.id}>
                <td>
                  <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
                </td>
                <td className="col-opt-1">
                  <PriorityTag priority={goal.priority} />
                </td>
                <td>{goal.outlook ? <StatusChip status={goal.outlook.status} /> : "–"}</td>
                <td>
                  {goal.outlook ? pVsRequired(goal.outlook.pSuccess, goal.outlook.requiredP) : "–"}
                </td>
                <td className="num">
                  {formatAmount(goal.value)}
                  {goal.missingPrices ? (
                    <span className="sub-line"> A price is missing.</span>
                  ) : null}
                </td>
                <td className="num col-opt-1">{formatAmount(goal.target)}</td>
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
                <td className="num col-opt-2">
                  {gap === undefined ? (
                    MISSING
                  ) : (
                    <>
                      {formatEuro(gap)}
                      <span className="sub-line"> {gapText(gap)}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
