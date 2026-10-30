import type { Regime } from "./holdings.ts";

/** Gross value, with the basis, of one product at the liquidation date. */
export type LiquidationPosition = {
  regime: Regime;
  value: number;
  basis: number;
  /** `etf` only: share of the fund in white-list government bonds. Default 0. */
  whiteListShare?: number;
};

export type Zainetto = {
  /** Loss carried forward, in euros of loss. */
  amount: number;
  /** ISO date, YYYY-MM-DD. A bare year means 31 December of that year. */
  expiry: string;
  goalId: string;
};

export type LiquidationContext = {
  /** ISO date, YYYY-MM-DD. */
  goalDate: string;
  goalId: string;
  zainetto?: Zainetto;
  taxStd: number;
  taxGovt: number;
  /** Year the pension membership started. Needed when a `pension` position is held. */
  firstYear?: number;
};

export type Liquidation = {
  gross: number;
  tax: number;
  net: number;
};

const PENSION_EXIT_MAX = 0.15;
const PENSION_EXIT_MIN = 0.09;
const PENSION_EXIT_STEP = 0.003;
const PENSION_FULL_RATE_YEARS = 15;

/** Exit tax rate on the basis of a pension fund: 15%, minus 0.3% a year after 15 years, floor 9%. */
export function pensionExitRate(targetYear: number, firstYear: number): number {
  const extraYears = Math.max(0, targetYear - firstYear - PENSION_FULL_RATE_YEARS);
  return Math.max(PENSION_EXIT_MIN, PENSION_EXIT_MAX - PENSION_EXIT_STEP * extraYears);
}

function expiryDate(expiry: string): string {
  return expiry.length === 4 ? `${expiry}-12-31` : expiry;
}

/**
 * Tax and net value of a goal's positions at the goal date.
 *
 * Gains are counted in tax euros: gain × the product's own rate. ETF gains are taxed and cannot be
 * offset. Direct and govt gains are summed, then reduced down to 0 by every loss credit of the goal
 * (ETF, direct and govt losses) plus the zainetto credit. Unused credit is lost.
 */
export function liquidate(
  positions: readonly LiquidationPosition[],
  context: LiquidationContext,
): Liquidation {
  const { taxStd, taxGovt } = context;
  const { zainetto } = context;
  const zainettoApplies =
    zainetto !== undefined &&
    zainetto.goalId === context.goalId &&
    expiryDate(zainetto.expiry) >= context.goalDate;

  let gross = 0;
  let fixedTax = 0;
  let offsettableTax = 0;
  let credits = zainettoApplies ? zainetto.amount * taxStd : 0;

  for (const { regime, value, basis, whiteListShare = 0 } of positions) {
    gross += value;
    const gain = value - basis;

    if (regime === "pension") {
      if (context.firstYear === undefined)
        throw new Error("firstYear is needed for a pension position");
      const targetYear = Number(context.goalDate.slice(0, 4));
      fixedTax += pensionExitRate(targetYear, context.firstYear) * basis;
    } else if (regime === "etf") {
      const rate = taxStd - (taxStd - taxGovt) * whiteListShare;
      if (gain > 0) fixedTax += gain * rate;
      else credits -= gain * rate;
    } else if (regime === "direct" || regime === "govt") {
      const rate = regime === "direct" ? taxStd : taxGovt;
      if (gain > 0) offsettableTax += gain * rate;
      else credits -= gain * rate;
    }
  }

  const tax = fixedTax + Math.max(0, offsettableTax - credits);
  return { gross, tax, net: gross - tax };
}
