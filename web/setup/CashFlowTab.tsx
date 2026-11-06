import { useState } from "react";
import type { CashFlowView } from "../../engine/cashFlow.ts";
import type { CashFlow, CashFlowEvent } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { centsToEuros, eurosToCents, fractionToPercent, num, percentToFraction } from "../forms.ts";
import { formatEuro } from "../money.ts";
import { useRevealForm } from "./revealForm.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  NumberField,
  RequiredLegend,
  Resource,
  TextField,
} from "./ui.tsx";

type Values = {
  income: string;
  incomeGrowth: string;
  essential: string;
  optional: string;
  expenseGrowth: string;
};

const toValues = (c: CashFlow): Values => ({
  income: centsToEuros(c.income),
  incomeGrowth: fractionToPercent(c.incomeGrowth),
  essential: centsToEuros(c.essential),
  optional: centsToEuros(c.optional),
  expenseGrowth: fractionToPercent(c.expenseGrowth),
});

const toDocument = (v: Values, events: CashFlowEvent[]): CashFlow => ({
  income: eurosToCents(v.income),
  incomeGrowth: percentToFraction(v.incomeGrowth),
  essential: eurosToCents(v.essential),
  optional: eurosToCents(v.optional),
  expenseGrowth: percentToFraction(v.expenseGrowth),
  events,
});

type EventForm = { year: string; label: string; amount: string };

const isUnset = (c: CashFlow): boolean =>
  c.income === 0 && c.essential === 0 && c.optional === 0 && c.events.length === 0;

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
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const { formRef, reveal } = useRevealForm("form");

  // One document: the inputs as typed, and the events as given.
  const save = async (events: CashFlowEvent[]): Promise<boolean> => {
    try {
      set(await api<CashFlowView>("PUT", "/api/cash-flow", { body: toDocument(values, events) }));
      setError(undefined);
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      setSaved(false);
      return false;
    }
  };
  const saveEvents = async (events: CashFlowEvent[]) => {
    if (await save(events)) {
      setEvent(emptyEvent());
      setEditing(undefined);
    }
  };
  const submitEvent = () => {
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

  const field = (key: keyof Values, label: string, hint?: string) => (
    <NumberField
      label={label}
      value={values[key]}
      onChange={(value) => {
        setValues({ ...values, [key]: value });
        setSaved(false);
      }}
      hint={hint}
      step={key.endsWith("Growth") ? "any" : "0.01"}
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
            void save(cashFlow.events).then((ok) => setSaved(ok));
          }}
        >
          {field("income", "Net household income (EUR a year)")}
          {field("incomeGrowth", "Income growth (% a year)")}
          {field("essential", "Essential expenses (EUR a month)")}
          {field("optional", "Optional expenses (EUR a month)")}
          {field("expenseGrowth", "Expense growth (% a year)")}
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              Save cash flow
            </button>
            {saved ? <span className="saved">Saved.</span> : null}
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
                        setEvent({
                          year: String(e.year),
                          label: e.label,
                          amount: centsToEuros(e.amount),
                        });
                        setError(undefined);
                        reveal();
                      }}
                    >
                      Edit
                    </button>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Delete event"
                      onConfirm={() =>
                        void saveEvents(cashFlow.events.filter((_, i) => i !== e.index))
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
          ref={formRef}
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitEvent();
          }}
        >
          <NumberField
            label="Year"
            value={event.year}
            onChange={(year) => setEvent({ ...event, year })}
            step="1"
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
            onChange={(amount) => setEvent({ ...event, amount })}
            step="0.01"
            required
          />
          <button className="btn btn-primary" type="submit">
            {editing === undefined ? "Add event" : "Save event"}
          </button>
          {editing === undefined ? null : (
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => {
                setEditing(undefined);
                setEvent(emptyEvent());
              }}
            >
              Cancel
            </button>
          )}
        </form>
        <Alert message={error} />
      </Card>

      <Card
        title="Next 10 years"
        note="Capacity is income minus expenses, plus events and last year's pension refund. Planned is what the goals take from savings; the pension goal counts only its voluntary part. Gap is capacity minus planned."
      >
        {isUnset(cashFlow) ? (
          <p className="note">Enter your income and expenses above to see the table.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Income</th>
                <th className="num">Expenses</th>
                <th className="num">Events</th>
                <th className="num">Pension refund</th>
                <th className="num">Capacity</th>
                <th className="num">Planned from savings</th>
                <th className="num">Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>
                    {row.year}
                    {row.label === String(row.year) ? null : (
                      <span className="sub"> {row.label}</span>
                    )}
                  </td>
                  <td className="num">{formatEuro(row.income)}</td>
                  <td className="num">{formatEuro(row.expenses)}</td>
                  <td className="num">{formatEuro(row.events)}</td>
                  <td className="num">{formatEuro(row.refund)}</td>
                  <td className="num">
                    <strong>{formatEuro(row.capacity)}</strong>
                  </td>
                  <td className="num">{formatEuro(row.planned)}</td>
                  <td className="num">{formatEuro(row.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
