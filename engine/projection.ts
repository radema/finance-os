import type { Regime } from "./holdings.ts";
import { pensionFlowsByProduct, pensionSchedule } from "./pension.ts";
import type { PensionPlan } from "./schemas.ts";
import { liquidate, type Zainetto } from "./tax.ts";
import { fromCents } from "./units.ts";

const MONTHS_PER_YEAR = 12;

/** One projection step: a calendar year of the goal, `fraction` of it still to run. */
export type Step = {
  year: number;
  /** 1 for a full year, the fraction `f` for the stub of Y0. */
  fraction: number;
  /** Months of contribution at the end of the step: `r` for the stub, 12 for a full year. */
  months: number;
};

export type TimeGrid = {
  y0: number;
  /** Months left in Y0 after the asOf month. */
  r: number;
  f: number;
  steps: readonly Step[];
  /** Real years from asOf to the goal date (31 December of targetYear). */
  tau: number;
};

/** The spec's time grid. `asOf` is an ISO date, YYYY-MM-DD; the engine never reads the clock. */
export function timeGrid(asOf: string, targetYear: number): TimeGrid {
  const y0 = Number(asOf.slice(0, 4));
  const r = MONTHS_PER_YEAR - Number(asOf.slice(5, 7));
  const f = r / MONTHS_PER_YEAR;
  if (targetYear < y0) return { y0, r, f, steps: [], tau: 0 };

  const steps: Step[] = [{ year: y0, fraction: f, months: r }];
  for (let year = y0 + 1; year <= targetYear; year++) {
    steps.push({ year, fraction: 1, months: MONTHS_PER_YEAR });
  }
  return { y0, r, f, steps, tau: f + (targetYear - y0) };
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
 * Project one goal to its due date along the deterministic path.
 *
 * Liquidation taxes come from `liquidate`. Inside a step the net coupon is added after the growth and before the stamp duty, so the
 * stamp duty is taken on the value that includes the coupon.
 */
export function projectGoal(input: ProjectionInput): GoalProjection {
  const { goal, monthly, products, settings } = input;
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

  const state = new Map<string, { value: number; basis: number }>();
  for (const { productId, value, basis } of input.positions) state.set(productId, { value, basis });
  const weighted = pension ? pension.plan.flows.map((flow) => flow.productId) : shares.keys();
  for (const productId of weighted) {
    if (!state.has(productId)) state.set(productId, { value: 0, basis: 0 });
  }

  for (const step of grid.steps) {
    const phi = step.fraction;
    const yearly =
      step.year === grid.y0
        ? monthly
        : monthly * (1 + goal.contributionGrowth) ** (step.year - grid.y0 - 1);
    const contribution = step.months * yearly;
    const yearFlows = pensionFlows.find((row) => row.year === step.year)?.products;

    for (const [productId, position] of state) {
      const params = products.get(productId);
      if (!params) throw new Error(`No parameters for product ${productId}`);
      const { regime, mu, ter } = params;
      const coupon = regime === "govt" ? (params.couponRate ?? 0) : 0;

      let g = ((1 + mu - coupon) * (1 - ter)) ** phi;
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

      // Pension: that year's flows, the stub being the Y0 row x f. The schedule is in cents.
      const added = yearFlows
        ? fromCents(yearFlows.find((flow) => flow.productId === productId)?.total ?? 0) * phi
        : contribution * (shares.get(productId) ?? 0);
      position.value += added;
      position.basis += added;
      if (regime === "cash") position.basis = position.value;
    }
  }

  const perProduct = [...state].map(([productId, { value, basis }]) => ({
    productId,
    value,
    basis,
  }));
  const { gross, tax, net } = liquidate(
    perProduct.map(({ productId, value, basis }) => {
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
  return {
    tau: grid.tau,
    targetAtGoalDate: goal.target * (1 + settings.inflation) ** grid.tau,
    perProduct,
    gross,
    tax,
    net,
  };
}
