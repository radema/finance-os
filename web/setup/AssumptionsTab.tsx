import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import type { Commission, CorrelationsView, Goal, Settings } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { centsToEuros, eurosToCents, fractionToPercent, num, percentToFraction } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { DataCard } from "./DataCard.tsx";
import {
  Alert,
  Card,
  ConfirmButton,
  DecimalInput,
  NumberField,
  RequiredLegend,
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

export function SettingsForm({ settings, goals }: { settings: Settings; goals: Goal[] }) {
  const form = useDocumentForm("/api/settings", settings, settingsToValues, valuesToSettings);
  const { values, set } = form;
  const field = (key: string, label: ReactNode, hint?: string) => (
    <NumberField label={label} value={values[key] ?? ""} onChange={set(key)} hint={hint} required />
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.save();
      }}
    >
      <Card title="Taxes and economy">
        <RequiredLegend />
        <div className="form-grid">
          {field(
            "inflation",
            "Inflation (% a year)",
            "Used to turn today's euros into future euros.",
          )}
          {field("taxStd", "Tax on ETF gains and direct holdings (%)")}
          {field("taxGovt", "Tax on government bonds (%)")}
          {field(
            "bollo",
            <>
              <TermPopover term="bollo">Stamp duty, bollo</TermPopover> (% a year)
            </>,
          )}
          {field("pensionTax", "Tax on pension returns (%)")}
          {field("pensionCap", "Pension deduction cap (EUR)")}
        </div>
      </Card>
      <Card title="Probabilities and simulation">
        <div className="form-grid">
          {field(
            "need",
            <>
              <TermPopover term="required">Required probability</TermPopover>: Need (%)
            </>,
          )}
          {field(
            "want",
            <>
              <TermPopover term="required">Required probability</TermPopover>: Want (%)
            </>,
          )}
          {field(
            "wish",
            <>
              <TermPopover term="required">Required probability</TermPopover>: Wish (%)
            </>,
          )}
          {field(
            "mcPaths",
            <>
              <TermPopover term="simulated">Monte Carlo</TermPopover> paths
            </>,
          )}
          {field("seed", "Random seed", "The same seed gives the same simulated results.")}
          <TextField
            label="Tracking starts (YYYY-MM)"
            value={values.trackingStart ?? ""}
            onChange={set("trackingStart")}
            required
          />
        </div>
      </Card>
      <Card
        memoryKey="Tax-loss credit"
        title={
          <>
            Tax-loss credit (<TermPopover term="zainetto">zainetto</TermPopover>)
          </>
        }
      >
        <div className="form-grid">
          {field("zainettoAmount", "Amount (EUR)")}
          {field("zainettoExpiry", "Expires in year")}
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
          {field(
            "r1Months",
            "Behind plan: alert after (months)",
            "Alert when your saving is behind plan by this many months of contributions.",
          )}
          {field(
            "r3Months",
            "Maturity ahead: warn within (months)",
            "Warn when a product you hold matures within this many months.",
          )}
          {field(
            "r7Multiple",
            "Costly trades: alert above (times your fee rate)",
            "Alert when a trade of the last 12 months costs more than this many times your fee rate.",
          )}
          {field(
            "statusBand",
            <>
              <TermPopover term="atrisk">At-risk band</TermPopover> (points below the required
              probability)
            </>,
            "A goal this close below its required probability is At risk. Further below is Off track.",
          )}
          {field(
            "priceAge",
            "Price counts as old after (days)",
            "An online price older than this is marked old.",
          )}
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
        <RequiredLegend />
        <div className="form-grid">
          <TextField label="Plan name" value={values.plan ?? ""} onChange={set("plan")} required />
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
                required
              />
              <NumberField
                label={
                  <>
                    <TermPopover term="minticket">Minimum efficient ticket</TermPopover> (EUR)
                  </>
                }
                value={values.minTicket ?? ""}
                onChange={set("minTicket")}
                required
              />
            </>
          ) : (
            <>
              <NumberField
                label="Rate (%)"
                value={values.rate ?? ""}
                onChange={set("rate")}
                required
              />
              <NumberField
                label="Minimum fee (EUR)"
                value={values.min ?? ""}
                onChange={set("min")}
                required
              />
              <NumberField
                label="Maximum fee (EUR)"
                value={values.max ?? ""}
                onChange={set("max")}
                required
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

/** A matrix cell. It keeps the typed text, so a comma that is not yet followed by a digit stays in the box. */
function CorrelationInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (text: string) => void;
}) {
  const [text, setText] = useState(String(value));
  // A value that changed outside the box (a save, a reload) replaces the text; the typed text that reads as the value stays.
  useEffect(() => {
    setText((current) => (Object.is(num(current), value) ? current : String(value)));
  }, [value]);
  return (
    <DecimalInput
      className="inline-input"
      aria-label={label}
      value={text}
      onChange={(next) => {
        setText(next);
        onChange(next);
      }}
    />
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
                      <CorrelationInput
                        label={`Correlation ${rowName} and ${colName}`}
                        value={matrix[i]?.[j] ?? 0}
                        onChange={(text) => edit(i, j, text)}
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

  const reloadAll = () => {
    for (const resource of [settings, commission, correlations, goals]) resource.reload();
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
                      <DataCard onImported={reloadAll} />
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
