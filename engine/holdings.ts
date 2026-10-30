export type Regime = "etf" | "direct" | "govt" | "cash" | "pension";

export type TransactionType = "opening" | "buy" | "sell" | "pensionContribution" | "coupon";

/** One ledger row. Money is in euros as floats; the server converts stored cents before the call. */
export type LedgerRow = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  goalId: string;
  productId: string;
  type: TransactionType;
  /** Signed: a sell is negative, a coupon is 0. */
  qty: number;
  price: number;
  commission?: number;
};

export type Holdings = {
  units: Map<string, Map<string, number>>;
  accountUnits: Map<string, number>;
  pmc: Map<string, number>;
};

/** Price per unit: the quoted price, except govt bonds, which are quoted per 100. */
export function unitPrice(regime: Regime, quotedPrice: number): number {
  return regime === "govt" ? quotedPrice / 100 : quotedPrice;
}

/**
 * Holdings derived from the ledger, up to and including `date`.
 *
 * Rows apply in date order, and in ledger order on equal dates. The account PMC includes the
 * commission in the cost (Fineco's fiscal PMC). A sell and a coupon leave the PMC unchanged.
 * A pension contribution is treated like a buy.
 */
export function holdingsAt(ledger: readonly LedgerRow[], date: string): Holdings {
  const units = new Map<string, Map<string, number>>();
  const accountUnits = new Map<string, number>();
  const pmc = new Map<string, number>();

  const rows = ledger
    .filter((row) => row.date <= date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const { goalId, productId, type, qty, price, commission = 0 } of rows) {
    if (type === "coupon") continue;

    const held = accountUnits.get(productId) ?? 0;
    // A buy that brings an oversold position back to exactly 0 units keeps the PMC as it was.
    if (type !== "sell" && qty > 0 && held + qty !== 0) {
      const cost = (pmc.get(productId) ?? 0) * held + price * qty + commission;
      pmc.set(productId, cost / (held + qty));
    }
    accountUnits.set(productId, held + qty);

    const goalUnits = units.get(goalId) ?? new Map<string, number>();
    goalUnits.set(productId, (goalUnits.get(productId) ?? 0) + qty);
    units.set(goalId, goalUnits);
  }

  return { units, accountUnits, pmc };
}
