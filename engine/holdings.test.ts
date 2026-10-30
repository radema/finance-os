import { describe, expect, it } from "vitest";
import { holdingsAt, type LedgerRow, unitPrice } from "./holdings.ts";

// AC-12 ledger: buy 10 @ 100 (commission 2.95), buy 10 @ 120, sell 5, buy 5 @ 90,
// split over two buckets (goal A and goal B). Dates are one per step.
const ledger: LedgerRow[] = [
  {
    date: "2026-01-10",
    goalId: "A",
    productId: "etf",
    type: "buy",
    qty: 10,
    price: 100,
    commission: 2.95,
  },
  { date: "2026-02-10", goalId: "B", productId: "etf", type: "buy", qty: 10, price: 120 },
  { date: "2026-03-10", goalId: "A", productId: "etf", type: "sell", qty: -5, price: 130 },
  { date: "2026-04-10", goalId: "B", productId: "etf", type: "buy", qty: 5, price: 90 },
];
const steps = [
  { date: "2026-01-10", pmc: 100.295, accountUnits: 10, a: 10, b: 0 },
  { date: "2026-02-10", pmc: 110.1475, accountUnits: 20, a: 10, b: 10 },
  { date: "2026-03-10", pmc: 110.1475, accountUnits: 15, a: 5, b: 10 },
  { date: "2026-04-10", pmc: 105.110625, accountUnits: 20, a: 5, b: 15 },
];

describe("holdingsAt", () => {
  it.each(steps)("PMC and units after $date", ({ date, pmc, accountUnits, a, b }) => {
    const h = holdingsAt(ledger, date);
    expect(h.pmc.get("etf")).toBeCloseTo(pmc, 9);
    expect(h.accountUnits.get("etf")).toBe(accountUnits);
    expect(h.units.get("A")?.get("etf") ?? 0).toBe(a);
    expect(h.units.get("B")?.get("etf") ?? 0).toBe(b);
  });

  it("keeps the units per bucket equal to the account units after every step", () => {
    for (const { date } of steps) {
      const h = holdingsAt(ledger, date);
      let sum = 0;
      for (const products of h.units.values()) sum += products.get("etf") ?? 0;
      expect(sum).toBe(h.accountUnits.get("etf"));
    }
  });

  it("leaves the PMC unchanged on a sell", () => {
    const before = holdingsAt(ledger, "2026-02-10").pmc.get("etf");
    const after = holdingsAt(ledger, "2026-03-10").pmc.get("etf");
    expect(after).toBe(before);
  });

  it("changes neither units nor PMC on a coupon row", () => {
    const withCoupon: LedgerRow[] = [
      ...ledger,
      { date: "2026-05-10", goalId: "A", productId: "etf", type: "coupon", qty: 0, price: 0 },
    ];
    const before = holdingsAt(ledger, "2026-05-10");
    const after = holdingsAt(withCoupon, "2026-05-10");
    expect(after.pmc).toEqual(before.pmc);
    expect(after.accountUnits).toEqual(before.accountUnits);
    expect(after.units).toEqual(before.units);
  });

  it("ignores rows after the date and counts rows on the date", () => {
    const h = holdingsAt(ledger, "2026-02-09");
    expect(h.accountUnits.get("etf")).toBe(10);
    expect(holdingsAt(ledger, "2026-02-10").accountUnits.get("etf")).toBe(20);
  });

  it("applies rows in date order, and in ledger order on equal dates", () => {
    const shuffled: LedgerRow[] = [ledger[1], ledger[0]] as LedgerRow[];
    expect(holdingsAt(shuffled, "2026-02-10").pmc.get("etf")).toBeCloseTo(110.1475, 9);
    const sameDay: LedgerRow[] = [
      { date: "2026-01-10", goalId: "A", productId: "etf", type: "buy", qty: 10, price: 100 },
      { date: "2026-01-10", goalId: "A", productId: "etf", type: "sell", qty: -10, price: 100 },
      { date: "2026-01-10", goalId: "A", productId: "etf", type: "buy", qty: 5, price: 80 },
    ];
    const h = holdingsAt(sameDay, "2026-01-10");
    expect(h.accountUnits.get("etf")).toBe(5);
    expect(h.pmc.get("etf")).toBe(80);
  });

  it("treats a pension contribution and an opening like a buy", () => {
    const rows: LedgerRow[] = [
      { date: "2026-01-01", goalId: "A", productId: "fund", type: "opening", qty: 10, price: 50 },
      {
        date: "2026-02-01",
        goalId: "A",
        productId: "fund",
        type: "pensionContribution",
        qty: 10,
        price: 60,
      },
    ];
    const h = holdingsAt(rows, "2026-02-01");
    expect(h.pmc.get("fund")).toBe(55);
    expect(h.accountUnits.get("fund")).toBe(20);
  });
});

describe("oversold position", () => {
  it("keeps the PMC finite when a buy brings the units back to exactly 0", () => {
    const rows: LedgerRow[] = [
      { date: "2026-01-01", goalId: "A", productId: "etf", type: "buy", qty: 10, price: 100 },
      { date: "2026-02-01", goalId: "A", productId: "etf", type: "sell", qty: -15, price: 110 },
      { date: "2026-03-01", goalId: "A", productId: "etf", type: "buy", qty: 5, price: 90 },
    ];
    const h = holdingsAt(rows, "2026-03-01");
    expect(h.accountUnits.get("etf")).toBe(0);
    expect(h.pmc.get("etf")).toBe(100);
  });
});

describe("unitPrice", () => {
  it("divides the quoted price by 100 for govt", () => {
    expect(unitPrice("govt", 98.5)).toBe(0.985);
  });

  it.each(["etf", "direct", "cash", "pension"] as const)(
    "returns the quoted price for %s",
    (regime) => {
      expect(unitPrice(regime, 98.5)).toBe(98.5);
    },
  );
});
