import { useState } from "react";
import type { CashFlowView } from "../../engine/cashFlow.ts";
import type { CashFlow, CashFlowEvent } from "../../engine/schemas.ts";
import { api, useLoad } from "../api.ts";
import { checkFields } from "../formErrors.ts";
import { centsToEuros, eurosToCents, num } from "../forms.ts";
import { formatEuro } from "../money.ts";
import { CashFlowTable } from "./CashFlowTable.tsx";
import { hasUnsavedValues, isUnset, savedDocument, toValues, type Values } from "./cashFlowForm.ts";
import { copyOfEvent } from "./duplicate.ts";
import { useRevealForm } from "./revealForm.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  NumberField,
  RequiredLegend,
  Resource,
  SaveStatus,
  TextField,
} from "./ui.tsx";
import { useFormErrors } from "./useFormErrors.ts";

// The two forms of the screen share one document, so one failed save can name a field of either.
const LABELS = {
  income: "Net household income",
  incomeGrowth: "Income growth above inflation",
  essential: "Essential expenses",
  optional: "Optional expenses",
  expenseGrowth: "Expense growth above inflation",
  year: "Year",
  amount: "Amount",
};
type FormKey = keyof typeof LABELS;

type EventForm = { year: string; label: string; amount: string };

function CashFlowScreen({ view, set }: { view: CashFlowView; set: (view: CashFlowView) => void }) {
  const { cashFlow, rows } = view;
  const emptyEvent = (): EventForm => ({
    year: String(rows[0]?.year ?? ""),
    label: "",
    amount: "",
  });
  const [values, setValues] = useState<Values>(() => toValues(cashFlow));
  const [event, setEvent] = useState<EventForm>(emptyEvent);
  const [editing, setEditing] = useState<number>();
  const [copying, setCopying] = useState(false);
  const { errors, alert, reject, fail, clear } = useFormErrors<FormKey>(LABELS);
  const { formRef, reveal } = useRevealForm("form");

  const save = async (body: CashFlow): Promise<boolean> => {
    try {
      set(await api<CashFlowView>("PUT", "/api/cash-flow", { body }));
      clear();
      return true;
    } catch (failure) {
      fail(failure);
      return false;
    }
  };
  // An event change keeps the stored income and expenses: the typed values wait for "Save cash flow".
  const saveEvents = async (events: CashFlowEvent[]) => {
    if (await save({ ...cashFlow, events })) {
      setEvent(emptyEvent());
      setEditing(undefined);
      setCopying(false);
    }
  };
  const submitEvent = () => {
    const problems = checkFields(event, { year: "number", amount: "number" }, LABELS);
    if (Object.keys(problems).length > 0) return reject(problems);
    const next: CashFlowEvent = {
      year: num(event.year),
      label: event.label,
      amount: eurosToCents(event.amount),
    };
    const events = [...cashFlow.events];
    if (editing === undefined) events.push(next);
    else events[editing] = next;
    void saveEvents(events);
  };

  const field = (key: keyof Values, label: string, example: string, hint?: string) => (
    <NumberField
      label={label}
      value={values[key]}
      onChange={(value) => {
        setValues({ ...values, [key]: value });
        clear(key);
      }}
      hint={hint}
      placeholder={`e.g. ${example}`}
      error={errors[key]}
      required
    />
  );
  const listed = cashFlow.events
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => a.year - b.year || a.index - b.index);

  return (
    <>
      <Card
        title="Income and expenses"
        note="Income and expenses grow every year. They also set the financial independence levels."
      >
        <RequiredLegend />
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void save(savedDocument(values, cashFlow.events));
          }}
        >
          {field("income", "Net household income (EUR a year)", "36000")}
          {field(
            "incomeGrowth",
            "Income growth above inflation (% a year)",
            "0",
            "0 means income keeps up with prices.",
          )}
          {field("essential", "Essential expenses (EUR a month)", "1500")}
          {field("optional", "Optional expenses (EUR a month)", "500")}
          {field(
            "expenseGrowth",
            "Expense growth above inflation (% a year)",
            "0",
            "0 means spending keeps up with prices.",
          )}
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              Save cash flow
            </button>
            <SaveStatus unsaved={hasUnsavedValues(values, cashFlow)} />
          </div>
        </form>
      </Card>

      <Card
        title="One-off events"
        note="A year's events count whole: a negative amount is a cost, a positive one is income."
      >
        {listed.length === 0 ? (
          <p className="note">No events yet. Add one below.</p>
        ) : (
          <div className="table-scroll table-scroll-sticky">
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listed.map((e) => (
                  <tr key={e.index}>
                    <td>{e.year}</td>
                    <td>{e.label}</td>
                    <td className="num">{formatEuro(e.amount)}</td>
                    <td className="row-actions">
                      <button
                        className="btn btn-quiet"
                        type="button"
                        onClick={() => {
                          setEditing(e.index);
                          setCopying(false);
                          setEvent({
                            year: String(e.year),
                            label: e.label,
                            amount: centsToEuros(e.amount),
                          });
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
                          const copy = copyOfEvent(e);
                          setEditing(undefined);
                          setCopying(true);
                          setEvent({
                            year: String(copy.year),
                            label: copy.label,
                            amount: centsToEuros(copy.amount),
                          });
                          clear();
                          reveal();
                        }}
                      >
                        Duplicate
                      </button>
                      <ConfirmButton
                        label="Delete"
                        confirmLabel="Delete event"
                        apart
                        onConfirm={() =>
                          void saveEvents(cashFlow.events.filter((_, i) => i !== e.index))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <RequiredLegend />
        <form
          ref={formRef}
          className="inline-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submitEvent();
          }}
        >
          <NumberField
            label="Year"
            value={event.year}
            onChange={(year) => {
              setEvent({ ...event, year });
              clear("year");
            }}
            error={errors.year}
            required
          />
          <TextField
            label="Description"
            value={event.label}
            onChange={(label) => setEvent({ ...event, label })}
          />
          <NumberField
            label="Amount (EUR)"
            value={event.amount}
            onChange={(amount) => {
              setEvent({ ...event, amount });
              clear("amount");
            }}
            error={errors.amount}
            required
          />
          <button className="btn btn-primary" type="submit">
            {editing === undefined ? "Add event" : "Save event"}
          </button>
          {editing === undefined && !copying ? null : (
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => {
                setEditing(undefined);
                setCopying(false);
                setEvent(emptyEvent());
              }}
            >
              Cancel
            </button>
          )}
        </form>
        <Alert message={alert} />
      </Card>

      <Card
        title="Next 10 years"
        note="Capacity is income minus expenses, plus events and last year's pension refund. Planned is what the goals take from savings; the pension goal counts only its voluntary part. Gap is capacity minus planned."
      >
        {isUnset(cashFlow) ? (
          <p className="note">
            Save your income and expenses above to see 10 years of income, expenses, events, goal
            contributions and the gap.
          </p>
        ) : (
          <CashFlowTable rows={rows} />
        )}
      </Card>
    </>
  );
}

/** Setup Cash flow: income and expense inputs, one-off events, and the 10-year table from the engine. */
export function CashFlowTab() {
  const view = useLoad<CashFlowView>("/api/cash-flow");
  return (
    <Resource loaded={view}>{(data) => <CashFlowScreen view={data} set={view.set} />}</Resource>
  );
}
