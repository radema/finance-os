import { describe, expect, it } from "vitest";
import type { ImportTable } from "./importMapping.ts";
import {
  guessRecordMapping,
  mapRecordRows,
  missingRecordFields,
  previewGoalImport,
  previewProductImport,
} from "./recordImport.ts";
import type { Goal, Product } from "./schemas.ts";

const table = (headers: string[], ...rows: string[][]): ImportTable => ({
  headers,
  rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
});
const settings = { decimal: "point", dateFormat: "auto" } as const;

const PRODUCT_HEADERS = ["Name", "ISIN", "Asset class", "Regime", "Exp return", "Vol", "TER"];
const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "World ETF",
  isin: "IE00TEST0001",
  assetClass: "Equity",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.05,
  volatility: 0.15,
  ter: 0.002,
  maturity: null,
  couponRate: 0,
  zeroCommission: false,
  priceSource: "manual",
  ticker: "",
  ...over,
});
const productRows = (headers: string[], ...rows: string[][]) =>
  mapRecordRows(table(headers, ...rows), "products", {
    columnMap: guessRecordMapping(headers, "products"),
    ...settings,
  });

describe("guessRecordMapping", () => {
  it("matches product and goal headers by alias", () => {
    expect(guessRecordMapping(PRODUCT_HEADERS, "products")).toEqual({
      name: "Name",
      isin: "ISIN",
      assetClass: "Asset class",
      regime: "Regime",
      expReturn: "Exp return",
      volatility: "Vol",
      ter: "TER",
    });
    expect(guessRecordMapping(["Nome", "Priorita", "Target", "Anno"], "goals")).toEqual({
      name: "Nome",
      priority: "Priorita",
      target: "Target",
      targetYear: "Anno",
    });
  });
});

describe("missingRecordFields", () => {
  it("asks for a name or an ISIN for products and a name for goals", () => {
    expect(missingRecordFields("products", {})).toEqual(["name or isin"]);
    expect(missingRecordFields("products", { isin: "ISIN" })).toEqual([]);
    expect(missingRecordFields("goals", { isin: "x" })).toEqual(["name"]);
    expect(missingRecordFields("goals", { name: "Goal" })).toEqual([]);
  });
});

describe("previewProductImport", () => {
  it("creates a product from percent cells with the units of the Setup screen", () => {
    const rows = productRows(PRODUCT_HEADERS, [
      "Gold ETC",
      "IE00TEST0009",
      "gold/commodities",
      "ETF",
      "3.5%",
      "18",
      "0.4",
    ]);
    const [row] = previewProductImport(rows, []);
    expect(row).toMatchObject({ status: "new", name: "Gold ETC", changed: [], matchId: null });
    expect(row?.input).toMatchObject({
      assetClass: "Gold/Commodities",
      regime: "etf",
      expReturn: 0.035,
      volatility: 0.18,
      ter: 0.004,
      isin: "IE00TEST0009",
    });
  });

  it("flags the second run of the same rows as unchanged", () => {
    const rows = productRows(PRODUCT_HEADERS, [
      "World ETF",
      "IE00TEST0001",
      "Equity",
      "etf",
      "5",
      "15",
      "0.2",
    ]);
    expect(previewProductImport(rows, [product()]).map((r) => r.status)).toEqual(["unchanged"]);
  });

  it("matches by ISIN first, then by exact name, and updates only the mapped columns", () => {
    const existing = [product(), product({ id: "p2", name: "Bond ETF", isin: "", ticker: "BND" })];
    const rows = productRows(
      ["ISIN", "Name", "TER"],
      ["IE00TEST0001", "Renamed ETF", "0.5"],
      ["", "Bond ETF", "0.1"],
    );
    const [byIsin, byName] = previewProductImport(rows, existing);
    expect(byIsin).toMatchObject({ status: "updated", matchId: "p1", changed: ["name", "ter"] });
    expect(byIsin?.input).toMatchObject({ assetClass: "Equity", expReturn: 0.05, ter: 0.005 });
    expect(byName).toMatchObject({ status: "updated", matchId: "p2", changed: ["ter"] });
    expect(byName?.input).toMatchObject({ ticker: "BND", isin: "" });
  });

  it("leaves a blank cell unchanged", () => {
    const rows = productRows(["Name", "TER", "Ticker"], ["World ETF", "", ""]);
    expect(previewProductImport(rows, [product({ ticker: "SWDA" })])[0]).toMatchObject({
      status: "unchanged",
    });
  });

  it("does not match a blank ISIN to a product with a blank ISIN", () => {
    const rows = productRows(
      ["Name", "ISIN", "Asset class", "Regime", "Exp return", "Vol", "TER"],
      ["Other", "", "Cash", "cash", "1", "0", "0"],
    );
    const [row] = previewProductImport(rows, [product({ id: "p2", name: "Bond", isin: "" })]);
    expect(row).toMatchObject({ status: "new" });
  });

  it("gives needs fix with a reason for an invalid or missing value, and never matches it", () => {
    const rows = productRows(
      PRODUCT_HEADERS,
      ["A", "", "Stocks", "etf", "5", "15", "0.2"],
      ["B", "", "Equity", "etf", "abc", "15", "0.2"],
      ["C", "", "Equity", "etf", "5", "15", ""],
      ["World ETF", "IE00TEST0001", "Equity", "etf", "5", "300", "0.2"],
    );
    const result = previewProductImport(rows, [product()]);
    expect(result.map((r) => r.status)).toEqual(Array(4).fill("needs fix"));
    expect(result[0]?.reason).toMatch(/assetClass/);
    expect(result[1]?.reason).toMatch(/expReturn.*not a number/);
    expect(result[2]?.reason).toMatch(/ter.*required/);
    expect(result[3]?.reason).toMatch(/volatility/);
    expect(result.every((r) => r.input === null)).toBe(true);
  });

  it("refuses the provider for a BTP or a pension fund", () => {
    const rows = productRows(
      [...PRODUCT_HEADERS, "Price source"],
      ["BTP", "", "Govt bonds", "govt", "3", "5", "0", "provider"],
    );
    expect(previewProductImport(rows, [])[0]).toMatchObject({ status: "needs fix" });
  });

  it("reads maturity from a full date and flags a repeat of an earlier row", () => {
    const rows = productRows(
      [...PRODUCT_HEADERS, "Maturity"],
      ["BTP 2030", "", "Govt bonds", "govt", "3", "5", "0", "2030-03-01"],
      ["BTP 2030", "", "Govt bonds", "govt", "3", "5", "0", "2030-03-01"],
    );
    const [first, second] = previewProductImport(rows, []);
    expect(first?.input).toMatchObject({ maturity: "2030-03" });
    expect(second).toMatchObject({ status: "needs fix" });
    expect(second?.reason).toMatch(/row 2/);
  });

  it("reads the flag cells yes and no and refuses anything else", () => {
    const headers = [...PRODUCT_HEADERS, "Zero commission"];
    const base = ["X", "", "Equity", "etf", "5", "15", "0.2"];
    const [yes, no, bad] = previewProductImport(
      productRows(
        headers,
        [...base, "yes"],
        [...base.slice(0, 0), "Y", "", "Equity", "etf", "5", "15", "0.2", "No"],
        ["Z", ...base.slice(1), "maybe"],
      ),
      [],
    );
    expect(yes?.input).toMatchObject({ zeroCommission: true });
    expect(no?.input).toMatchObject({ zeroCommission: false });
    expect(bad).toMatchObject({ status: "needs fix" });
  });
});

describe("previewGoalImport", () => {
  const goal = (over: Partial<Goal> = {}): Goal => ({
    id: "g1",
    name: "House",
    priority: "Need",
    targetCents: 20_000_000,
    targetYear: 2035,
    contributionGrowth: 0.02,
    minProb: null,
    countsTowardFi: false,
    plan: [],
    ...over,
  });
  const goalRows = (headers: string[], ...rows: string[][]) =>
    mapRecordRows(table(headers, ...rows), "goals", {
      columnMap: guessRecordMapping(headers, "goals"),
      decimal: "comma",
      dateFormat: "auto",
    });
  const HEADERS = ["Name", "Priority", "Target", "Target year", "Contribution growth", "Min prob"];

  it("creates a goal with the target in cents and the rates as fractions", () => {
    const [row] = previewGoalImport(
      goalRows(HEADERS, ["Car", "want", "15.000,50", "2030", "2,5", "75"]),
      [],
    );
    expect(row).toMatchObject({ status: "new", name: "Car" });
    expect(row?.input).toMatchObject({
      priority: "Want",
      targetCents: 1_500_050,
      targetYear: 2030,
      contributionGrowth: 0.025,
      minProb: 0.75,
    });
  });

  it("matches by exact name: unchanged, then updated on a changed target", () => {
    const same = goalRows(HEADERS, ["House", "Need", "200000", "2035", "2", ""]);
    expect(previewGoalImport(same, [goal()])[0]).toMatchObject({ status: "unchanged" });
    const changed = goalRows(["Name", "Target"], ["House", "250000"]);
    expect(previewGoalImport(changed, [goal()])[0]).toMatchObject({
      status: "updated",
      matchId: "g1",
      changed: ["targetCents"],
    });
  });

  it("flags a bad priority and a missing year, and a repeated name", () => {
    const rows = goalRows(
      HEADERS,
      ["A", "Must", "1000", "2030", "0", ""],
      ["B", "Need", "1000", "", "0", ""],
      ["C", "Need", "1000", "2030", "0", ""],
      ["C", "Need", "1000", "2030", "0", ""],
    );
    const result = previewGoalImport(rows, []);
    expect(result.map((r) => r.status)).toEqual(["needs fix", "needs fix", "new", "needs fix"]);
    expect(result[0]?.reason).toMatch(/priority/);
    expect(result[1]?.reason).toMatch(/targetYear.*required/);
  });
});
