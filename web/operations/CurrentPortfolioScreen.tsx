import { useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import type { Product, Settings } from "../../engine/schemas.ts";
import type { ConfirmedSplit } from "../../engine/split.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { DateInput } from "../DateInput.tsx";
import { eurosToCents } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";

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

interface Opening {
  asOf: string | null;
  positions: {
    productId: string;
    totalUnits: number;
    pmc: number;
    parts: { goalId: string; units: number }[];
  }[];
  cashBalances: { goalId: string; amountCents: number }[];
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
          initialSplit={row.split}
          onClear={() => onChange({ ...row, split: undefined })}
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
  opening,
  onSaved,
}: {
  goals: GoalListView["goals"];
  products: Product[];
  weights: Weight[];
  trackingStart: string;
  opening: Opening;
  onSaved: () => void;
}) {
  const [asOf, setAsOf] = useState(opening.asOf ?? defaultAsOf(trackingStart));
  const [rows, setRows] = useState<Record<string, OpeningRow>>(() =>
    Object.fromEntries(
      opening.positions.map((p) => [
        p.productId,
        {
          units: String(p.totalUnits),
          pmc: String(p.pmc),
          split: {
            parts: p.parts.map((part) => ({ ...part, commissionCents: 0 })),
          } as unknown as ConfirmedSplit,
        },
      ]),
    ),
  );
  const [cash, setCash] = useState<Record<string, string>>(() =>
    Object.fromEntries(opening.cashBalances.map((b) => [b.goalId, String(b.amountCents / 100)])),
  );
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
    const built = buildOpeningInput(asOf, products, rows, true);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const cashBalances = goals.map((g) => ({
      goalId: g.id,
      amountCents: eurosToCents(cash[g.id] || "0"),
    }));
    if (cashBalances.some((b) => !Number.isFinite(b.amountCents) || b.amountCents < 0)) {
      setError("Cash balances must be zero or greater.");
      return;
    }
    if (built.input.positions.length === 0 && cashBalances.every((b) => b.amountCents === 0)) {
      setError("Add a product or an opening cash balance.");
      return;
    }
    setSaving(true);
    try {
      await api(opening.asOf === null ? "POST" : "PUT", "/api/opening-position", {
        body: { ...built.input, cashBalances },
      });
      onSaved();
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
      <Card
        title="Opening cash by bucket"
        note="Optional cash held on the as-of date. Empty means zero."
      >
        <div className="form-grid">
          {goals.map((goal) => (
            <NumberField
              key={goal.id}
              label={`${goal.name} (€)`}
              value={cash[goal.id] ?? ""}
              onChange={(value) => setCash({ ...cash, [goal.id]: value })}
            />
          ))}
        </div>
      </Card>
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
  const goals = useLoad<GoalListView>("/api/goal-list?includeArchived=true");
  const products = useLoad<Product[]>("/api/products");
  const weights = useLoad<Weight[]>("/api/allocation");
  const settings = useLoad<Settings>("/api/settings");
  const opening = useLoad<Opening>("/api/opening-position");

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
                        {(value) => {
                          if (goalList.length === 0) {
                            return (
                              <Card title="Current portfolio">
                                <p className="note">Add a goal in Setup first.</p>
                              </Card>
                            );
                          }
                          return (
                            <Form
                              key={value.asOf ?? "new"}
                              goals={goalList}
                              products={productList}
                              weights={weightList}
                              trackingStart={trackingStart}
                              opening={value}
                              onSaved={opening.reload}
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
