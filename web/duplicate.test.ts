import { describe, expect, it } from "vitest";
import type { CashFlowEvent, Goal, Product, Transaction } from "../engine/schemas.ts";
import { copyOfEvent, copyOfGoal, copyOfProduct, copyOfTransaction } from "./duplicate.ts";

const product: Product = {
  id: "p1",
  name: "Sample World Equity ETF",
  isin: "IE00B4L5Y983",
  assetClass: "Equity",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.06,
  volatility: 0.15,
  ter: 0.002,
  maturity: null,
  couponRate: 0,
  zeroCommission: false,
  priceSource: "manual",
  ticker: "SWDA",
};

const goal: Goal = {
  id: "g1",
  name: "House",
  priority: "Need",
  targetCents: 20_000_000,
  targetYear: 2032,
  contributionGrowth: 0.02,
  minProb: 0.9,
  countsTowardFi: false,
  plan: [{ fromMonth: "2026-01", monthlyCents: 50_000 }],
};

describe("duplicate copy rules (AC-89)", () => {
  it("copies a product with the name suffixed and no ISIN or ticker", () => {
    expect(copyOfProduct(product)).toEqual({
      ...product,
      name: "Sample World Equity ETF (copy)",
      isin: "",
      ticker: "",
    });
  });

  it("copies a goal with the name suffixed and the rest kept", () => {
    expect(copyOfGoal(goal)).toEqual({ ...goal, name: "House (copy)" });
  });

  it("copies an event into the next year, text unchanged", () => {
    const event: CashFlowEvent = { year: 2028, label: "New car", amount: -1_500_000 };
    expect(copyOfEvent(event)).toEqual({ year: 2029, label: "New car", amount: -1_500_000 });
  });

  it("copies a transaction dated today, the other data unchanged", () => {
    const buy: Transaction = {
      id: "t1",
      date: "2026-03-15",
      goalId: "g1",
      productId: "p1",
      type: "buy",
      amountCents: 150_050,
      price: 98.4,
      commissionCents: 295,
      qty: 15.2,
      note: "",
    };
    expect(copyOfTransaction(buy, "2026-11-06")).toEqual({ ...buy, date: "2026-11-06" });
  });
});
