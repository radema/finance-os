import { useEffect, useState } from "react";
import { estimateCommission, isCostly, minEfficientTicket } from "../../engine/commission.ts";
import type { TransactionType } from "../../engine/holdings.ts";
import { flowsTaken } from "../../engine/pension.ts";
import type { Commission, Goal, PensionPlan, Product, Transaction } from "../../engine/schemas.ts";
import { PENSION_FLOWS } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { eurosToCents } from "../forms.ts";
import { formatEuro, formatPercent } from "../money.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  Field,
  NumberField,
  ProductTag,
  Resource,
  SelectField,
  TextField,
} from "../setup/ui.tsx";
import { fieldsFromTransaction, transactionBody } from "./transactionForm.ts";

// `opening` is written by the Current portfolio form in S2, so the form does not offer it.
const FORM_TYPES: readonly { value: TransactionType; label: string }[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "pensionContribution", label: "Pension contribution" },
  { value: "coupon", label: "Coupon" },
];
const TYPE_LABEL: Record<string, string> = {
  opening: "Opening",
  ...Object.fromEntries(FORM_TYPES.map((t) => [t.value, t.label])),
};

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

interface LastPrice {
  price: number;
  priceDate: string;
}

/** The form of Add, and of Edit when `editing` is a row: then it starts from that row. */
function AddForm({
  editing,
  today,
  goals,
  products,
  commission,
  pensionPlan,
  onSaved,
  onCancel,
}: {
  /** The row being edited, or none to add. Give the form a new `key` to switch rows. */
  editing?: Transaction;
  /** The server's app clock: the default date of a new transaction. */
  today: string;
  goals: Goal[];
  products: Product[];
  commission: Commission;
  /** The saved plan: it says which flows a pension fund takes. */
  pensionPlan: PensionPlan | null | undefined;
  onSaved: () => void;
  /** Edit only: leave the row as it is. */
  onCancel: () => void;
}) {
  const start = editing
    ? fieldsFromTransaction(editing)
    : {
        date: today,
        goalId: goals[0]?.id ?? "",
        productId: products[0]?.id ?? "",
        type: "buy" as TransactionType,
        amount: "",
        price: "",
        fee: "",
        flow: "",
      };
  const [date, setDate] = useState(start.date);
  const [goalId, setGoalId] = useState(start.goalId);
  const [productId, setProductId] = useState(start.productId);
  const [type, setType] = useState<TransactionType>(start.type);
  const [amount, setAmount] = useState(start.amount);
  const [price, setPrice] = useState(start.price);
  const [fee, setFee] = useState(start.fee);
  const [flow, setFlow] = useState(start.flow);
  const [priceNote, setPriceNote] = useState<string>();
  const [error, setError] = useState<string>();

  // The price starts from the product's last price; the user can still change it. An edited row
  // keeps its own price until the product changes.
  useEffect(() => {
    if (editing && productId === editing.productId) return;
    let live = true;
    api<LastPrice | null>("GET", "/api/last-price", { query: { productId } }).then(
      (last) => {
        if (!live) return;
        setPrice(last ? String(last.price) : "");
        setPriceNote(last ? `Last price, ${last.priceDate}.` : "No price saved for this product.");
      },
      () => live && setPriceNote(undefined),
    );
    return () => {
      live = false;
    };
  }, [productId, editing]);

  const product = products.find((p) => p.id === productId);
  const amountCents = eurosToCents(amount);
  const hasAmount = Number.isFinite(amountCents) && amountCents > 0;
  const estimate =
    product && hasAmount ? estimateCommission(commission, product, type, amountCents) : 0;
  // A fund that takes both flows needs the user's choice; with one flow the server picks it.
  const takesBothFlows =
    type === "pensionContribution" &&
    flowsTaken(pensionPlan, productId).length === PENSION_FLOWS.length;
  const costly = product && hasAmount && isCostly(commission, product, type, amountCents);

  const save = async () => {
    try {
      const body = transactionBody(
        { date, goalId, productId, type, amount, price, fee, flow },
        takesBothFlows,
      );
      // The form has no note field: an edit sends the stored note back so it is kept.
      await api(editing ? "PUT" : "POST", "/api/transactions", {
        body: editing ? { ...body, id: editing.id, note: editing.note } : body,
      });
      setError(undefined);
      setAmount("");
      setFee("");
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <Card title={editing ? "Edit transaction" : "Add transaction"}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <SelectField
          label="Bucket"
          value={goalId}
          onChange={setGoalId}
          options={goals.map((g) => ({ value: g.id, label: g.name }))}
        />
        <SelectField
          label="Product"
          value={productId}
          onChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        <SelectField
          label="Type"
          value={type}
          onChange={(v) => setType(v as TransactionType)}
          options={FORM_TYPES}
        />
        {takesBothFlows ? (
          <SelectField
            label="Flow"
            value={flow}
            onChange={setFlow}
            options={[
              { value: "", label: "Choose…" },
              ...PENSION_FLOWS.map((kind) => ({
                value: kind,
                label: kind,
              })),
            ]}
          />
        ) : null}
        <NumberField
          label={type === "coupon" ? "Net cash received (€)" : "Amount (€)"}
          value={amount}
          onChange={setAmount}
          hint={
            product?.regime === "govt"
              ? "Government bonds: qty = amount / (price / 100)."
              : undefined
          }
        />
        {type === "coupon" ? null : (
          <NumberField label="Price" value={price} onChange={setPrice} hint={priceNote} />
        )}
        <NumberField
          label="Commission paid (€, optional)"
          value={fee}
          onChange={setFee}
          hint="Leave empty to record none."
        />
        <div className="actions">
          <button className="btn btn-primary" type="submit">
            {editing ? "Save changes" : "Add transaction"}
          </button>
          {editing ? (
            <button className="btn btn-quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
      {hasAmount && (type === "buy" || type === "sell") ? (
        <p className="note" data-testid="commission-estimate">
          Estimated commission: {formatEuro(estimate)}
        </p>
      ) : null}
      {costly ? (
        <p className="flag" role="status" data-testid="cost-warning">
          Below the minimum efficient ticket of {formatEuro(minEfficientTicket(commission))}: the
          fee is about {formatPercent(estimate / amountCents)} of this amount.
        </p>
      ) : null}
      <Alert message={error} />
    </Card>
  );
}

/** Operations > Transactions: add form, and the list with filters by bucket and year; edit; delete. */
export function TransactionsScreen() {
  const goals = useLoad<Goal[]>("/api/goals");
  const products = useLoad<Product[]>("/api/products");
  const commission = useLoad<Commission>("/api/commission");
  const clock = useLoad<{ today: string }>("/api/today");
  const pensionPlan = useLoad<PensionPlan | null>("/api/pension-plan");
  const [goalFilter, setGoalFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<Transaction>();

  const query = new URLSearchParams();
  if (goalFilter) query.set("goalId", goalFilter);
  if (/^\d{4}$/.test(yearFilter)) query.set("year", yearFilter);
  const list = useLoad<Transaction[]>(`/api/transactions${query.size ? `?${query}` : ""}`);

  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/transactions", { query: { id } });
      setError(undefined);
      if (editing?.id === id) setEditing(undefined);
      list.reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const goalName = (id: string) => goals.data?.find((g) => g.id === id)?.name ?? "?";
  const productOf = (id: string) => products.data?.find((p) => p.id === id);

  return (
    <>
      <div className="tag">Operations</div>
      <h1 className="title">Transactions</h1>

      <Resource loaded={goals}>
        {(goalList) => (
          <Resource loaded={products}>
            {(productList) => (
              <Resource loaded={commission}>
                {(plan) =>
                  goalList.length === 0 || productList.length === 0 ? (
                    <Card title="Add transaction">
                      <p className="note">Add a product and a goal in Setup first.</p>
                    </Card>
                  ) : (
                    <Resource loaded={clock}>
                      {({ today }) => (
                        <AddForm
                          key={editing?.id ?? "add"}
                          editing={editing}
                          today={today}
                          goals={goalList}
                          products={productList}
                          commission={plan}
                          pensionPlan={pensionPlan.data}
                          onSaved={() => {
                            setEditing(undefined);
                            list.reload();
                          }}
                          onCancel={() => setEditing(undefined)}
                        />
                      )}
                    </Resource>
                  )
                }
              </Resource>
            )}
          </Resource>
        )}
      </Resource>

      <Card title="Transactions">
        <div className="inline-form">
          <SelectField
            label="Bucket"
            value={goalFilter}
            onChange={setGoalFilter}
            options={[
              { value: "", label: "All buckets" },
              ...(goals.data ?? []).map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
          <TextField
            label="Year"
            value={yearFilter}
            onChange={setYearFilter}
            hint="Four digits, or empty."
          />
        </div>
        <Alert message={error} />
        <Resource loaded={list}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="note">No transactions to show.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Bucket</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Amount</th>
                    <th className="num">Commission</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const p = productOf(t.productId);
                    return (
                      <tr key={t.id}>
                        <td>{t.date}</td>
                        <td>{goalName(t.goalId)}</td>
                        <td>
                          {p?.name ?? "?"} {p ? <ProductTag regime={p.regime} /> : null}
                        </td>
                        <td>
                          {TYPE_LABEL[t.type] ?? t.type}
                          {t.flow ? ` (${t.flow})` : ""}
                        </td>
                        <td className="num">
                          {t.type === "coupon" ? "–" : quantity.format(t.qty)}
                        </td>
                        <td className="num">
                          {t.type === "coupon" ? "–" : quantity.format(t.price)}
                        </td>
                        <td className="num">{formatEuro(t.amountCents)}</td>
                        <td className="num">
                          {t.commissionCents === null ? "–" : formatEuro(t.commissionCents)}
                        </td>
                        <td className="row-actions">
                          <button
                            className="btn btn-quiet"
                            type="button"
                            onClick={() => {
                              setEditing(t);
                              window.scrollTo({ top: 0 });
                            }}
                          >
                            Edit
                          </button>
                          <ConfirmButton
                            label="Delete"
                            confirmLabel="Delete transaction"
                            onConfirm={() => void remove(t.id)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </Resource>
      </Card>
    </>
  );
}
