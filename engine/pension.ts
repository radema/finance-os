// The pension schedule and the split of its yearly flows by product. Pure; money is in cents and
// is never rounded here.

import type { PensionFlow, PensionPlan, Settings } from "./schemas.ts";
import { PENSION_FLOWS } from "./schemas.ts";
import { timeGrid } from "./timeGrid.ts";

/** The projection runs 40 years (t = 0 ... 40 in the spec). */
const DEFAULT_YEARS = 40;

/** One year of the schedule. `refund` is a cash inflow in `refundYear`. */
export type PensionYear = {
  year: number;
  ral: number;
  tfr: number;
  worker: number;
  employer: number;
  /** The full-year scheduled voluntary amount, in Y0 too: "row x f" gives the stub. */
  voluntary: number;
  /**
   * The voluntary amount still to be paid in the year: the whole `voluntary` in a full year, the
   * stub in Y0 (a given amount x f; to cap, the rest of the room after the YTD). Not scaled again.
   */
  voluntaryAhead: number;
  /** The voluntary amount of the tax year. In Y0: the actual YTD plus `voluntaryAhead`. Feeds only `deductible` and `refund`. */
  voluntaryTaxYear: number;
  deductible: number;
  /** The part of worker + employer + `voluntaryTaxYear` above cap + extra. Not deductible, and left out of the exit-tax basis. */
  nonDeducted: number;
  refund: number;
  refundYear: number;
};

/** The flows a product takes in the plan: those with a share above 0, in `PENSION_FLOWS` order. */
export function flowsTaken(
  plan: Pick<PensionPlan, "flows"> | null | undefined,
  productId: string,
): PensionFlow["flow"][] {
  return PENSION_FLOWS.filter((kind) =>
    plan?.flows.some((f) => f.productId === productId && f.flow === kind && f.pct > 0),
  );
}

/** How many schedule rows run from Y0 = year(asOf) through the goal's target year: 0 when it is due before Y0. */
export function scheduleYears(asOf: string, targetYear: number): number {
  return Math.max(0, targetYear - Number(asOf.slice(0, 4)) + 1);
}

/**
 * The pension schedule, one row per year from Y0 = year(asOf). A plan without `ral` has no rows.
 *
 * The TFR, worker, employer and voluntary fields of the Y0 row are the full-year schedule; the
 * caller scales TFR, worker and employer by the stub fraction f where it needs the rest of the
 * year. The voluntary stub is `voluntaryAhead`, already the amount of the rest of the year. The
 * tax year of Y0 is different again: `voluntaryTaxYear` = `voluntaryYtd` + `voluntaryAhead`. It
 * feeds the deduction and the refund, which the room caps.
 *
 * @param plan The pension plan document.
 * @param settings Settings; only the deduction cap is read.
 * @param asOf ISO date, YYYY-MM-DD.
 * @param voluntaryYtd Voluntary contributions already made this year, in cents.
 * @param years How many years to produce, Y0 first.
 */
export function pensionSchedule(
  plan: PensionPlan,
  settings: Pick<Settings, "pensionDeductionCapCents">,
  asOf: string,
  voluntaryYtd: number,
  years: number = DEFAULT_YEARS,
): PensionYear[] {
  const ral0 = plan.ral;
  if (ral0 === undefined) return [];
  const { y0, f } = timeGrid(asOf, Number(asOf.slice(0, 4)));
  const deductionLimit = settings.pensionDeductionCapCents + plan.extra;

  return Array.from({ length: years }, (_, index) => {
    const year = y0 + index;
    const ral = ral0 * (1 + plan.ralGrowth) ** index;
    const worker = ral * plan.workerPct;
    const employer = ral * plan.employerPct;
    const room = Math.max(0, deductionLimit - worker - employer);
    const scheduled = plan.voluntary ?? room;
    // Y0 to cap fills only what is left of the room; a given amount is paid pro rata (AC-97).
    const stub = plan.voluntary === null ? Math.max(0, room - voluntaryYtd) : scheduled * f;
    const voluntaryAhead = index === 0 ? stub : scheduled;
    const voluntaryTaxYear = index === 0 ? voluntaryYtd + voluntaryAhead : scheduled;
    return {
      year,
      ral,
      tfr: ral * plan.tfrPct,
      worker,
      employer,
      voluntary: scheduled,
      voluntaryAhead,
      voluntaryTaxYear,
      deductible: Math.min(deductionLimit, worker + employer + voluntaryTaxYear),
      nonDeducted: Math.max(0, worker + employer + voluntaryTaxYear - deductionLimit),
      refund: Math.min(voluntaryTaxYear, room) * plan.marginalRate,
      refundYear: year + 1,
    };
  });
}

/**
 * What goes into one product in one year. `work` is TFR + worker + employer, the full-year row
 * (Y0: the caller scales it by f). `voluntary` is the voluntary still to be paid, already the stub in Y0.
 */
export type ProductFlow = {
  productId: string;
  work: number;
  voluntary: number;
  total: number;
  /** This product's share of the year's non-deducted part, by its share of the year's contributions. */
  nonDeducted: number;
};

export type PensionYearFlows = { year: number; products: ProductFlow[] };

/**
 * Split each year's flows by product. The Work flow (TFR + worker + employer) and the Voluntary
 * flow (`voluntaryAhead`) are split separately by each product's pct of that flow, using that
 * year's amounts. The year's non-deducted part follows the products' shares of the year's contributions.
 */
export function pensionFlowsByProduct(
  schedule: readonly PensionYear[],
  flows: readonly PensionFlow[],
): PensionYearFlows[] {
  const productIds = [...new Set(flows.map((flow) => flow.productId))];
  const pct = (productId: string, kind: PensionFlow["flow"]) =>
    flows
      .filter((flow) => flow.productId === productId && flow.flow === kind)
      .reduce((sum, flow) => sum + flow.pct, 0);

  return schedule.map((row) => {
    const amounts = productIds.map((productId) => {
      const work = (row.tfr + row.worker + row.employer) * pct(productId, "Work");
      const voluntary = row.voluntaryAhead * pct(productId, "Voluntary");
      return { productId, work, voluntary, total: work + voluntary };
    });
    const total = amounts.reduce((sum, product) => sum + product.total, 0);
    // Never more than what went into the products, so a basis cannot turn negative.
    const nonDeducted = Math.min(row.nonDeducted, total);
    return {
      year: row.year,
      products: amounts.map((product) => ({
        ...product,
        nonDeducted: total > 0 ? (nonDeducted * product.total) / total : 0,
      })),
    };
  });
}
