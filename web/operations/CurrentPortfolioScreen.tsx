import { useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import type { Product, Settings, Transaction } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatEuro, formatQuantity } from "../money.ts";
import { TRANSACTIONS_ROUTE } from "../nav.ts";
import { DateInput } from "../setup/DateInput.tsx";
import {
  Alert,
  Card,
  Field,
  NumberField,
  ProductTag,
  RequiredLegend,
  Resource,
} from "../setup/ui.tsx";
import { SplitControl } from "../split/SplitControl.tsx";
import type { Bucket } from "../split/splitState.ts";
import { buildOpeningInput, defaultAsOf, type OpeningRow } from "./openingForm.ts";

interface Weight {
  goalId: string;
  productId: string;
  weight: number;
}

const pmcLabel = (regime: string): string =>
  regime === "pension" ? "Average unit value (€)" : "PMC (€)";
const pmcHint = (regime: string): string | undefined =>
  regime === "govt"
    ? "Quoted per 100, like a bond price."
    : regime === "pension"
      ? undefined
      : "The fiscal cost basis (carico fiscale) Fineco shows.";

function Saved({
  asOf,
  rows,
  goalName,
  productName,
}: {
  asOf: string;
  rows: Transaction[];
  goalName: (id: string) => string;
  productName: (id: string) => string;
}) {
  return (
    <Card title="Current portfolio saved">
      <p className="saved" role="status">
        The <TermPopover term="opening">opening position</TermPopover> is saved, as of {asOf}. Edit
        or delete its rows in <a href={`#/${TRANSACTIONS_ROUTE}`}>Transactions</a>.
      </p>
      {rows.length === 0 ? null : (
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Bucket</th>
              <th className="num">Units</th>
              <th className="num">
                <TermPopover term="pmc">PMC</TermPopover>
              </th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{productName(t.productId)}</td>
                <td>{goalName(t.goalId)}</td>
                <td className="num">{formatQuantity(t.qty, 6)}</td>
                <td className="num">{formatQuantity(t.price, 6)}</td>
                <td className="num">{formatEuro(t.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ProductRow({
  product,
  row,
  buckets,
  onChange,
}: {
  product: Product;
  row: OpeningRow;
  buckets: readonly Bucket[];
  onChange: (row: OpeningRow) => void;
}) {
  const units = Number(row.units);
  const hasUnits = row.units.trim() !== "" && Number.isFinite(units) && units > 0;
  return (
    <Card title={product.name}>
      <p className="split-head">
        <ProductTag regime={product.regime} />
      </p>
      <div className="form-grid">
        <NumberField
          label={`Total units of ${product.name}`}
          value={row.units}
          // A new total makes the confirmed split stale.
          onChange={(text) => onChange({ ...row, units: text, split: undefined })}
        />
        <NumberField
          label={`${pmcLabel(product.regime)} for ${product.name}`}
          value={row.pmc}
          onChange={(pmc) => onChange({ ...row, pmc })}
          hint={pmcHint(product.regime)}
        />
      </div>
      {hasUnits ? (
        <SplitControl
          key={row.units}
          product={product}
          totalUnits={units}
          buckets={buckets}
          onConfirm={(split) => onChange({ ...row, split })}
        />
      ) : null}
    </Card>
  );
}

function Form({
  goals,
  products,
  weights,
  trackingStart,
  onSaved,
}: {
  goals: GoalListView["goals"];
  products: Product[];
  weights: Weight[];
  trackingStart: string;
  onSaved: (rows: Transaction[], asOf: string) => void;
}) {
  const [asOf, setAsOf] = useState(defaultAsOf(trackingStart));
  const [rows, setRows] = useState<Record<string, OpeningRow>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const bucketsOf = (productId: string): Bucket[] =>
    goals.map((goal) => ({
      goalId: goal.id,
      name: goal.name,
      slot: goal.slot,
      weight: weights.find((w) => w.goalId === goal.id && w.productId === productId)?.weight,
    }));

  const save = async () => {
    const built = buildOpeningInput(asOf, products, rows);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setSaving(true);
    try {
      const saved = await api<Transaction[]>("POST", "/api/opening-position", {
        body: built.input,
      });
      onSaved(saved, asOf);
    } catch (failure) {
      setError(messageOf(failure));
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        title="As of"
        note={`The default is the first day of the tracking start month (${trackingStart}).`}
      >
        <RequiredLegend />
        <Field label="As-of date" required>
          {(labelId, controlId) => (
            <DateInput
              id={controlId}
              aria-labelledby={labelId}
              required
              value={asOf}
              onChange={setAsOf}
            />
          )}
        </Field>
      </Card>
      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={product}
          row={rows[product.id] ?? { units: "", pmc: "" }}
          buckets={bucketsOf(product.id)}
          onChange={(row) => setRows({ ...rows, [product.id]: row })}
        />
      ))}
      <Alert message={error} />
      <div className="actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save current portfolio"}
        </button>
      </div>
    </>
  );
}

/** Operations > Import > Current portfolio: units and PMC per product, split over the buckets. */
export function CurrentPortfolioScreen() {
  const goals = useLoad<GoalListView>("/api/goal-list");
  const products = useLoad<Product[]>("/api/products");
  const weights = useLoad<Weight[]>("/api/allocation");
  const settings = useLoad<Settings>("/api/settings");
  const opening = useLoad<{ asOf: string | null }>("/api/opening-position");
  const [saved, setSaved] = useState<{ asOf: string; rows: Transaction[] }>();

  return (
    <>
      <h2 className="import-section-title">Current portfolio</h2>
      <p className="note">
        Enter what you hold today: units and <TermPopover term="pmc">PMC</TermPopover> per product,
        then split the units over the buckets. Each part is saved as an opening transaction, not a
        contribution.
      </p>
      <Resource loaded={goals}>
        {({ goals: goalList }) => (
          <Resource loaded={products}>
            {(productList) => (
              <Resource loaded={weights}>
                {(weightList) => (
                  <Resource loaded={settings}>
                    {({ trackingStart }) => (
                      <Resource loaded={opening}>
                        {({ asOf }) => {
                          const goalName = (id: string) =>
                            goalList.find((g) => g.id === id)?.name ?? "?";
                          const productName = (id: string) =>
                            productList.find((p) => p.id === id)?.name ?? "?";
                          if (saved || asOf !== null) {
                            return (
                              <Saved
                                asOf={saved?.asOf ?? asOf ?? ""}
                                rows={saved?.rows ?? []}
                                goalName={goalName}
                                productName={productName}
                              />
                            );
                          }
                          if (goalList.length === 0 || productList.length === 0) {
                            return (
                              <Card title="Current portfolio">
                                <p className="note">Add a product and a goal in Setup first.</p>
                              </Card>
                            );
                          }
                          return (
                            <Form
                              goals={goalList}
                              products={productList}
                              weights={weightList}
                              trackingStart={trackingStart}
                              onSaved={(rows, savedAsOf) => setSaved({ asOf: savedAsOf, rows })}
                            />
                          );
                        }}
                      </Resource>
                    )}
                  </Resource>
                )}
              </Resource>
            )}
          </Resource>
        )}
      </Resource>
    </>
  );
}
