import { describe, expect, it } from "vitest";
import { confirmSplit } from "../../engine/split.ts";
import type { ImportRow, ImportState } from "../../engine/transactionImport.ts";
import { previewTransactionImport } from "../../engine/transactionImport.ts";
import { isDuplicateFix, missingFields, productPrefillHref, splitDecision } from "./importState.ts";

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: 2,
  date: "2024-01-15",
  dateText: "2024-01-15",
  isin: "IE00TEST0001",
  title: "ETF TEST",
  type: "buy",
  qty: "10",
  price: "85.5",
  commission: null,
  controvalore: null,
  currency: "EUR",
  fx: null,
  description: "",
  ...over,
});

const STATE: ImportState = {
  products: [{ id: "p1", isin: "IE00TEST0001", ticker: "", name: "ETF", regime: "etf" }],
  goalIds: ["g1"],
  weights: [{ goalId: "g1", productId: "p1", weight: 1 }],
  ledger: [],
  storedTrades: [],
  storedCoupons: [],
  openingAsOf: null,
};

describe("isDuplicateFix", () => {
  it("is true for a row the preview flags as a repeat of another row of the file", () => {
    const [first, second] = previewTransactionImport(
      [row({ rowNumber: 2 }), row({ rowNumber: 3 })],
      STATE,
      {},
    );
    expect(first?.status).toBe("needs fix");
    expect(isDuplicateFix(first)).toBe(true);
    expect(isDuplicateFix(second)).toBe(true);
  });

  it("is false for another needs-fix row and for a ready row", () => {
    const [bad, ready] = previewTransactionImport(
      [row({ rowNumber: 2, qty: null }), row({ rowNumber: 3, price: "90" })],
      STATE,
      {},
    );
    expect(bad?.status).toBe("needs fix");
    expect(isDuplicateFix(bad)).toBe(false);
    expect(isDuplicateFix(ready)).toBe(false);
  });
});

describe("splitDecision", () => {
  it("sends the units of a confirmed split, as confirmed", () => {
    const split = confirmSplit({
      totalUnits: 10,
      commissionCents: 295,
      units: [
        { goalId: "g1", units: 6 },
        { goalId: "g2", units: 4 },
      ],
    });
    expect(splitDecision(split)).toEqual({
      split: {
        confirmed: true,
        units: [
          { goalId: "g1", units: 6 },
          { goalId: "g2", units: 4 },
        ],
      },
    });
  });
});

describe("productPrefillHref", () => {
  it("opens the Products form with the ISIN and the name of the row", () => {
    expect(productPrefillHref(row({ title: "ETF AZIONARIO", name: "ETF AZIONARIO" }))).toBe(
      "#/setup/products?name=ETF+AZIONARIO&isin=IE00TEST0001",
    );
  });

  it("puts a ticker-like identifier in the ticker field, not the ISIN", () => {
    expect(productPrefillHref(row({ isin: "VWCE.MI", ticker: "VWCE.MI", title: "VWCE.MI" }))).toBe(
      "#/setup/products?name=VWCE.MI&ticker=VWCE.MI",
    );
  });
});

describe("missingFields", () => {
  it("names the required columns that are not mapped", () => {
    expect(missingFields({ date: "d", qty: "q" })).toEqual(["product", "price"]);
    expect(missingFields({ date: "d", product: "p", qty: "q", price: "x" })).toEqual([]);
  });
});
