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

  it("a coupon row needs fix, with a plain reason that #30 handles coupons", () => {
    const result = only([row({ type: "coupon", price: null, commission: null })]);
    expect(result.status).toBe("needs fix");
    expect(result.reasons.join(" ")).toMatch(/coupon.*#30/);
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
