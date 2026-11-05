import { useState } from "react";
import type { AllocationRow, Goal, Product } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { num } from "../forms.ts";
import { formatPercent } from "../money.ts";
import { Alert, Card, ConfirmButton, Field, PriorityTag, Resource } from "./ui.tsx";

interface GoalWeightsProps {
  goal: Goal;
  products: Product[];
  rows: AllocationRow[];
  /** Called with the goal's weights as the server returned them, rescaled. */
  onChange: (goalId: string, rows: AllocationRow[]) => void;
}

function WeightRow({
  row,
  product,
  save,
  remove,
}: {
  row: AllocationRow;
  product: Product | undefined;
  save: (productId: string, weight: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
}) {
  const [text, setText] = useState(String(row.weight));
  const changed = text !== String(row.weight);
  return (
    <tr>
      <td>{product?.name ?? row.productId}</td>
      <td className="num">
        <input
          className="inline-input"
          type="number"
          min="0"
          step="any"
          aria-label={`Weight of ${product?.name ?? row.productId}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </td>
      <td className="num">{formatPercent(row.share)}</td>
      <td className="row-actions">
        <button
          className="btn"
          type="button"
          disabled={!changed}
          onClick={() => void save(row.productId, num(text))}
        >
          Save
        </button>
        <ConfirmButton label="Remove" onConfirm={() => void remove(row.productId)} />
      </td>
    </tr>
  );
}

function GoalWeights({ goal, products, rows, onChange }: GoalWeightsProps) {
  const [error, setError] = useState<string>();
  const [productId, setProductId] = useState("");
  const [weight, setWeight] = useState("1");
  const used = new Set(rows.map((row) => row.productId));
  const free = products.filter((product) => !used.has(product.id));

  const run = async (action: () => Promise<AllocationRow[]>) => {
    try {
      onChange(goal.id, await action());
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const save = (id: string, value: number) =>
    run(() =>
      api("PUT", "/api/allocation", { body: { goalId: goal.id, productId: id, weight: value } }),
    );
  const remove = (id: string) =>
    run(() => api("DELETE", "/api/allocation", { query: { goalId: goal.id, productId: id } }));

  return (
    <Card title={goal.name}>
      <p className="sub-line">
        <PriorityTag priority={goal.priority} />
      </p>
      {rows.length === 0 ? (
        <p className="note">No weights yet. Add a product below.</p>
      ) : (
        <table className="table table-weights">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Weight</th>
              <th className="num">Share</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <WeightRow
                key={`${row.productId}:${row.weight}`}
                row={row}
                product={products.find((p) => p.id === row.productId)}
                save={save}
                remove={remove}
              />
            ))}
          </tbody>
        </table>
      )}
      {free.length > 0 ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(productId || (free[0] as Product).id, num(weight)).then(() => {
              setWeight("1");
              setProductId("");
            });
          }}
        >
          <Field label="Product">
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {free.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weight">
            <input
              type="number"
              min="0"
              step="any"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </Field>
          <button className="btn btn-primary" type="submit">
            Add weight
          </button>
        </form>
      ) : null}
      <Alert message={error} />
    </Card>
  );
}

export function AllocationTab() {
  const goals = useLoad<Goal[]>("/api/goals");
  const products = useLoad<Product[]>("/api/products");
  const allocation = useLoad<AllocationRow[]>("/api/allocation");

  const replaceGoal = (goalId: string, rows: AllocationRow[]) =>
    allocation.set([...(allocation.data ?? []).filter((row) => row.goalId !== goalId), ...rows]);

  return (
    <Resource loaded={goals}>
      {(goalList) => (
        <Resource loaded={products}>
          {(productList) => (
            <Resource loaded={allocation}>
              {(rows) =>
                goalList.length === 0 ? (
                  <Card title="Allocation">
                    <p className="note">
                      Add a goal on the Goals tab first. Each goal has its own weights.
                    </p>
                  </Card>
                ) : productList.length === 0 ? (
                  <Card title="Allocation">
                    <p className="note">Add a product on the Products tab first.</p>
                  </Card>
                ) : (
                  <>
                    <p className="note">
                      Weights are rescaled to 100% for each goal. Use any numbers: 2, 1, 1 gives
                      50%, 25%, 25%.
                    </p>
                    {goalList.map((goal) => (
                      <GoalWeights
                        key={goal.id}
                        goal={goal}
                        products={productList}
                        rows={rows.filter((row) => row.goalId === goal.id)}
                        onChange={replaceGoal}
                      />
                    ))}
                  </>
                )
              }
            </Resource>
          )}
        </Resource>
      )}
    </Resource>
  );
}
