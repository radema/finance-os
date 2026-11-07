import { useId, useState } from "react";
import type { AllocationRow, Goal, PensionPlan, Product } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { num } from "../forms.ts";
import { formatPercent } from "../money.ts";
import { previewWeights, type WeightEdits, weightText } from "./allocationWeights.ts";
import {
  Alert,
  Card,
  ConfirmButton,
  DecimalInput,
  Field,
  PriorityTag,
  RequiredLegend,
  Resource,
} from "./ui.tsx";

interface GoalWeightsProps {
  goal: Goal;
  products: Product[];
  rows: AllocationRow[];
  /** The pension goal's weights come from the pension flows, so they are shown and not edited. */
  readOnly: boolean;
  /** Called with the goal's weights as the server returned them, rescaled. */
  onChange: (goalId: string, rows: AllocationRow[]) => void;
}

export function GoalWeights({ goal, products, rows, readOnly, onChange }: GoalWeightsProps) {
  const errorPrefix = useId();
  const [error, setError] = useState<string>();
  const [productId, setProductId] = useState("");
  const [weight, setWeight] = useState("1");
  const [edits, setEdits] = useState<WeightEdits>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const used = new Set(rows.map((row) => row.productId));
  const free = products.filter((product) => !used.has(product.id));
  const { changed, shares } = previewWeights(rows, edits);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const run = async (action: () => Promise<AllocationRow[]>) => {
    try {
      onChange(goal.id, await action());
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const put = (id: string, value: number) =>
    api<AllocationRow[]>("PUT", "/api/allocation", {
      body: { goalId: goal.id, productId: id, weight: value },
    });
  const remove = (id: string) =>
    run(() => api("DELETE", "/api/allocation", { query: { goalId: goal.id, productId: id } }));

  const edit = (id: string, text: string) => {
    setEdits((current) => ({ ...current, [id]: text }));
    setProblems(({ [id]: _, ...rest }) => rest);
  };

  // One call per changed weight. A weight that fails keeps its edit and shows why; the others are saved.
  const saveAll = async () => {
    const found: Record<string, string> = {};
    const done: string[] = [];
    for (const { productId: id, weight: value } of changed) {
      if (!Number.isFinite(value)) {
        found[id] = "Enter a number";
        continue;
      }
      try {
        onChange(goal.id, await put(id, value));
        done.push(id);
      } catch (failure) {
        found[id] = messageOf(failure);
      }
    }
    setProblems(found);
    setEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !done.includes(id))),
    );
  };

  return (
    <Card title={goal.name}>
      <p className="sub-line">
        <PriorityTag priority={goal.priority} />
      </p>
      {readOnly ? (
        <p className="note">
          The pension goal&apos;s weights come from its contribution flows. Change them on the
          Pension screen.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="note">{readOnly ? "No weights." : "No weights yet. Add a product below."}</p>
      ) : (
        <div className="table-scroll table-scroll-sticky">
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
              {rows.map((row) => {
                const problem = problems[row.productId];
                const errorId = `${errorPrefix}-${row.productId}`;
                return (
                  <tr key={row.productId}>
                    <td>{nameOf(row.productId)}</td>
                    <td className="num">
                      {readOnly ? (
                        row.weight
                      ) : (
                        <>
                          <DecimalInput
                            className="inline-input"
                            aria-label={`Weight of ${nameOf(row.productId)}`}
                            {...(problem
                              ? { "aria-invalid": true, "aria-describedby": errorId }
                              : {})}
                            value={weightText(row, edits)}
                            onChange={(text) => edit(row.productId, text)}
                          />
                          {problem ? (
                            <span className="field-hint field-error" id={errorId}>
                              {problem}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="num">{formatPercent(shares.get(row.productId) ?? 0)}</td>
                    <td className="row-actions">
                      {readOnly ? null : (
                        <ConfirmButton
                          label="Remove"
                          apart
                          onConfirm={() => void remove(row.productId)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {readOnly || rows.length === 0 ? null : (
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={changed.length === 0}
            onClick={() => void saveAll()}
          >
            Save
          </button>
          <span className="saved" role="status">
            {changed.length > 0 ? "Unsaved changes" : "Saved"}
          </span>
        </div>
      )}
      {!readOnly && free.length > 0 ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => put(productId || (free[0] as Product).id, num(weight))).then(() => {
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
          <Field label="Weight" required>
            <DecimalInput aria-required="true" value={weight} onChange={setWeight} />
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
  const pension = useLoad<PensionPlan | null>("/api/pension-plan");

  const replaceGoal = (goalId: string, rows: AllocationRow[]) =>
    allocation.set([...(allocation.data ?? []).filter((row) => row.goalId !== goalId), ...rows]);

  return (
    <Resource loaded={goals}>
      {(goalList) => (
        <Resource loaded={products}>
          {(productList) => (
            <Resource loaded={allocation}>
              {(rows) => (
                <Resource loaded={pension}>
                  {(plan) =>
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
                          Weights split each new contribution across this goal&apos;s products. They
                          do not move money already invested.
                        </p>
                        <p className="note">
                          Weights are rescaled to 100% for each goal. Use any numbers: 2, 1, 1 gives
                          50%, 25%, 25%.
                        </p>
                        <RequiredLegend />
                        {goalList.map((goal) => (
                          <GoalWeights
                            key={goal.id}
                            goal={goal}
                            products={productList}
                            rows={rows.filter((row) => row.goalId === goal.id)}
                            readOnly={goal.id === plan?.goalId}
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
      )}
    </Resource>
  );
}
