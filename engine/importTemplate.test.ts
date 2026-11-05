import { describe, expect, it } from "vitest";
import { parseDelimited } from "./csv.ts";
import { guessMapping, mapRows, TRANSACTION_FIELDS } from "./importMapping.ts";
import { EXAMPLE_ISIN, importTemplate } from "./importTemplate.ts";
import { parsePriceCsv } from "./priceCsv.ts";
import {
  GOAL_FIELDS,
  guessRecordMapping,
  mapRecordRows,
  PRODUCT_FIELDS,
  previewGoalImport,
  previewProductImport,
} from "./recordImport.ts";
import type { ImportState } from "./transactionImport.ts";
import { previewTransactionImport } from "./transactionImport.ts";

const SETTINGS = { decimal: "auto", dateFormat: "auto" } as const;

/** The template as the importers read it: header names and one row of cells. */
function readTemplate(kind: Parameters<typeof importTemplate>[0]) {
  const { rows } = parseDelimited(importTemplate(kind), { delimiter: "auto" });
  const [headers, ...data] = rows as [string[], ...string[][]];
  return {
    headers,
    table: { headers, rows: data.map((cells, i) => ({ rowNumber: i + 2, cells })) },
  };
}

describe("importTemplate (AC-89, #93)", () => {
  it("has one header and one example row per kind, as many cells as headers", () => {
    for (const kind of ["transactions", "prices", "products", "goals"] as const) {
      const { rows } = parseDelimited(importTemplate(kind), { delimiter: "auto" });
      expect(rows).toHaveLength(2);
      expect(rows[1]).toHaveLength((rows[0] as string[]).length);
    }
  });

  it("transactions: the headers are the importer's fields, each one found by the guess", () => {
    const { headers } = readTemplate("transactions");
    expect(headers).toEqual([...TRANSACTION_FIELDS]);
    expect(guessMapping(headers, "transactions")).toEqual(
      Object.fromEntries(TRANSACTION_FIELDS.map((field) => [field, field])),
    );
  });

  it("transactions: the example row is ready when its product is in the data", () => {
    const { headers, table } = readTemplate("transactions");
    const rows = mapRows(
      table,
      { columnMap: guessMapping(headers, "transactions"), ...SETTINGS },
      [],
    );
    const state: ImportState = {
      products: [{ id: "p1", isin: EXAMPLE_ISIN, ticker: "", name: "Example", regime: "etf" }],
      goalIds: ["g1"],
      weights: [{ goalId: "g1", productId: "p1", weight: 1 }],
      ledger: [],
      storedTrades: [],
      storedCoupons: [],
      openingAsOf: null,
    };
    expect(previewTransactionImport(rows, state, {}).map((p) => p.status)).toEqual(["ready"]);
  });

  it("prices: read as the long layout, one price", () => {
    expect(parsePriceCsv(importTemplate("prices"), { ...SETTINGS, delimiter: "auto" })).toEqual([
      { product: EXAMPLE_ISIN, date: "2025-01-31", price: 85.5 },
    ]);
  });

  it.each([
    ["products", PRODUCT_FIELDS],
    ["goals", GOAL_FIELDS],
  ] as const)(
    "%s: the headers are the importer's fields, each one found by the guess",
    (kind, fields) => {
      const { headers } = readTemplate(kind);
      expect(headers).toEqual([...fields]);
      expect(guessRecordMapping(headers, kind)).toEqual(
        Object.fromEntries(fields.map((field) => [field, field])),
      );
    },
  );

  it("products and goals: the example row is a new record", () => {
    const products = readTemplate("products");
    const productRows = mapRecordRows(products.table, "products", {
      columnMap: guessRecordMapping(products.headers, "products"),
      ...SETTINGS,
    });
    expect(previewProductImport(productRows, []).map((p) => p.status)).toEqual(["new"]);

    const goals = readTemplate("goals");
    const goalRows = mapRecordRows(goals.table, "goals", {
      columnMap: guessRecordMapping(goals.headers, "goals"),
      ...SETTINGS,
    });
    expect(previewGoalImport(goalRows, []).map((p) => p.status)).toEqual(["new"]);
  });
});
