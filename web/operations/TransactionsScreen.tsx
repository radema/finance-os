import { useEffect, useState } from "react";
import { estimateCommission, isCostly, minEfficientTicket } from "../../engine/commission.ts";
import type { TransactionType } from "../../engine/holdings.ts";
import { flowsTaken } from "../../engine/pension.ts";
import type { Commission, Goal, PensionPlan, Product, Transaction } from "../../engine/schemas.ts";
import { PENSION_FLOWS } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { checkFields, type FieldErrors } from "../formErrors.ts";
import { eurosToCents } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatEuro, formatPercent } from "../money.ts";
import { copyOfTransaction } from "../setup/duplicate.ts";
import { type RevealFormRef, useRevealForm } from "../setup/revealForm.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  Field,
  NumberField,
  ProductTag,
  RequiredLegend,
  Resource,
  SelectField,
  TextField,
} from "../setup/ui.tsx";
import { useFormErrors } from "../setup/useFormErrors.ts";
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

const LABELS = {
  date: "Date",
  goalId: "Bucket",
  productId: "Product",
  flow: "Flow",
  amount: "Amount",
  price: "Price",
  fee: "Commission",
};
type FormKey = keyof typeof LABELS;
// The API names these in cents; the form holds euros.
const API_KEYS: Record<string, FormKey> = { amountCents: "amount", commissionCents: "fee" };

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

interface LastPrice {
  price: number;
  priceDate: string;
}

/** The form of Add. It starts from a row for Edit (`editing`) or Duplicate (`copying`). */
function AddForm({
  editing,
  copying,
  today,
  goals,
  products,
  commission,
  pensionPlan,
  formRef,
  onSaved,
  onCancel,
}: {
  /** The row being edited, or none to add. Give the form a new `key` to switch rows. */
  editing?: Transaction;
  /** The row being duplicated: the form adds a new transaction that starts from it. */
  copying?: Transaction;
  /** The server's app clock: the default date of a new transaction. */
  today: string;
  goals: Goal[];
  products: Product[];
  commission: Commission;
  /** The saved plan: it says which flows a pension fund takes. */
  pensionPlan: PensionPlan | null | undefined;
  /** On the form element: Edit and Duplicate reveal it. */
  formRef: RevealFormRef;
  onSaved: () => void;
  /** Edit and Duplicate: leave the form without saving. */
  onCancel: () => void;
}) {
  const from = editing ?? copying;
  const start = from
    ? fieldsFromTransaction(copying ? copyOfTransaction(copying, today) : from)
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
  const { errors, alert, reject, fail, clear } = useFormErrors<FormKey>(LABELS, API_KEYS);

  // The price starts from the product's last price; the user can still change it. An edited or
  // duplicated row keeps its own price until the product changes.
  useEffect(() => {
    if (from && productId === from.productId) return;
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
  }, [productId, from]);

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
    const problems: FieldErrors<FormKey> = checkFields(
      { date, amount, price, fee },
      {
        date: "text",
        amount: "number",
        ...(type === "coupon" ? {} : { price: "number" as const }),
        fee: "optionalNumber",
      },
      LABELS,
    );
    if (takesBothFlows && flow === "") problems.flow = "Choose a flow";
    if (Object.keys(problems).length > 0) return reject(problems);
    try {
      const body = transactionBody(
        { date, goalId, productId, type, amount, price, fee, flow },
        takesBothFlows,
      );
      // The form has no note field: an edit sends the stored note back so it is kept.
      await api(editing ? "PUT" : "POST", "/api/transactions", {
        body: editing ? { ...body, id: editing.id, note: editing.note } : body,
      });
      clear();
      setAmount("");
      setFee("");
      onSaved();
    } catch (failure) {
      fail(failure);
    }
  };

  return (
    <Card title={editing ? "Edit transaction" : "Add transaction"}>
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
        <Field label="Date" error={errors.date} required>
          {(labelId, controlId, invalid) => (
            <input
              id={controlId}
              type="date"
              aria-labelledby={labelId}
              required
              {...invalid}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                clear("date");
              }}
            />
          )}
        </Field>
        <SelectField
          label="Bucket"
          value={goalId}
          onChange={setGoalId}
          error={errors.goalId}
          options={goals.map((g) => ({ value: g.id, label: g.name }))}
        />
        <SelectField
          label="Product"
          value={productId}
          onChange={setProductId}
          error={errors.productId}
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
            onChange={(value) => {
              setFlow(value);
              clear("flow");
            }}
            error={errors.flow}
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
          onChange={(value) => {
            setAmount(value);
            clear("amount");
          }}
          error={errors.amount}
          required
          hint={
            product?.regime === "govt"
              ? "Government bonds: qty = amount / (price / 100)."
              : undefined
          }
        />
        {type === "coupon" ? null : (
          <NumberField
            label="Price"
            value={price}
            onChange={(value) => {
              setPrice(value);
              clear("price");
            }}
            hint={priceNote}
            error={errors.price}
            required
          />
        )}
        <NumberField
          label="Commission paid (€, optional)"
          value={fee}
          onChange={(value) => {
            setFee(value);
            clear("fee");
          }}
          error={errors.fee}
          hint="Leave empty to record none."
        />
        <div className="actions">
          <button className="btn btn-primary" type="submit">
            {editing ? "Save changes" : "Add transaction"}
          </button>
          {from ? (
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
          Below the <TermPopover term="minticket">minimum efficient ticket</TermPopover> of{" "}
          {formatEuro(minEfficientTicket(commission))}: the fee is about{" "}
          {formatPercent(estimate / amountCents)} of this amount.
        </p>
      ) : null}
      <Alert message={alert} />
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
  const [copying, setCopying] = useState<Transaction>();
  const { formRef, reveal } = useRevealForm();

  const query = new URLSearchParams();
  if (goalFilter) query.set("goalId", goalFilter);
  if (/^\d{4}$/.test(yearFilter)) query.set("year", yearFilter);
  const list = useLoad<Transaction[]>(`/api/transactions${query.size ? `?${query}` : ""}`);

  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/transactions", { query: { id } });
      setError(undefined);
      if (editing?.id === id) setEditing(undefined);
      if (copying?.id === id) setCopying(undefined);
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
                          key={editing ? editing.id : copying ? `copy-${copying.id}` : "add"}
                          editing={editing}
                          copying={copying}
                          today={today}
                          goals={goalList}
                          products={productList}
                          commission={plan}
                          pensionPlan={pensionPlan.data}
                          formRef={formRef}
                          onSaved={() => {
                            setEditing(undefined);
                            setCopying(undefined);
                            list.reload();
                          }}
                          onCancel={() => {
                            setEditing(undefined);
                            setCopying(undefined);
                          }}
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
                          {t.type === "opening" ? null : (
                            <button
                              className="btn btn-quiet"
                              type="button"
                              onClick={() => {
                                setCopying(undefined);
                                setEditing(t);
                                reveal();
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {t.type === "opening" ? null : (
                            <button
                              className="btn btn-quiet"
                              type="button"
                              onClick={() => {
                                setEditing(undefined);
                                setCopying(t);
                                reveal();
                              }}
                            >
                              Duplicate
                            </button>
                          )}
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
