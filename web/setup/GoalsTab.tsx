import { useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import type { Goal, GoalInput } from "../../engine/schemas.ts";
import { PRIORITIES } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { checkFields, type Rule } from "../formErrors.ts";
import { centsToEuros, eurosToCents, fractionToPercent, percentToFraction } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { currentMonth, formatEuro, formatPercent } from "../money.ts";
import { copyOfGoal } from "./duplicate.ts";
import { fromMonthInForce, monthlyInForce, valuationMonth } from "./goalPlan.ts";
import { useRevealForm } from "./revealForm.ts";
import {
  Alert,
  Card,
  CheckField,
  ConfirmButton,
  NumberField,
  PriorityTag,
  RequiredLegend,
  Resource,
  SelectField,
  TextField,
} from "./ui.tsx";
import { useFormErrors } from "./useFormErrors.ts";

interface Form {
  name: string;
  priority: string;
  target: string;
  targetYear: string;
  contributionGrowth: string;
  minProb: string;
  countsTowardFi: boolean;
  monthly: string;
  fromMonth: string;
}

const emptyForm = (): Form => ({
  name: "",
  priority: "Need",
  target: "",
  targetYear: String(new Date().getFullYear() + 5),
  contributionGrowth: "2",
  minProb: "",
  countsTowardFi: false,
  monthly: "",
  fromMonth: currentMonth(),
});

const LABELS = {
  name: "Name",
  target: "Target",
  targetYear: "Target year",
  contributionGrowth: "Yearly growth",
  minProb: "Required probability",
  monthly: "Monthly amount",
  fromMonth: "Plan start",
};
type FormKey = keyof typeof LABELS;
// The API names these in cents; the form holds euros.
const API_KEYS: Record<string, FormKey> = { targetCents: "target", monthlyCents: "monthly" };

const rulesOf = (editing: boolean): Partial<Record<FormKey, Rule>> => ({
  name: "text",
  target: "number",
  targetYear: "number",
  contributionGrowth: "number",
  minProb: "optionalNumber",
  ...(editing ? {} : { monthly: "optionalNumber" as const }),
});

const toForm = (g: Goal): Form => ({
  name: g.name,
  priority: g.priority,
  target: centsToEuros(g.targetCents),
  targetYear: String(g.targetYear),
  contributionGrowth: fractionToPercent(g.contributionGrowth),
  minProb: g.minProb === null ? "" : fractionToPercent(g.minProb),
  countsTowardFi: g.countsTowardFi,
  monthly: "",
  fromMonth: currentMonth(),
});

const toInput = (f: Form): GoalInput => ({
  name: f.name,
  priority: f.priority as GoalInput["priority"],
  targetCents: eurosToCents(f.target),
  targetYear: f.targetYear.trim() === "" ? Number.NaN : Number(f.targetYear),
  contributionGrowth: percentToFraction(f.contributionGrowth),
  minProb: f.minProb.trim() === "" ? null : percentToFraction(f.minProb),
  countsTowardFi: f.countsTowardFi,
});

function PlanHistory({
  goal,
  month,
  reload,
}: {
  goal: Goal;
  /** The valuation month: the plan in force is the one for this month. */
  month: string | undefined;
  reload: () => void;
}) {
  const [fromMonth, setFromMonth] = useState(currentMonth());
  const [monthly, setMonthly] = useState("");
  const [error, setError] = useState<string>();
  const inForce = month === undefined ? undefined : fromMonthInForce(goal.plan, month);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(undefined);
      reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <Card
      title={`Plan history: ${goal.name}`}
      note="The plan in force for a month is the version with the latest start month up to that month."
    >
      {goal.plan.length === 0 ? (
        <p className="note">No plan yet: the monthly amount is 0. Add a version below.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>From month</th>
              <th className="num">Monthly</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {goal.plan.map((version) => (
              <tr key={version.fromMonth}>
                <td>
                  {version.fromMonth}
                  {version.fromMonth === inForce ? (
                    <span className="sub"> in force now</span>
                  ) : null}
                </td>
                <td className="num">{formatEuro(version.monthlyCents)}</td>
                <td className="row-actions">
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete version"
                    onConfirm={() =>
                      void run(() =>
                        api("DELETE", "/api/goal-plan", {
                          query: { goalId: goal.id, fromMonth: version.fromMonth },
                        }),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <RequiredLegend />
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api("PUT", "/api/goal-plan", {
              body: { goalId: goal.id, fromMonth, monthlyCents: eurosToCents(monthly) },
            });
            setMonthly("");
          });
        }}
      >
        <TextField
          label="New amount from month (YYYY-MM)"
          value={fromMonth}
          onChange={setFromMonth}
          required
        />
        <NumberField
          label="New monthly amount (EUR)"
          value={monthly}
          onChange={setMonthly}
          required
        />
        <button className="btn btn-primary" type="submit">
          Save plan version
        </button>
      </form>
      <Alert message={error} />
    </Card>
  );
}

export function GoalsTab() {
  const goals = useLoad<Goal[]>("/api/goals");
  const valuation = useLoad<GoalListView>("/api/goal-list");
  const [form, setForm] = useState<Form>(emptyForm);
  const [editing, setEditing] = useState<string>();
  const [copying, setCopying] = useState(false);
  const [selected, setSelected] = useState<string>();
  const { errors, alert, reject, fail, clear } = useFormErrors<FormKey>(LABELS, API_KEYS);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm({ ...form, [key]: value });
    clear(key as FormKey);
  };
  const { formRef, reveal } = useRevealForm();

  const reset = () => {
    setForm(emptyForm());
    setEditing(undefined);
    setCopying(false);
  };
  const save = async () => {
    const rules = rulesOf(editing !== undefined);
    const problems = checkFields(form, rules, LABELS);
    if (Object.keys(problems).length > 0) return reject(problems);
    try {
      const body = toInput(form);
      if (editing) {
        await api("PUT", "/api/goals", { body: { id: editing, ...body } });
      } else {
        const created = await api<Goal>("POST", "/api/goals", { body });
        if (form.monthly.trim() !== "") {
          await api("PUT", "/api/goal-plan", {
            body: {
              goalId: created.id,
              fromMonth: form.fromMonth,
              monthlyCents: eurosToCents(form.monthly),
            },
          });
        }
        setSelected(created.id);
      }
      clear();
      reset();
      goals.reload();
    } catch (failure) {
      fail(failure);
    }
  };
  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/goals", { query: { id } });
      clear();
      if (editing === id) reset();
      if (selected === id) setSelected(undefined);
      goals.reload();
    } catch (failure) {
      fail(failure);
    }
  };

  const month = valuation.data ? valuationMonth(valuation.data.asOf) : undefined;
  // A copy keeps the plan: its monthly amount in force becomes the first version of the new goal.
  const monthlyText = (g: Goal) => {
    const cents = month === undefined ? 0 : monthlyInForce(g.plan, month);
    return cents > 0 ? centsToEuros(cents) : "";
  };
  return (
    <>
      <Card title={editing ? "Edit goal" : "Add goal"}>
        <RequiredLegend />
        <form
          ref={formRef}
          className="form-grid"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextField
            label="Name"
            value={form.name}
            onChange={(v) => set("name", v)}
            error={errors.name}
            required
          />
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(v) => set("priority", v)}
            options={PRIORITIES.map((value) => ({ value, label: value }))}
          />
          <NumberField
            label={
              <>
                Target in <TermPopover term="real">today’s euros</TermPopover> (EUR)
              </>
            }
            value={form.target}
            onChange={(v) => set("target", v)}
            error={errors.target}
            required
          />
          <TextField
            label="Target year"
            value={form.targetYear}
            onChange={(v) => set("targetYear", v)}
            error={errors.targetYear}
            hint="Due on 31 December of this year."
            required
          />
          <NumberField
            label="Yearly growth of the contribution (%)"
            value={form.contributionGrowth}
            onChange={(v) => set("contributionGrowth", v)}
            error={errors.contributionGrowth}
            required
          />
          <NumberField
            label={
              <>
                <TermPopover term="required">Required probability</TermPopover> (%)
              </>
            }
            value={form.minProb}
            onChange={(v) => set("minProb", v)}
            error={errors.minProb}
            hint="Empty: use the default for the priority."
          />
          {editing ? null : (
            <>
              <NumberField
                label="Monthly amount (EUR)"
                value={form.monthly}
                onChange={(v) => set("monthly", v)}
                error={errors.monthly}
                hint="Optional. Change it later on the plan history."
              />
              <TextField
                label="Plan starts (YYYY-MM)"
                value={form.fromMonth}
                onChange={(v) => set("fromMonth", v)}
                error={errors.fromMonth}
              />
            </>
          )}
          <CheckField
            label="Counts towards financial independence"
            checked={form.countsTowardFi}
            onChange={(v) => set("countsTowardFi", v)}
          />
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              {editing ? "Save goal" : "Add goal"}
            </button>
            {editing || copying ? (
              <button className="btn btn-quiet" type="button" onClick={reset}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <Alert message={alert} />
      </Card>

      <Card title="Goals">
        <Resource loaded={goals}>
          {(list) =>
            list.length === 0 ? (
              <p className="note">No goals yet. Add the first one above.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Priority</th>
                    <th className="num">Target</th>
                    <th className="num">Year</th>
                    <th className="num">Monthly now</th>
                    <th className="num">Growth</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((g) => (
                    <tr key={g.id}>
                      <td>{g.name}</td>
                      <td>
                        <PriorityTag priority={g.priority} />
                      </td>
                      <td className="num">{formatEuro(g.targetCents)}</td>
                      <td className="num">{g.targetYear}</td>
                      <td className="num">
                        {month === undefined ? "" : formatEuro(monthlyInForce(g.plan, month))}
                      </td>
                      <td className="num">{formatPercent(g.contributionGrowth)}</td>
                      <td className="row-actions">
                        <button
                          className="btn btn-quiet"
                          type="button"
                          onClick={() => setSelected(g.id)}
                        >
                          Plan
                        </button>
                        <button
                          className="btn btn-quiet"
                          type="button"
                          onClick={() => {
                            setEditing(g.id);
                            setCopying(false);
                            setForm(toForm(g));
                            clear();
                            reveal();
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-quiet"
                          type="button"
                          onClick={() => {
                            setEditing(undefined);
                            setCopying(true);
                            setForm({ ...toForm(copyOfGoal(g)), monthly: monthlyText(g) });
                            clear();
                            reveal();
                          }}
                        >
                          Duplicate
                        </button>
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete goal"
                          onConfirm={() => void remove(g.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Resource>
      </Card>

      {goals.data?.find((g) => g.id === selected) ? (
        <PlanHistory
          key={selected}
          month={month}
          goal={goals.data.find((g) => g.id === selected) as Goal}
          reload={goals.reload}
        />
      ) : null}
    </>
  );
}
