// The pension schedule and the split of its yearly flows by product. Pure; money is in cents and
// is never rounded here.
import { timeGrid } from "./projection.ts";
import type { PensionFlow, PensionPlan, Settings } from "./schemas.ts";

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
  /** The voluntary amount of the tax year. In Y0: the actual YTD plus `voluntary` x f. Feeds only `deductible` and `refund`. */
  voluntaryTaxYear: number;
  deductible: number;
  refund: number;
  refundYear: number;
};

/**
 * The pension schedule, one row per year from Y0 = year(asOf). A plan without `ral` has no rows.
 *
 * Every contribution field of the Y0 row is the full-year schedule; the caller scales the row by
 * the stub fraction f where it needs the rest of the year. The tax year of Y0 is different:
 * `voluntaryTaxYear` = `voluntaryYtd` + `voluntary` x f. It feeds the deduction and the refund,
 * which the room caps.
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
    const voluntaryTaxYear = index === 0 ? voluntaryYtd + scheduled * f : scheduled;
    return {
      year,
      ral,
      tfr: ral * plan.tfrPct,
      worker,
      employer,
      voluntary: scheduled,
      voluntaryTaxYear,
      deductible: Math.min(deductionLimit, worker + employer + voluntaryTaxYear),
      refund: Math.min(voluntaryTaxYear, room) * plan.marginalRate,
      refundYear: year + 1,
    };
  });
}

/** What goes into one product in one year. `work` is TFR + worker + employer. */
export type ProductFlow = {
  productId: string;
  work: number;
  voluntary: number;
  total: number;
};

export type PensionYearFlows = { year: number; products: ProductFlow[] };

/**
 * Split each year's flows by product. The Work flow (TFR + worker + employer) and the Voluntary
 * flow are split separately by each product's pct of that flow, using that year's amounts.
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

  return schedule.map((row) => ({
    year: row.year,
    products: productIds.map((productId) => {
      const work = (row.tfr + row.worker + row.employer) * pct(productId, "Work");
      const voluntary = row.voluntary * pct(productId, "Voluntary");
      return { productId, work, voluntary, total: work + voluntary };
    }),
  }));
}
