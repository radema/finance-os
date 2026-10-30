import type { TransactionType } from "./holdings.ts";
import type { Commission, Product } from "./schemas.ts";

const BEARS_COMMISSION: readonly TransactionType[] = ["buy", "sell"];

/**
 * Estimated commission of a trade, in cents, for an amount in cents.
 *
 * Zero when the product is zero-commission and for every type except buy and sell.
 * `percent`: clamp(rate × amount, min, max). `flat`: the flat fee.
 */
export function estimateCommission(
  commission: Commission,
  product: Pick<Product, "zeroCommission">,
  type: TransactionType,
  amount: number,
): number {
  if (product.zeroCommission || !BEARS_COMMISSION.includes(type)) return 0;
  if (commission.feeModel === "flat") return commission.flatFeeCents;
  return Math.min(Math.max(commission.rate * amount, commission.minCents), commission.maxCents);
}

/**
 * The smallest amount, in cents, below which the fee is a larger share than the plan's rate.
 * `percent`: min / rate (0 when the rate is 0). `flat`: the ticket the user set.
 */
export function minEfficientTicket(commission: Commission): number {
  if (commission.feeModel === "flat") return commission.minTicketCents;
  return commission.rate > 0 ? commission.minCents / commission.rate : 0;
}

/** True when a trade is below the minimum efficient ticket and its product bears commission. */
export function isCostly(
  commission: Commission,
  product: Pick<Product, "zeroCommission">,
  type: TransactionType,
  amount: number,
): boolean {
  return (
    estimateCommission(commission, product, type, amount) > 0 &&
    amount < minEfficientTicket(commission)
  );
}
