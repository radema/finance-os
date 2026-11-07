import { type CSSProperties, useEffect, useMemo, useState } from "react";
import type { GoalListRow, GoalListView } from "../../engine/goalViews.ts";
import {
  CRITERION_RULES,
  defaultCriterion,
  type OptimizerCriterion,
} from "../../engine/optimizer.ts";
import type { MixView, OptimizerRunView } from "../../engine/optimizerView.ts";
import type { AllocationRow, PensionPlan, Product } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { GoalChip } from "../goals/GoalChip.tsx";
import { pVsRequired, requiredText } from "../goals/outlook.ts";
import { formatAmount, formatPercent } from "../money.ts";
import { Alert, Card, CheckField, ProductTag, Resource, SelectField } from "../setup/ui.tsx";
import { MixScatter } from "./MixScatter.tsx";
import {
  defaultUniverse,
  eligibleProducts,
  MAX_PRODUCTS,
  mixText,
  onlyMixSentence,
  outcomeRows,
  weightRows,
} from "./model.ts";

/** The criteria in the order of the spec's table. */
const CRITERIA: readonly OptimizerCriterion[] = ["O1", "O2", "O4", "O5"];
const CAPS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const NO_CAP = "";
/** The pause after a change of the controls before the optimizer runs. */
const RUN_DELAY_MS = 300;

type Mode = OptimizerRunView["mode"];
type RunRequest = {
  goalId: string;
  products: string[];
  mode: Mode;
  criterion: OptimizerCriterion;
  maxPerProduct?: number;
};
type Run = { view?: OptimizerRunView; error?: string; running: boolean };

const KNOWN_LIMIT =
  "The optimizer amplifies errors in the return and volatility assumptions. A small change in them can move the suggested mix a lot, so treat the result as a suggestion to check, not as an answer.";

/** Runs the optimizer after a pause when the request changes; an answer that arrives late is dropped. */
function useRun(request: RunRequest, tick: number): Run {
  const [run, setRun] = useState<Run>({ running: true });
  const key = JSON.stringify({ request, tick });
  useEffect(() => {
    let live = true;
    setRun((previous) => ({ view: previous.view, running: true }));
    const timer = setTimeout(() => {
      const { request: body } = JSON.parse(key) as { request: RunRequest };
      api<OptimizerRunView>("POST", "/api/optimizer/run", { body }).then(
        (view) => live && setRun({ view, running: false }),
        (failure) => live && setRun({ error: messageOf(failure), running: false }),
      );
    }, RUN_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return run;
}

function HowItChooses({ requiredP }: { requiredP: number | undefined }) {
  return (
    <Card title="How the optimizer chooses">
      <ol className="steps">
        <li>
          <strong>Candidates.</strong> It builds every mix of the products you picked, in steps of
          10 points (20 points with 5 or 6 products). A mix with a product over your maximum is
          dropped.
        </li>
        <li>
          <strong>Same markets.</strong> Every mix runs on the same{" "}
          <TermPopover term="simulated">simulated markets</TermPopover>, so the mixes are compared
          fairly.
        </li>
        <li>
          <strong>Feasibility filter.</strong> It keeps the mixes whose chance of success reaches
          the <TermPopover term="required">probability the goal must reach</TermPopover>
          {requiredP === undefined ? "" : `, ${formatPercent(requiredP)} for this goal`}. If no mix
          reaches it, it shows the mix with the highest chance and says so.
        </li>
        <li>
          <strong>Criterion.</strong> Among the mixes it kept, it picks one by the criterion you
          chose:
          <ul>
            {CRITERIA.map((criterion) => (
              <li key={criterion}>
                <strong>{CRITERION_RULES[criterion].name}.</strong>{" "}
                {CRITERION_RULES[criterion].text}
              </li>
            ))}
          </ul>
        </li>
      </ol>
    </Card>
  );
}

function Controls({
  goals,
  goal,
  onGoal,
  isPension,
  request,
  products,
  onChange,
}: {
  goals: readonly GoalListRow[];
  goal: GoalListRow;
  onGoal: (id: string) => void;
  isPension: boolean;
  request: RunRequest;
  products: readonly Product[];
  onChange: (changes: Partial<RunRequest>) => void;
}) {
  const standard = defaultCriterion(goal.priority);
  const picked = new Set(request.products);
  const toggle = (id: string, on: boolean) =>
    onChange({
      products: products.filter((p) => (p.id === id ? on : picked.has(p.id))).map((p) => p.id),
    });
  return (
    <Card title="Controls">
      <div className="form-grid optimizer-controls">
        <SelectField
          label="Bucket"
          value={goal.id}
          onChange={onGoal}
          options={goals.map((row) => ({ value: row.id, label: row.name }))}
        />
        <SelectField
          label="Mode"
          value={request.mode}
          onChange={(mode) => onChange({ mode: mode as Mode })}
          options={[
            { value: "new", label: "New money only" },
            ...(isPension ? [] : [{ value: "rebalance", label: "Rebalance now" }]),
          ]}
        />
        <SelectField
          label="Criterion"
          value={request.criterion}
          onChange={(criterion) => onChange({ criterion: criterion as OptimizerCriterion })}
          options={CRITERIA.map((criterion) => ({
            value: criterion,
            label: CRITERION_RULES[criterion].name + (criterion === standard ? " (default)" : ""),
          }))}
        />
        <SelectField
          label="Max per product"
          value={request.maxPerProduct === undefined ? NO_CAP : String(request.maxPerProduct)}
          onChange={(cap) => onChange({ maxPerProduct: cap === NO_CAP ? undefined : Number(cap) })}
          options={[
            { value: NO_CAP, label: "No limit" },
            ...CAPS.map((cap) => ({ value: String(cap), label: formatPercent(cap) })),
          ]}
        />
      </div>
      <p className="sub">
        {request.mode === "new"
          ? "New money only: your holdings stay as they are and the mix sets the weights of new contributions. No tax."
          : "Rebalance now: your holdings are sold first, the tax is paid, and the rest is invested in the mix."}
        {isPension ? " The pension bucket cannot be rebalanced." : ""}
      </p>
      <fieldset className="universe">
        <legend>Products to mix (1 to {MAX_PRODUCTS})</legend>
        {products.map((product) => (
          <span key={product.id} className="universe-item">
            <CheckField
              label={product.name}
              checked={picked.has(product.id)}
              onChange={(on) => toggle(product.id, on)}
            />
            <ProductTag regime={product.regime} />
          </span>
        ))}
        {products.length === 0 ? <p className="note">There are no products to mix.</p> : null}
      </fieldset>
      <p className="sub">
        {picked.size === MAX_PRODUCTS ? "Six is the most. Untick a product to pick another." : ""}
      </p>
    </Card>
  );
}

function WeightsAndOutcomes({
  view,
  names,
  unit,
}: {
  view: OptimizerRunView;
  names: ReadonlyMap<string, string>;
  unit: "monthly" | "schedule";
}) {
  const { current, chosen } = view;
  return (
    <>
      <h3 className="block-title">Suggested vs current weights</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Current</th>
            <th className="num">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {weightRows(current, chosen).map((row) => (
            <tr key={row.productId}>
              <th scope="row">{names.get(row.productId) ?? row.productId}</th>
              <td className="num">{formatPercent(row.current)}</td>
              <td className="num">{formatPercent(row.suggested)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="block-title">Outcomes compared</h3>
      <table className="table">
        <thead>
          <tr>
            <th>At the goal date</th>
            <th className="num">Current</th>
            <th className="num">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {outcomeRows(current, chosen).map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="num">{formatAmount(row.current)}</td>
              <td className="num">{formatAmount(row.suggested)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">
              <TermPopover term="prob">Chance of success</TermPopover>
            </th>
            <td className="num">{pVsRequired(current.p, view.requiredP)}</td>
            <td className="num">{pVsRequired(chosen.p, view.requiredP)}</td>
          </tr>
          {chosen.monthlyNeeded === undefined ? null : (
            <tr>
              <th scope="row">
                Needed to reach the <TermPopover term="required">required</TermPopover> chance
              </th>
              <td className="num">–</td>
              <td className="num">{requiredText(chosen.monthlyNeeded, unit)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="sub">
        Net value in euros of the goal date. The target at that date is {formatAmount(view.target)}.
        In the <TermPopover term="badcase">bad case</TermPopover> 1 simulated outcome in 10 ends
        lower; in the <TermPopover term="goodcase">good case</TermPopover> 1 in 10 ends higher.
      </p>
    </>
  );
}

type Asking = { weights: { productId: string; weight: number }[]; flows: boolean };

/** "Use as contribution weights": a preview first, then the write after a click on Confirm. */
function UseWeights({
  goal,
  chosen,
  names,
  onApplied,
}: {
  goal: GoalListRow;
  chosen: MixView;
  names: ReadonlyMap<string, string>;
  onApplied: () => void;
}) {
  const [asking, setAsking] = useState<Asking>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const body = (weights: Asking["weights"], confirm: boolean) => ({
    goalId: goal.id,
    weights,
    confirm,
  });

  const ask = async () => {
    setSaved(false);
    try {
      const { preview } = await api<{ preview: { weights: Asking["weights"]; flows?: unknown[] } }>(
        "POST",
        "/api/optimizer/apply",
        { body: body(chosen.weights, false) },
      );
      setAsking({ weights: preview.weights, flows: preview.flows !== undefined });
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const confirm = async () => {
    if (!asking) return;
    try {
      await api("POST", "/api/optimizer/apply", { body: body(asking.weights, true) });
      setAsking(undefined);
      setSaved(true);
      setError(undefined);
      onApplied();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <div className="apply">
      <Alert message={error} />
      {asking ? (
        <div className="callout" role="alertdialog" aria-label="Confirm the new weights">
          <p>
            Replace the contribution weights of {goal.name} with{" "}
            <strong>{mixText(asking.weights, names)}</strong>?
            {asking.flows ? " The weights are written to the flows of the pension plan." : ""}
          </p>
          <div className="actions">
            <button className="btn btn-primary" type="button" onClick={confirm}>
              Confirm
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => setAsking(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" type="button" onClick={ask}>
          Use as contribution weights
        </button>
      )}
      {saved ? (
        <p className="saved" role="status">
          Saved. The contribution weights of {goal.name} now follow this mix.
        </p>
      ) : null}
    </div>
  );
}

/** Exported for the heading-order test. */
export function Result({
  view,
  goal,
  names,
  isPension,
  onApplied,
}: {
  view: OptimizerRunView;
  goal: GoalListRow;
  names: ReadonlyMap<string, string>;
  isPension: boolean;
  onApplied: () => void;
}) {
  const { chosen } = view;
  return (
    <Card title="Suggested mix">
      <div className="result-head">
        <GoalChip id={goal.id} name={goal.name} slot={goal.slot} />
        <span className="result-mix">{mixText(chosen.weights, names)}</span>
      </div>
      {view.notFeasible ? (
        <p className="alert" role="alert">
          No mix reaches the <TermPopover term="required">required probability</TermPopover> of{" "}
          {formatPercent(view.requiredP)}. The mix with the highest chance of success is shown.
        </p>
      ) : null}
      <p className="callout">
        <strong>Rule that chose this mix: {view.ruleName}.</strong> {view.ruleText}
      </p>
      <p className="callout">{KNOWN_LIMIT}</p>
      <WeightsAndOutcomes view={view} names={names} unit={isPension ? "schedule" : "monthly"} />
      <h3 className="block-title">Switch tax</h3>
      <p className="note">
        {view.mode === "rebalance"
          ? `Selling your holdings now costs ${formatAmount(view.switchTax)} in tax. The outcomes of the suggested mix are after this tax.`
          : "None. New money only: nothing is sold."}
      </p>
      <UseWeights goal={goal} chosen={chosen} names={names} onApplied={onApplied} />
    </Card>
  );
}

/** Exported for the heading-order test. */
export function Exhibits({
  view,
  goal,
  names,
  isPension,
}: {
  view: OptimizerRunView;
  goal: GoalListRow;
  names: ReadonlyMap<string, string>;
  isPension: boolean;
}) {
  const { chosen, top } = view;
  return (
    <>
      <figure className="exhibit">
        <div className="tag">All mixes</div>
        <h2 className="exhibit-title">
          The suggested mix has a {formatPercent(chosen.p)}{" "}
          <TermPopover term="prob">chance of success</TermPopover> and a{" "}
          <TermPopover term="typical">typical case</TermPopover> of {formatAmount(chosen.median)}
        </h2>
        {view.mixes.length === 1 ? (
          <p className="note">{onlyMixSentence(chosen.weights, names)}</p>
        ) : (
          <>
            <p className="unit">
              Each dot is one of {view.mixes.length} mixes. Height is the{" "}
              <TermPopover term="typical">typical case</TermPopover> in euros of the goal date.
            </p>
            <ul className="legend">
              <li>
                <span className="swatch-dot swatch-all" />
                Mix
              </li>
              <li>
                <span className="swatch-dot swatch-current" />
                Current mix
              </li>
              <li>
                <span
                  className="swatch-dot swatch-suggested"
                  style={{ "--slot": `var(--slot${goal.slot})` } as CSSProperties}
                />
                Suggested mix
              </li>
              <li>
                <span className="swatch-required" />
                Required chance
              </li>
            </ul>
            <MixScatter
              view={view}
              slot={goal.slot}
              names={names}
              label="All mixes: chance of success against the typical case"
            />
          </>
        )}
        <figcaption className="source">
          Source: Monte Carlo on your goal, assumptions and seed.
        </figcaption>
      </figure>

      <Card title="Top 10 mixes">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Mix</th>
                <th className="num">Chance of success</th>
                <th className="num">
                  <TermPopover term="badcase">Bad case</TermPopover>
                </th>
                <th className="num">
                  <TermPopover term="typical">Typical case</TermPopover>
                </th>
                <th className="num">
                  <TermPopover term="goodcase">Good case</TermPopover>
                </th>
                {view.criterion === "O5" ? <th className="num">Needed</th> : null}
              </tr>
            </thead>
            <tbody>
              {top.map((mix, index) => (
                <tr
                  key={mixText(mix.weights, names)}
                  className={index === 0 ? "top-chosen" : undefined}
                >
                  <td>{index + 1}</td>
                  <td>{mixText(mix.weights, names)}</td>
                  <td className="num">{formatPercent(mix.p)}</td>
                  <td className="num">{formatAmount(mix.p10)}</td>
                  <td className="num">{formatAmount(mix.median)}</td>
                  <td className="num">{formatAmount(mix.p90)}</td>
                  {view.criterion === "O5" ? (
                    <td className="num">
                      {requiredText(mix.monthlyNeeded ?? null, isPension ? "schedule" : "monthly")}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          Ordered by the rule that chose the mix. The first row is the suggestion.
        </p>
      </Card>
    </>
  );
}

function Workbench({
  goals,
  goal,
  onGoal,
  products,
  allocation,
  pensionGoalId,
}: {
  goals: readonly GoalListRow[];
  goal: GoalListRow;
  onGoal: (id: string) => void;
  products: readonly Product[];
  allocation: readonly AllocationRow[];
  pensionGoalId: string | undefined;
}) {
  const isPension = goal.id === pensionGoalId;
  const eligible = eligibleProducts(products, isPension);
  const [request, setRequest] = useState<RunRequest>(() => ({
    goalId: goal.id,
    products: defaultUniverse(goal.id, allocation, eligible),
    mode: "new",
    criterion: defaultCriterion(goal.priority),
  }));
  const [tick, setTick] = useState(0);
  const run = useRun(request, tick);
  const names = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );
  const change = (changes: Partial<RunRequest>) => setRequest({ ...request, ...changes });

  return (
    <div className="optimizer">
      <Controls
        goals={goals}
        goal={goal}
        onGoal={onGoal}
        isPension={isPension}
        request={request}
        products={eligible}
        onChange={change}
      />
      <HowItChooses requiredP={run.view?.requiredP ?? goal.outlook?.requiredP} />
      <Alert message={run.error} />
      {run.view ? (
        <div aria-busy={run.running}>
          {run.running ? <p className="note">Running the optimizer...</p> : null}
          <Result
            view={run.view}
            goal={goal}
            names={names}
            isPension={isPension}
            onApplied={() => setTick(tick + 1)}
          />
          <Exhibits view={run.view} goal={goal} names={names} isPension={isPension} />
        </div>
      ) : run.running ? (
        <p className="note">Running the optimizer...</p>
      ) : null}
    </div>
  );
}

function Screen({
  list,
  products,
  allocation,
  pensionGoalId,
}: {
  list: GoalListView;
  products: readonly Product[];
  allocation: readonly AllocationRow[];
  pensionGoalId: string | undefined;
}) {
  const [goalId, setGoalId] = useState<string>();
  const goal = list.goals.find((row) => row.id === goalId) ?? list.goals[0];
  return (
    <>
      <div className="tag">Analysis</div>
      <h1 className="title">Optimizer</h1>
      <p className="unit">
        Compare mixes of a bucket's products on the same simulated markets, and see which rule chose
        the result. It only suggests: nothing changes until you confirm.
      </p>
      {goal ? (
        <Workbench
          key={goal.id}
          goals={list.goals}
          goal={goal}
          onGoal={setGoalId}
          products={products}
          allocation={allocation}
          pensionGoalId={pensionGoalId}
        />
      ) : (
        <Card title="Optimizer">
          <p className="note">
            There are no goals. Add one in <a href="#/setup/goals">Setup</a>.
          </p>
        </Card>
      )}
    </>
  );
}

/** Analysis > Optimizer: compares mixes of a bucket's products and applies the chosen weights after a confirmation. */
export function OptimizerScreen() {
  const list = useLoad<GoalListView>("/api/goal-list");
  const products = useLoad<Product[]>("/api/products");
  const allocation = useLoad<AllocationRow[]>("/api/allocation");
  const plan = useLoad<PensionPlan | null>("/api/pension-plan");
  return (
    <Resource loaded={list}>
      {(listData) => (
        <Resource loaded={products}>
          {(productData) => (
            <Resource loaded={allocation}>
              {(allocationData) => (
                <Resource loaded={plan}>
                  {(planData) => (
                    <Screen
                      list={listData}
                      products={productData}
                      allocation={allocationData}
                      pensionGoalId={planData?.goalId}
                    />
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
