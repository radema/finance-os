import { useEffect, useState } from "react";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import type { Commission, CorrelationsView, Goal, Settings } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { centsToEuros, eurosToCents, fractionToPercent, num, percentToFraction } from "../forms.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  NumberField,
  Resource,
  SelectField,
  TextField,
} from "./ui.tsx";

type Values = Record<string, string>;

const settingsToValues = (s: Settings): Values => ({
  inflation: fractionToPercent(s.inflation),
  taxStd: fractionToPercent(s.taxStd),
  taxGovt: fractionToPercent(s.taxGovt),
  bollo: fractionToPercent(s.bollo),
  pensionTax: fractionToPercent(s.pensionTax),
  need: fractionToPercent(s.requiredProb.need),
  want: fractionToPercent(s.requiredProb.want),
  wish: fractionToPercent(s.requiredProb.wish),
  mcPaths: String(s.mcPaths),
  seed: String(s.seed),
  trackingStart: s.trackingStart,
  zainettoAmount: centsToEuros(s.zainetto.amountCents),
  zainettoExpiry: String(s.zainetto.expiry),
  zainettoGoal: s.zainetto.goalId ?? "",
  pensionCap: centsToEuros(s.pensionDeductionCapCents),
  r1Months: String(s.thresholds.r1Months),
  r3Months: String(s.thresholds.r3Months),
  r7Multiple: String(s.thresholds.r7Multiple),
  statusBand: String(s.thresholds.statusBandPoints),
  priceAge: String(s.thresholds.dailyPriceAgeDays),
});

const valuesToSettings = (v: Values): Settings => ({
  inflation: percentToFraction(v.inflation ?? ""),
  taxStd: percentToFraction(v.taxStd ?? ""),
  taxGovt: percentToFraction(v.taxGovt ?? ""),
  bollo: percentToFraction(v.bollo ?? ""),
  pensionTax: percentToFraction(v.pensionTax ?? ""),
  requiredProb: {
    need: percentToFraction(v.need ?? ""),
    want: percentToFraction(v.want ?? ""),
    wish: percentToFraction(v.wish ?? ""),
  },
  mcPaths: num(v.mcPaths ?? ""),
  seed: num(v.seed ?? ""),
  trackingStart: v.trackingStart ?? "",
  zainetto: {
    amountCents: eurosToCents(v.zainettoAmount ?? ""),
    expiry: num(v.zainettoExpiry ?? ""),
    goalId: v.zainettoGoal ? (v.zainettoGoal as string) : null,
  },
  pensionDeductionCapCents: eurosToCents(v.pensionCap ?? ""),
  thresholds: {
    r1Months: num(v.r1Months ?? ""),
    r3Months: num(v.r3Months ?? ""),
    r7Multiple: num(v.r7Multiple ?? ""),
    statusBandPoints: num(v.statusBand ?? ""),
    dailyPriceAgeDays: num(v.priceAge ?? ""),
  },
});

const commissionToValues = (c: Commission): Values => ({
  plan: c.plan,
  feeModel: c.feeModel,
  rate: fractionToPercent(c.rate),
  min: centsToEuros(c.minCents),
  max: centsToEuros(c.maxCents),
  flatFee: centsToEuros(c.flatFeeCents),
  minTicket: centsToEuros(c.minTicketCents),
});

const valuesToCommission = (v: Values): Commission => ({
  plan: v.plan ?? "",
  feeModel: v.feeModel as Commission["feeModel"],
  rate: percentToFraction(v.rate ?? ""),
  minCents: eurosToCents(v.min ?? ""),
  maxCents: eurosToCents(v.max ?? ""),
  flatFeeCents: eurosToCents(v.flatFee ?? ""),
  minTicketCents: eurosToCents(v.minTicket ?? ""),
});

/** A form over a document: text values, a save button and its own error. */
function useDocumentForm<T>(
  path: string,
  data: T,
  toValues: (data: T) => Values,
  fromValues: (values: Values) => T,
) {
  const [values, setValues] = useState<Values>(() => toValues(data));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  // A reset or a reload replaces the document: show it.
  useEffect(() => {
    setValues(toValues(data));
  }, [data, toValues]);

  return {
    values,
    error,
    saved,
    set: (key: string) => (value: string) => {
      setValues((current) => ({ ...current, [key]: value }));
      setSaved(false);
    },
    save: async () => {
      try {
        await api("PUT", path, { body: fromValues(values) });
        setError(undefined);
        setSaved(true);
      } catch (failure) {
        setError(messageOf(failure));
        setSaved(false);
      }
    },
  };
}

function SettingsForm({ settings, goals }: { settings: Settings; goals: Goal[] }) {
  const form = useDocumentForm("/api/settings", settings, settingsToValues, valuesToSettings);
  const { values, set } = form;
  const field = (key: string, label: string, hint?: string, step?: string) => (
    <NumberField
      label={label}
      value={values[key] ?? ""}
      onChange={set(key)}
      hint={hint}
      step={step}
    />
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.save();
      }}
    >
      <Card title="Taxes and economy">
        <div className="form-grid">
          {field("inflation", "Inflation (% a year)", "Not in the spec: the mock's 2%.")}
          {field("taxStd", "Tax on ETF gains and direct holdings (%)")}
          {field("taxGovt", "Tax on government bonds (%)")}
          {field("bollo", "Stamp duty, bollo (% a year)")}
          {field("pensionTax", "Tax on pension returns (%)")}
          {field("pensionCap", "Pension deduction cap (EUR)", undefined, "0.01")}
        </div>
      </Card>
      <Card title="Probabilities and simulation">
        <div className="form-grid">
          {field("need", "Required probability: Need (%)")}
          {field("want", "Required probability: Want (%)")}
          {field("wish", "Required probability: Wish (%)")}
          {field("mcPaths", "Monte Carlo paths", undefined, "1")}
          {field("seed", "Random seed", "Not in the spec: the mock's 42.", "1")}
          <TextField
            label="Tracking starts (YYYY-MM)"
            value={values.trackingStart ?? ""}
            onChange={set("trackingStart")}
          />
        </div>
      </Card>
      <Card title="Tax-loss credit (zainetto)">
        <div className="form-grid">
          {field("zainettoAmount", "Amount (EUR)", undefined, "0.01")}
          {field("zainettoExpiry", "Expires in year", undefined, "1")}
          <SelectField
            label="Assigned to goal"
            value={values.zainettoGoal ?? ""}
            onChange={set("zainettoGoal")}
            options={[
              { value: "", label: "None" },
              ...goals.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </div>
      </Card>
      <Card title="Rule thresholds">
        <div className="form-grid">
          {field("r1Months", "R1: months", undefined, "1")}
          {field("r3Months", "R3: months", undefined, "1")}
          {field("r7Multiple", "R7: multiple")}
          {field("statusBand", "Status band (points)")}
          {field("priceAge", "Daily price age (days)", undefined, "1")}
        </div>
      </Card>
      <div className="actions">
        <button className="btn btn-primary" type="submit">
          Save settings
        </button>
        {form.saved ? <span className="saved">Saved.</span> : null}
      </div>
      <Alert message={form.error} />
    </form>
  );
}

function CommissionForm({ commission }: { commission: Commission }) {
  const form = useDocumentForm(
    "/api/commission",
    commission,
    commissionToValues,
    valuesToCommission,
  );
  const { values, set } = form;
  const flat = values.feeModel === "flat";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.save();
      }}
    >
      <Card
        title="Commission plan"
        note="Percent: the fee is the rate times the amount, between the minimum and the maximum. Flat: one fee for every trade."
      >
        <div className="form-grid">
          <TextField label="Plan name" value={values.plan ?? ""} onChange={set("plan")} />
          <SelectField
            label="Fee model"
            value={values.feeModel ?? "percent"}
            onChange={set("feeModel")}
            options={[
              { value: "percent", label: "Percent" },
              { value: "flat", label: "Flat" },
            ]}
          />
          {flat ? (
            <>
              <NumberField
                label="Flat fee (EUR)"
                value={values.flatFee ?? ""}
                onChange={set("flatFee")}
                step="0.01"
              />
              <NumberField
                label="Minimum efficient ticket (EUR)"
                value={values.minTicket ?? ""}
                onChange={set("minTicket")}
                step="0.01"
              />
            </>
          ) : (
            <>
              <NumberField label="Rate (%)" value={values.rate ?? ""} onChange={set("rate")} />
              <NumberField
                label="Minimum fee (EUR)"
                value={values.min ?? ""}
                onChange={set("min")}
                step="0.01"
              />
              <NumberField
                label="Maximum fee (EUR)"
                value={values.max ?? ""}
                onChange={set("max")}
                step="0.01"
              />
            </>
          )}
        </div>
        <div className="actions">
          <button className="btn btn-primary" type="submit">
            Save commission plan
          </button>
          {form.saved ? <span className="saved">Saved.</span> : null}
        </div>
        <Alert message={form.error} />
      </Card>
    </form>
  );
}

function CorrelationsForm({ view }: { view: CorrelationsView }) {
  const [matrix, setMatrix] = useState(view.matrix);
  const [shrunk, setShrunk] = useState(view.shrunk);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setMatrix(view.matrix);
    setShrunk(view.shrunk);
  }, [view]);

  // The cell below the diagonal is the input; the cell above mirrors it, so the matrix stays symmetric.
  const edit = (i: number, j: number, text: string) => {
    const value = num(text);
    setMatrix(
      matrix.map((row, r) =>
        row.map((cell, c) => ((r === i && c === j) || (r === j && c === i) ? value : cell)),
      ),
    );
    setSaved(false);
  };
  const save = async () => {
    try {
      const result = await api<CorrelationsView>("PUT", "/api/correlations", { body: { matrix } });
      setMatrix(result.matrix);
      setShrunk(result.shrunk);
      setError(undefined);
      setSaved(true);
    } catch (failure) {
      setError(messageOf(failure));
      setSaved(false);
    }
  };

  return (
    <Card
      title="Correlations"
      note="Between the six asset classes. Edit the cells below the diagonal; the others follow. The diagonal is always 1."
    >
      <div className="table-scroll">
        <table className="table matrix">
          <thead>
            <tr>
              <th />
              {ASSET_CLASSES.map((name) => (
                <th key={name} className="num">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ASSET_CLASSES.map((rowName, i) => (
              <tr key={rowName}>
                <th scope="row">{rowName}</th>
                {ASSET_CLASSES.map((colName, j) => (
                  <td key={colName} className="num">
                    {j < i ? (
                      <input
                        className="inline-input"
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        aria-label={`Correlation ${rowName} and ${colName}`}
                        value={Number.isNaN(matrix[i]?.[j]) ? "" : (matrix[i]?.[j] ?? "")}
                        onChange={(event) => edit(i, j, event.target.value)}
                      />
                    ) : (
                      (matrix[i]?.[j] ?? 0)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shrunk ? (
        <p className="flag" role="status">
          This matrix is not positive definite. The simulation will use a shrunk copy, with every
          off-diagonal multiplied by 0.9 until it works.
        </p>
      ) : null}
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={() => void save()}>
          Save correlations
        </button>
        {saved ? <span className="saved">Saved.</span> : null}
      </div>
      <Alert message={error} />
    </Card>
  );
}

export function AssumptionsTab() {
  const settings = useLoad<Settings>("/api/settings");
  const commission = useLoad<Commission>("/api/commission");
  const correlations = useLoad<CorrelationsView>("/api/correlations");
  const goals = useLoad<Goal[]>("/api/goals");
  const [error, setError] = useState<string>();

  const reset = async () => {
    try {
      const defaults = await api<{
        settings: Settings;
        commission: Commission;
        correlations: CorrelationsView;
      }>("POST", "/api/assumptions/reset", { body: {} });
      settings.set(defaults.settings);
      commission.set(defaults.commission);
      correlations.set(defaults.correlations);
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <Resource loaded={settings}>
      {(s) => (
        <Resource loaded={commission}>
          {(c) => (
            <Resource loaded={correlations}>
              {(k) => (
                <Resource loaded={goals}>
                  {(g) => (
                    <>
                      <SettingsForm settings={s} goals={g} />
                      <CommissionForm commission={c} />
                      <CorrelationsForm view={k} />
                      <Card
                        title="Reset"
                        note="Restores the default assumptions. Products, goals and transactions stay as they are."
                      >
                        <ConfirmButton
                          label="Reset assumptions"
                          confirmLabel="Reset to defaults"
                          onConfirm={() => void reset()}
                        />
                        <Alert message={error} />
                      </Card>
                    </>
                  )}
                </Resource>
              )}
            </Resource>
          )}
        </Resource>
      )}
    </Resource>
  );
}
