import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import type { PensionThisYear, PensionView, PensionYearView } from "../../engine/pensionView.ts";
import type { PensionFlow } from "../../engine/schemas.ts";
import { GREY_SLOT } from "../../engine/slots.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { GoalChip } from "../goals/GoalChip.tsx";
import { formatAmount, formatPercent } from "../money.ts";
import {
  Alert,
  Card,
  NumberField,
  PriorityTag,
  RequiredLegend,
  Resource,
  SelectField,
} from "../setup/ui.tsx";
import { CapitalNote } from "./CapitalNote.tsx";
import { flowKey, isPlanDirty, type PlanValues, planToValues, valuesToPlan } from "./planForm.ts";
import { ScheduleChart } from "./ScheduleChart.tsx";

const FLOWS: readonly PensionFlow["flow"][] = ["Work", "Voluntary"];
const MISSING = "–";

function Kpi({ label, value, note }: { label: ReactNode; value: string; note?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note ? <p className="sub">{note}</p> : null}
    </div>
  );
}

function ThisYear({ year }: { year: PensionThisYear }) {
  // `used` counts the voluntary so far; the non-deducted part is the schedule's figure for the year.
  const overLimit = year.used > year.cap + year.extra;
  return (
    <>
      <div className="kpis">
        <Kpi
          label={`Cap ${year.year}`}
          value={formatAmount(year.cap)}
          note={`Plus ${formatAmount(year.extra)} of extra deduction.`}
        />
        <Kpi
          label="Used"
          value={formatAmount(year.used)}
          note={`Worker and employer for the year, plus ${formatAmount(year.voluntaryYtd)} of voluntary so far.`}
        />
        <Kpi
          label="Still available"
          value={formatAmount(year.available)}
          note="Cap plus extra, minus used."
        />
        <Kpi
          label="Refund"
          value={formatAmount(year.refund)}
          note={`Paid in ${year.refundYear}, at your marginal rate.`}
        />
        <Kpi
          label={<TermPopover term="exitTax">Exit tax</TermPopover>}
          value={year.exitTax === null ? MISSING : formatAmount(year.exitTax)}
          note={
            year.exitRate === null || year.exitTaxYear === null
              ? "Not available: the pension goal or a price is missing."
              : `At 31 December ${year.exitTaxYear}: ${formatPercent(year.exitRate)} of your contributions minus the non-deducted part.`
          }
        />
      </div>
      {overLimit ? (
        <p className="note" data-testid="non-deducted">
          {formatAmount(year.nonDeducted)} of this year's payments are not tax-deductible.
        </p>
      ) : null}
    </>
  );
}

function PlanForm({ view, onSaved }: { view: PensionView; onSaved: () => void }) {
  const productIds = view.pensionProducts.map((product) => product.id);
  const storedValues = () => (view.plan ? planToValues(view.plan, view.goals[0]?.id ?? "") : null);
  const [values, setValues] = useState<PlanValues>(() =>
    planToValues(view.plan, view.goals[0]?.id ?? ""),
  );
  // What is saved, as the form's text: edits are compared with it.
  const [savedValues, setSavedValues] = useState<PlanValues | null>(storedValues);
  const [error, setError] = useState<string>();
  // A reload replaces the stored plan: show it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new stored plan resets the form
  useEffect(() => {
    setValues(planToValues(view.plan, view.goals[0]?.id ?? ""));
    setSavedValues(storedValues());
  }, [view.plan]);

  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const field = (
    key: string,
    label: string,
    unit?: string,
    hint?: string,
    step?: string,
    required = true,
  ) => (
    <NumberField
      label={label}
      value={values[key] ?? ""}
      onChange={set(key)}
      unit={unit}
      hint={hint}
      step={step}
      required={required}
    />
  );
  const save = async () => {
    try {
      await api("PUT", "/api/pension-plan", { body: valuesToPlan(values, productIds) });
      setError(undefined);
      setSavedValues(values);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Card title="Pension plan">
        <h3 className="form-section">Inputs</h3>
        <RequiredLegend />
        <div className="form-grid form-grid-hints">
          <SelectField
            label="Pension goal"
            value={values.goalId ?? ""}
            onChange={set("goalId")}
            options={view.goals.map((goal) => ({ value: goal.id, label: goal.name }))}
          />
          {field("firstYear", "First year of membership", undefined, undefined, "1")}
          {field("ral", "RAL a year", "€", "Blank: no schedule.", "0.01", false)}
          {field("ralGrowth", "RAL growth a year", "%")}
          {field("tfrPct", "TFR share of RAL", "%")}
          {field("workerPct", "Worker share of RAL", "%")}
          {field("employerPct", "Employer share of RAL", "%")}
          {field("voluntary", "Voluntary a year", "€", "Blank: up to the cap.", "0.01", false)}
          {field("marginalRate", "Marginal tax rate", "%")}
          {field("extra", "Extra deduction a year", "€", undefined, "0.01")}
        </div>
        <h3 className="form-section">Flows</h3>
        <p className="note">
          Each flow is split between your pension funds by these shares. Work is TFR, worker and
          employer; Voluntary is the rest. A blank share is no flow.
        </p>
        {view.pensionProducts.length === 0 ? (
          <p className="note">There is no pension fund yet. Add one in Setup, Products.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  {FLOWS.map((flow) => (
                    <th className="num" key={flow}>
                      {flow} (%)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.pensionProducts.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    {FLOWS.map((flow) => (
                      <td className="num" key={flow}>
                        <input
                          className="flow-input"
                          type="number"
                          step="any"
                          placeholder="0"
                          aria-label={`${product.name}, ${flow} flow (%)`}
                          value={values[flowKey(flow, product.id)] ?? ""}
                          onChange={(event) => set(flowKey(flow, product.id))(event.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Alert message={error} />
        <div className="actions">
          <button className="btn btn-primary" type="submit">
            Save pension plan
          </button>
          <span className="saved" role="status">
            {isPlanDirty(values, savedValues) ? "Unsaved changes" : "Saved"}
          </span>
        </div>
      </Card>
    </form>
  );
}

function Schedule({ rows, slot }: { rows: PensionYearView[]; slot: number }) {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;
  const total = (row: PensionYearView) => row.tfr + row.worker + row.employer + row.voluntary;
  return (
    <>
      <figure className="exhibit">
        <div className="tag">Contributions</div>
        <h2 className="exhibit-title">
          {`Pension contributions go from ${formatAmount(total(first))} in ${first.year} to ${formatAmount(total(last))} in ${last.year}`}
        </h2>
        <p className="unit">Euros a year. {first.year} is the full-year schedule.</p>
        <ul className="legend">
          <li>
            <span className="swatch swatch-work" />
            Work: TFR, worker, employer
          </li>
          <li>
            <span className="swatch swatch-voluntary" />
            Voluntary
          </li>
        </ul>
        <ScheduleChart
          rows={rows}
          slot={slot}
          label={`Yearly pension contributions, Work and Voluntary, from ${first.year} to ${last.year}`}
        />
        <figcaption className="source">
          Source: your pension plan and the deduction cap in Setup, Assumptions.
        </figcaption>
      </figure>
      <Card title="10-year schedule">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">RAL</th>
                <th className="num">TFR</th>
                <th className="num">Worker</th>
                <th className="num">Employer</th>
                <th className="num">Voluntary</th>
                <th className="num">Deductible</th>
                <th className="num">Refund</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td className="num">{formatAmount(row.ral)}</td>
                  <td className="num">{formatAmount(row.tfr)}</td>
                  <td className="num">{formatAmount(row.worker)}</td>
                  <td className="num">{formatAmount(row.employer)}</td>
                  <td className="num">{formatAmount(row.voluntary)}</td>
                  <td className="num">{formatAmount(row.deductible)}</td>
                  <td className="num">{formatAmount(row.refund)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          Euros. TFR is outside the deduction cap. A refund is paid in the year after it is earned.
        </p>
      </Card>
    </>
  );
}

function Pension({ view, onSaved }: { view: PensionView; onSaved: () => void }) {
  const goal = view.goals.find((candidate) => candidate.id === view.plan?.goalId);
  const slot = goal?.slot ?? GREY_SLOT;
  return (
    <div style={{ "--slot": `var(--slot${slot})` } as CSSProperties}>
      <div className="tag">Pension</div>
      <h1 className="title">Pension</h1>
      <p className="unit">
        {goal ? (
          <>
            <GoalChip id={goal.id} name={goal.name} slot={slot} />{" "}
            <PriorityTag priority={goal.priority} />{" "}
          </>
        ) : null}
        {view.plan
          ? `Euros. Values at the end of ${view.asOf.slice(0, 7)}.${view.thisYear ? "" : " Add your RAL to see the pension schedule."}`
          : "No pension plan yet. Fill in the inputs below to plan your pension fund. Nothing is saved until you press Save."}
      </p>
      {view.thisYear ? (
        <>
          <h2 className="exhibit-title">
            {`You can still deduct ${formatAmount(view.thisYear.available)} in ${view.thisYear.year}`}
          </h2>
          <ThisYear year={view.thisYear} />
        </>
      ) : null}
      <PlanForm view={view} onSaved={onSaved} />
      <Schedule rows={view.schedule} slot={slot} />
      <CapitalNote />
    </div>
  );
}

/** The Pension screen: this year's deduction room, the plan inputs and flows, the 10-year schedule. */
export function PensionScreen() {
  const loaded = useLoad<PensionView>("/api/pension-view");
  return (
    <Resource loaded={loaded}>{(view) => <Pension view={view} onSaved={loaded.reload} />}</Resource>
  );
}
