import type { Regime } from "./holdings.ts";
import { type PensionYearFlows, pensionFlowsByProduct, pensionSchedule } from "./pension.ts";
import type { PensionPlan } from "./schemas.ts";
import { type Liquidation, liquidate, type Zainetto } from "./tax.ts";
import { type Step, type TimeGrid, timeGrid } from "./timeGrid.ts";
import { fromCents } from "./units.ts";

/**
 * What a plain goal contributes in one step: `months` of the monthly amount. The stub of Y0 uses the
 * amount as is; full year k (k = 1 for Y0 + 1) grows it by (1 + growth)^(k - 1).
 */
export function stepContribution(step: Step, y0: number, monthly: number, growth: number): number {
  const yearly = step.year === y0 ? monthly : monthly * (1 + growth) ** (step.year - y0 - 1);
  return step.months * yearly;
}

/** Today's `target` grown by `inflation` over `tau` real years; `tau` is 0 for a goal already due. */
export function targetAtGoalDate(target: number, inflation: number, tau: number): number {
  return target * (1 + inflation) ** tau;
}

/** Rescale non-negative weights to shares that sum to 1. All weights 0 gives all shares 0. */
export function normaliseWeights(weights: ReadonlyMap<string, number>): Map<string, number> {
  let sum = 0;
  for (const w of weights.values()) sum += w;
  const shares = new Map<string, number>();
  for (const [id, w] of weights) shares.set(id, sum > 0 ? w / sum : 0);
  return shares;
}

export type ProductParams = {
  regime: Regime;
  /** Expected yearly return μ. */
  mu: number;
  ter: number;
  /** Govt bonds only; default 0. */
  couponRate?: number;
  /** `etf` only; default 0. */
  whiteListShare?: number;
};

export type Position = {
  productId: string;
  value: number;
  basis: number;
};

export type ProjectionSettings = {
  inflation: number;
  bollo: number;
  taxStd: number;
  taxGovt: number;
  pensionTax: number;
  zainetto?: Zainetto;
};

export type ProjectionInput = {
  /** ISO date, YYYY-MM-DD. */
  asOf: string;
  goal: {
    id: string;
    targetYear: number;
    /** In today's euros. */
    target: number;
    contributionGrowth: number;
  };
  /** The monthly amount in force at asOf; plan history is resolved by the caller. */
  monthly: number;
  positions: readonly Position[];
  /** Parameters by product id. Every position and every weighted product needs an entry. */
  products: ReadonlyMap<string, ProductParams>;
  /** Contribution weights by product id, in any scale. */
  weights: ReadonlyMap<string, number>;
  settings: ProjectionSettings;
  /** Year the pension membership started. Needed when the goal holds a `pension` product. */
  firstYear?: number;
  /**
   * The pension goal's plan, in cents as stored. When set, the goal's contributions come from the
   * pension schedule split by the plan's flows: `monthly`, `contributionGrowth` and `weights` are
   * not used.
   */
  pension?: {
    plan: PensionPlan;
    deductionCapCents: number;
    /** Voluntary contributions already made this year, in cents. */
    voluntaryYtd: number;
  };
};

export type ProductProjection = {
  productId: string;
  value: number;
  basis: number;
};

/** The goal at its due date: gross value, liquidation tax and net value. */
export type GoalProjection = {
  tau: number;
  targetAtGoalDate: number;
  perProduct: ProductProjection[];
  gross: number;
  tax: number;
  net: number;
};

/**
 * The growth factor of one product in one step, before the cash and pension yield tax and the
 * stamp duty. The deterministic rule and the Monte Carlo rule differ only here.
 *
 * @param productId The product.
 * @param params Its parameters.
 * @param stepIndex 0-based index of the step in the time grid.
 * @param phi The step's fraction: f for the stub, else 1.
 */
export type GrowthRule = (
  productId: string,
  params: ProductParams,
  stepIndex: number,
  phi: number,
) => number;

/** The growth factor of the deterministic path: ((1 + mu - c)(1 - TER))^phi. */
const deterministicGrowth: GrowthRule = (_productId, params, _stepIndex, phi) => {
  const coupon = params.regime === "govt" ? (params.couponRate ?? 0) : 0;
  return ((1 + params.mu - coupon) * (1 - params.ter)) ** phi;
};

type OpeningPosition = { productId: string; params: ProductParams } & Position;

/** What a path needs that does not change between paths: the grid, the flows and the opening state. */
export type PathPlan = {
  grid: TimeGrid;
  /** Plain-goal contribution of each step. */
  contributions: readonly number[];
  pensionFlows: readonly PensionYearFlows[];
  shares: ReadonlyMap<string, number>;
  opening: readonly OpeningPosition[];
};

/** Resolve everything about a goal's projection that the paths share. */
export function preparePath(input: ProjectionInput): PathPlan {
  const { goal, monthly, products } = input;
  const grid = timeGrid(input.asOf, goal.targetYear);
  const { pension } = input;
  const shares = normaliseWeights(pension ? new Map() : input.weights);
  const pensionFlows = pension
    ? pensionFlowsByProduct(
        pensionSchedule(
          pension.plan,
          { pensionDeductionCapCents: pension.deductionCapCents },
          input.asOf,
          pension.voluntaryYtd,
          grid.steps.length,
        ),
        pension.plan.flows,
      )
    : [];

  const state = new Map<string, Position>();
  for (const position of input.positions) state.set(position.productId, { ...position });
  const weighted = pension ? pension.plan.flows.map((flow) => flow.productId) : shares.keys();
  for (const productId of weighted) {
    if (!state.has(productId)) state.set(productId, { productId, value: 0, basis: 0 });
  }
  const opening = [...state.values()].map((position) => {
    const params = products.get(position.productId);
    if (!params) throw new Error(`No parameters for product ${position.productId}`);
    return { ...position, params };
  });

  return {
    grid,
    contributions: grid.steps.map((step) =>
      stepContribution(step, grid.y0, monthly, goal.contributionGrowth),
    ),
    pensionFlows,
    shares,
    opening,
  };
}

/**
 * Run one path of a prepared goal. `growth` supplies each product's growth factor; everything
 * else in the step is the deterministic rule. After every step `afterStep` sees the positions.
 *
 * @returns The positions at the goal date.
 */
export function runPath(
  plan: PathPlan,
  settings: ProjectionSettings,
  growth: GrowthRule,
  afterStep?: (stepIndex: number, positions: readonly ProductProjection[]) => void,
): ProductProjection[] {
  const state = plan.opening.map((position) => ({ ...position }));

  for (const [stepIndex, step] of plan.grid.steps.entries()) {
    const phi = step.fraction;
    const contribution = plan.contributions[stepIndex] ?? 0;
    const yearFlows = plan.pensionFlows.find((row) => row.year === step.year)?.products;

    for (const position of state) {
      const { productId, params } = position;
      const { regime } = params;
      const coupon = regime === "govt" ? (params.couponRate ?? 0) : 0;

      let g = growth(productId, params, stepIndex, phi);
      if (regime === "cash" && g > 1) g = 1 + (g - 1) * (1 - settings.taxStd);
      if (regime === "pension") g = 1 + (g - 1) * (1 - settings.pensionTax);

      const netCoupon = coupon * phi * position.value * (1 - settings.taxGovt);
      position.value = position.value * g + netCoupon;
      position.basis += netCoupon;

      if (regime !== "pension") {
        const stampDuty = settings.bollo * phi * position.value;
        position.value -= stampDuty;
        position.basis = Math.max(0, position.basis - stampDuty);
      }

      // Pension: that year's flows. Work is the Y0 row x f; voluntary is already the stub. The schedule is in cents.
      const flow = yearFlows?.find((candidate) => candidate.productId === productId);
      const added = yearFlows
        ? fromCents((flow?.work ?? 0) * phi + (flow?.voluntary ?? 0))
        : contribution * (plan.shares.get(productId) ?? 0);
      position.value += added;
      // The non-deducted part of the year, Y0 too, is left out of the exit-tax basis in full. It is
      // voluntary money; in Y0 it can be money already in the opening basis, so the basis floors at 0.
      position.basis = Math.max(0, position.basis + added - fromCents(flow?.nonDeducted ?? 0));
      if (regime === "cash") position.basis = position.value;
    }
    afterStep?.(stepIndex, state);
  }

  return state.map(({ productId, value, basis }) => ({ productId, value, basis }));
}

/** Liquidate positions at the goal date with the goal's tax context. */
export function liquidateGoal(
  input: ProjectionInput,
  positions: readonly ProductProjection[],
): Liquidation {
  const { goal, products, settings } = input;
  return liquidate(
    positions.map(({ productId, value, basis }) => {
      const params = products.get(productId);
      return {
        regime: params?.regime ?? "etf",
        value,
        basis,
        whiteListShare: params?.whiteListShare,
      };
    }),
    {
      goalDate: `${goal.targetYear}-12-31`,
      goalId: goal.id,
      zainetto: settings.zainetto,
      taxStd: settings.taxStd,
      taxGovt: settings.taxGovt,
      firstYear: input.firstYear,
    },
  );
}

/**
 * Project one goal to its due date along the deterministic path.
 *
 * Liquidation taxes come from `liquidate`. Inside a step the net coupon is added after the growth and before the stamp duty, so the
 * stamp duty is taken on the value that includes the coupon.
 */
export function projectGoal(input: ProjectionInput): GoalProjection {
  const plan = preparePath(input);
  const perProduct = runPath(plan, input.settings, deterministicGrowth);
  const { gross, tax, net } = liquidateGoal(input, perProduct);
  return {
    tau: plan.grid.tau,
    targetAtGoalDate: targetAtGoalDate(input.goal.target, input.settings.inflation, plan.grid.tau),
    perProduct,
    gross,
    tax,
    net,
  };
}
