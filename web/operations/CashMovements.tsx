import { useState } from "react";
import type { Goal } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { DateInput } from "../DateInput.tsx";
import { eurosToCents } from "../forms.ts";
import { formatEuro } from "../money.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  Field,
  NumberField,
  Resource,
  SelectField,
  TextField,
} from "../setup/ui.tsx";

interface Movement {
  id: string;
  date: string;
  goalId: string;
  type: string;
  amountCents: number;
  toGoalId: string | null;
  note: string | null;
}
interface Balance {
  goalId: string;
  amountCents: number;
}
const types = ["contribution", "withdrawal", "transfer", "fee", "tax", "income"];

export function CashMovements() {
  const goals = useLoad<Goal[]>("/api/goals");
  const clock = useLoad<{ today: string }>("/api/today");
  const movements = useLoad<Movement[]>("/api/cash-movements");
  const balances = useLoad<Balance[]>("/api/bucket-cash");
  const [date, setDate] = useState("");
  const [goalId, setGoalId] = useState("");
  const [toGoalId, setToGoalId] = useState("");
  const [type, setType] = useState("contribution");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const options = (goals.data ?? []).map((g) => ({ value: g.id, label: g.name }));
  const name = (id: string) => options.find((g) => g.value === id)?.label ?? id;
  const reload = () => {
    movements.reload();
    balances.reload();
  };
  const save = async () => {
    try {
      await api("POST", "/api/cash-movements", {
        body: {
          date: date || clock.data?.today,
          goalId: goalId || options[0]?.value,
          type,
          amountCents: eurosToCents(amount),
          toGoalId: type === "transfer" ? toGoalId : null,
          note,
        },
      });
      setError(undefined);
      setAmount("");
      setNote("");
      reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/cash-movements", { query: { id } });
      setError(undefined);
      reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  return (
    <Card
      title="Cash movements"
      note="Record external contributions and withdrawals, transfers between buckets, fees, taxes and income."
    >
      <Resource loaded={balances}>
        {(rows) => (
          <p className="note">
            Cash by bucket:{" "}
            {rows.length
              ? rows.map((b) => `${name(b.goalId)}: ${formatEuro(b.amountCents)}`).join(" · ")
              : "No balances yet."}
          </p>
        )}
      </Resource>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Date">
          {(labelId, controlId) => (
            <DateInput
              id={controlId}
              aria-labelledby={labelId}
              value={date || clock.data?.today || ""}
              onChange={setDate}
            />
          )}
        </Field>
        <SelectField
          label="Bucket"
          value={goalId || options[0]?.value || ""}
          onChange={setGoalId}
          options={options}
        />
        <SelectField
          label="Type"
          value={type}
          onChange={setType}
          options={types.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
        />
        {type === "transfer" ? (
          <SelectField
            label="To bucket"
            value={toGoalId}
            onChange={setToGoalId}
            options={[{ value: "", label: "Choose a bucket" }, ...options]}
          />
        ) : null}
        <NumberField label="Amount (€)" value={amount} onChange={setAmount} required />
        <TextField label="Note (optional)" value={note} onChange={setNote} />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={!options.length}>
            Add cash movement
          </button>
        </div>
      </form>
      <Alert message={error} />
      <Resource loaded={movements}>
        {(rows) =>
          rows.length ? (
            <div className="table-scroll table-scroll-sticky">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Bucket</th>
                    <th>Type</th>
                    <th>To bucket</th>
                    <th className="num">Amount</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      <td>{name(row.goalId)}</td>
                      <td>{row.type}</td>
                      <td>{row.toGoalId ? name(row.toGoalId) : "–"}</td>
                      <td className="num">{formatEuro(row.amountCents)}</td>
                      <td>{row.note}</td>
                      <td>
                        {row.type === "opening" ? (
                          <a href="#/operations/import?tab=portfolio">Current portfolio</a>
                        ) : (
                          <ConfirmButton
                            label="Delete"
                            confirmLabel="Delete cash movement"
                            onConfirm={() => void remove(row.id)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="note">No cash movements yet.</p>
          )
        }
      </Resource>
    </Card>
  );
}
