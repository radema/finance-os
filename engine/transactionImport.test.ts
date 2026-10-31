import { describe, expect, it } from "vitest";
import { confirmSplit } from "./split.ts";
import {
  type ImportRow,
  type ImportState,
  previewTransactionImport,
  type RowDecision,
} from "./transactionImport.ts";

const WORLD = "p-world";
const BTP = "p-btp";

const state = (over: Partial<ImportState> = {}): ImportState => ({
  products: [
    { id: WORLD, isin: "IE00TEST0001", ticker: "WRLD", name: "World ETF", regime: "etf" },
    { id: BTP, isin: "IT00TEST0003", ticker: "", name: "BTP Test", regime: "govt" },
  ],
  goalIds: ["g1", "g2"],
  weights: [{ goalId: "g1", productId: WORLD, weight: 1 }],
  ledger: [],
  storedTrades: [],
  storedCoupons: [],
  openingAsOf: null,
  ...over,
});

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: 8,
  date: "2024-01-15",
  dateText: "15/01/2024",
  isin: "IE00TEST0001",
  title: "ETF MONDO",
  type: "buy",
  qty: "10",
  price: "85.5",
  commission: "2.95",
  controvalore: "855",
  currency: "EUR",
  fx: "1",
  description: "Compravendita titoli",
  ...over,
});

const preview = (rows: ImportRow[], s = state(), decisions: Record<number, RowDecision> = {}) =>
  previewTransactionImport(rows, s, decisions);

const only = (rows: ImportRow[], s = state(), d: Record<number, RowDecision> = {}) => {
  const [first] = preview(rows, s, d);
  if (!first) throw new Error("no preview row");
  return first;
};

describe("previewTransactionImport statuses (AC-29)", () => {
  it("ready: known product, one bucket by weights", () => {
    const result = only([row()]);
    expect(result.status).toBe("ready");
    expect(result.split?.parts).toEqual([{ goalId: "g1", units: 10, commissionCents: 295 }]);
  });

  it("already in your records: the stored total for the key equals the file's", () => {
    const stored = [
      { date: "2024-01-15", productId: WORLD, priceScaled: 85_500_000, qtyScaled: 6_000_000 },
      { date: "2024-01-15", productId: WORLD, priceScaled: 85_500_000, qtyScaled: 4_000_000 },
    ];
    expect(only([row()], state({ storedTrades: stored })).status).toBe("already in your records");
  });

  it("leaves the rows in the normal flow when the stored total differs and is not zero", () => {
    const stored = [
      { date: "2024-01-15", productId: WORLD, priceScaled: 85_500_000, qtyScaled: 4_000_000 },
    ];
    expect(only([row()], state({ storedTrades: stored })).status).toBe("ready");
  });

  it("already in the opening position: date <= opening asOf", () => {
    const s = state({ openingAsOf: "2024-01-15" });
    expect(only([row()], s).status).toBe("already in the opening position");
    expect(only([row({ date: "2024-01-16" })], s).status).toBe("ready");
  });

  it("treats a missing opening position as no skip", () => {
    expect(only([row()], state({ openingAsOf: null })).status).toBe("ready");
  });

  it("needs a goal: the product is in two buckets and nothing picks one", () => {
    const s = state({
      weights: [
        { goalId: "g1", productId: WORLD, weight: 1 },
        { goalId: "g2", productId: WORLD, weight: 1 },
      ],
    });
    const result = only([row()], s);
    expect(result.status).toBe("needs a goal");
    expect(result.candidates).toEqual(["g1", "g2"]);
    expect(result.split).toBeNull();
  });

  it("product not found: lists the ISIN and title hint", () => {
    const result = only([row({ isin: "XX0000000000", title: "MYSTERY FUND" })]);
    expect(result.status).toBe("product not found");
    expect(result.reasons.join(" ")).toContain("XX0000000000");
    expect(result.reasons.join(" ")).toContain("MYSTERY FUND");
  });

  it("matches a product by ISIN, then ticker, then exact name", () => {
    expect(only([row({ isin: "", ticker: "WRLD" })]).productId).toBe(WORLD);
    expect(only([row({ isin: "", ticker: "", name: "World ETF" })]).productId).toBe(WORLD);
    expect(only([row({ isin: "", ticker: "", name: "world" })]).status).toBe("product not found");
  });
});

describe("needs fix (AC-29)", () => {
  const fixes: [string, Partial<ImportRow>][] = [
    ["non-EUR", { currency: "USD" }],
    ["Cambio not 1", { fx: "1.08" }],
    ["unknown Descrizione", { type: "unknown", description: "Dividendi" }],
    ["unknown Segno on a trade", { type: "unknown", description: "Compravendita titoli" }],
    ["unreadable date", { date: null, dateText: "31/02/2024" }],
    ["missing qty", { qty: null }],
    ["missing price", { price: null }],
  ];
  it.each(fixes)("%s", (_name, over) => {
    const result = only([row(over)]);
    expect(result.status).toBe("needs fix");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("a negative commission needs fix with its own message", () => {
    const result = only([row({ commission: "-2.95" })]);
    expect(result.status).toBe("needs fix");
    expect(result.reasons).toEqual(["commission is negative"]);
    expect(only([row({ commission: "abc" })]).reasons).toEqual(["commission is not a number"]);
  });

  it("a sell with a negative qty is ready: the sign comes from the type", () => {
    const negative = only([row({ type: "sell", qty: "-8" })]);
    const positive = only([row({ type: "sell", qty: "8" })]);
    expect(negative.status).toBe("ready");
    expect(negative.split).toEqual(positive.split);
    expect(only([row({ qty: "0" })]).status).toBe("needs fix");
  });

  it("a duplicate inside the file needs fix until the user confirms it as a real order", () => {
    const rows = [row({ rowNumber: 8 }), row({ rowNumber: 9 })];
    expect(preview(rows).map((r) => r.status)).toEqual(["needs fix", "needs fix"]);
    const confirmed = preview(rows, state(), {
      8: { confirmDuplicate: true },
      9: { confirmDuplicate: true },
    });
    expect(confirmed.map((r) => r.status)).toEqual(["ready", "ready"]);
  });

  it("identical rows already stored re-import as already in your records", () => {
    const stored = [
      { date: "2024-01-15", productId: WORLD, priceScaled: 85_500_000, qtyScaled: 10_000_000 },
      { date: "2024-01-15", productId: WORLD, priceScaled: 85_500_000, qtyScaled: 10_000_000 },
    ];
    const rows = [row({ rowNumber: 8 }), row({ rowNumber: 9 })];
    const result = preview(rows, state({ storedTrades: stored }));
    expect(result.map((r) => r.status)).toEqual([
      "already in your records",
      "already in your records",
    ]);
  });
});

describe("Controvalore warning (AC-29)", () => {
  it("warns on a mismatch and the row stays ready", () => {
    const result = only([row({ controvalore: "900" })]);
    expect(result.status).toBe("ready");
    expect(result.warnings).toHaveLength(1);
  });

  it("accepts qty x price, with the commission added or taken off", () => {
    for (const controvalore of ["855", "857.95", "852.05"]) {
      expect(only([row({ controvalore })]).warnings).toEqual([]);
    }
  });

  it("divides a BTP price by 100", () => {
    const result = only([
      row({ isin: "IT00TEST0003", qty: "3000", price: "98.5", controvalore: "2955" }),
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("splits (AC-30, AC-31)", () => {
  const twoBuckets = state({
    weights: [
      { goalId: "g1", productId: WORLD, weight: 1 },
      { goalId: "g2", productId: WORLD, weight: 1 },
    ],
  });

  it("a confirmed split whose parts sum to the broker qty is ready, with the commission split", () => {
    const result = only([row()], twoBuckets, {
      8: {
        split: {
          confirmed: true,
          units: [
            { goalId: "g1", units: 6 },
            { goalId: "g2", units: 4 },
          ],
        },
      },
    });
    expect(result.status).toBe("ready");
    expect(result.split?.parts).toEqual([
      { goalId: "g1", units: 6, commissionCents: 177 },
      { goalId: "g2", units: 4, commissionCents: 118 },
    ]);
    expect(result.split).toEqual(
      confirmSplit({
        totalUnits: 10,
        commissionCents: 295,
        units: [
          { goalId: "g1", units: 6 },
          { goalId: "g2", units: 4 },
        ],
      }),
    );
  });

  it("a split that is not confirmed is never ready", () => {
    const result = only([row()], twoBuckets, {
      8: { split: { confirmed: false, units: [{ goalId: "g1", units: 10 }] } },
    });
    expect(result.status).toBe("needs a goal");
    expect(result.split).toBeNull();
  });

  it("a split whose parts do not sum to the broker qty is not ready", () => {
    const result = only([row()], twoBuckets, {
      8: { split: { confirmed: true, units: [{ goalId: "g1", units: 6 }] } },
    });
    expect(result.status).toBe("needs a goal");
    expect(result.reasons.join(" ")).toContain("still to assign");
  });

  it("a picked bucket makes the row ready", () => {
    expect(only([row()], twoBuckets, { 8: { goalId: "g2" } }).split?.parts[0]?.goalId).toBe("g2");
  });

  it("a bucket that is not a goal needs a goal", () => {
    expect(only([row()], twoBuckets, { 8: { goalId: "nope" } }).status).toBe("needs a goal");
  });
});

describe("coupon rows (AC-33)", () => {
  const coupon = (over: Partial<ImportRow> = {}) =>
    row({
      rowNumber: 20,
      type: "coupon",
      isin: "IT00TEST0003",
      date: "2024-07-01",
      qty: "100",
      price: null,
      commission: null,
      controvalore: "40.5",
      description: "Stacco Cedole",
      ...over,
    });
  const held = (goalId: string, qty: number, date = "2024-04-15") => ({
    date,
    goalId,
    productId: BTP,
    type: "buy" as const,
    qty,
    price: 0.985,
  });
  const couponState = (over: Partial<ImportState> = {}) =>
    state({ ledger: [held("g1", 60), held("g2", 40)], ...over });

  it("is ready and split 60/40 by units held on the coupon date, summing to the net cash", () => {
    const result = only([coupon()], couponState());
    expect(result.status).toBe("ready");
    expect(result.couponParts).toEqual([
      { goalId: "g1", amountCents: 2430 },
      { goalId: "g2", amountCents: 1620 },
    ]);
    expect(result.split).toBeNull();
    expect(result.productId).toBe(BTP);
  });

  it("counts units bought on the coupon date, not after it", () => {
    const sameDay = couponState({ ledger: [held("g1", 60), held("g2", 40, "2024-07-01")] });
    expect(only([coupon()], sameDay).couponParts).toHaveLength(2);
    const after = couponState({ ledger: [held("g1", 60), held("g2", 40, "2024-07-02")] });
    expect(only([coupon()], after).couponParts).toEqual([{ goalId: "g1", amountCents: 4050 }]);
  });

  it("counts the units of an earlier ready row of the same file", () => {
    const buy = row({
      rowNumber: 9,
      isin: "IT00TEST0003",
      date: "2024-04-15",
      qty: "3000",
      price: "98.5",
      controvalore: "2955",
    });
    const weights = [{ goalId: "g1", productId: BTP, weight: 1 }];
    const [, result] = preview([buy, coupon()], state({ weights }));
    expect(result?.status).toBe("ready");
    expect(result?.couponParts).toEqual([{ goalId: "g1", amountCents: 4050 }]);
  });

  it("does not count a file row that is not ready", () => {
    const buy = row({ rowNumber: 9, isin: "IT00TEST0003", date: "2024-04-15", currency: "USD" });
    const [first, result] = preview([buy, coupon()], state());
    expect(first?.status).toBe("needs fix");
    expect(result?.status).toBe("needs a goal");
  });

  it("needs a goal when no bucket holds the bond, and the user picks one bucket", () => {
    const empty = state({ weights: [{ goalId: "g1", productId: BTP, weight: 1 }] });
    const result = only([coupon()], empty);
    expect(result.status).toBe("needs a goal");
    expect(result.candidates).toEqual(["g1"]);
    expect(result.couponParts).toEqual([]);

    const picked = only([coupon()], empty, { 20: { goalId: "g2" } });
    expect(picked.status).toBe("ready");
    expect(picked.couponParts).toEqual([{ goalId: "g2", amountCents: 4050 }]);
    expect(only([coupon()], empty, { 20: { goalId: "nope" } }).status).toBe("needs a goal");
  });

  it("a bond sold out before the coupon date needs a goal", () => {
    const sold = { ...held("g1", -60, "2024-06-01"), type: "sell" as const };
    expect(only([coupon()], state({ ledger: [held("g1", 60), sold] })).status).toBe("needs a goal");
  });

  it("needs fix without a Controvalore above 0, or with an unknown product", () => {
    expect(only([coupon({ controvalore: null })], couponState()).status).toBe("needs fix");
    expect(only([coupon({ controvalore: "0" })], couponState()).status).toBe("needs fix");
    expect(only([coupon({ isin: "XX0000000000" })], couponState()).status).toBe(
      "product not found",
    );
  });

  it("is skipped on or before the opening date", () => {
    const s = couponState({ openingAsOf: "2024-07-01" });
    expect(only([coupon()], s).status).toBe("already in the opening position");
  });

  it("is already in your records when the stored coupons of that date and product total the same", () => {
    const stored = [
      { date: "2024-07-01", productId: BTP, amountCents: 2430 },
      { date: "2024-07-01", productId: BTP, amountCents: 1620 },
    ];
    expect(only([coupon()], couponState({ storedCoupons: stored })).status).toBe(
      "already in your records",
    );
    const other = [{ date: "2024-07-01", productId: BTP, amountCents: 2430 }];
    expect(only([coupon()], couponState({ storedCoupons: other })).status).toBe("ready");
    const elsewhere = [{ date: "2024-07-02", productId: BTP, amountCents: 4050 }];
    expect(only([coupon()], couponState({ storedCoupons: elsewhere })).status).toBe("ready");
  });
});
