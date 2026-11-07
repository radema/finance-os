import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatPrice } from "../money.ts";
import { PriceInput } from "./MonthGrid.tsx";
import { PositionsTable } from "./Positions.tsx";
import type { PriceOverviewRow } from "./types.ts";

const product = (productId: string, name: string): PriceOverviewRow => ({
  productId,
  name,
  regime: "etf",
  priceSource: "manual",
  ticker: "",
  lastPrice: null,
  age: { old: false, reason: "fresh" } as PriceOverviewRow["age"],
  brokerUnits: null,
  brokerUnitsDate: null,
});

describe("Positions table (AC-89)", () => {
  const html = renderToStaticMarkup(
    createElement(PositionsTable, {
      products: [product("a", "World"), product("b", "Gold"), product("c", "Bond")],
      holdings: { accounts: [], buckets: [] },
      goalName: () => "Goal",
      onSaved: () => {},
    }),
  );

  it("writes each label once, in the column header", () => {
    expect(html.match(/>Units at the broker</g)).toHaveLength(1);
    expect(html.match(/>As of</g)).toHaveLength(1);
  });

  it("has one Save for the whole table and no unsaved cue before an edit", () => {
    expect(html.match(/>Save</g)).toHaveLength(1);
    expect(html).not.toContain("Unsaved changes");
    expect(html).toContain(">Saved<");
  });
});

describe("month grid input (AC-89)", () => {
  it("shows a stored price as the read-only cells do", () => {
    const html = renderToStaticMarkup(
      createElement(PriceInput, {
        label: "World 2026-05",
        stored: { price: 53.5, source: "manual", priceDate: "2026-05-10" },
        onSave: () => {},
      }),
    );
    expect(html).toContain(`value="${formatPrice(53.5)}"`);
    expect(formatPrice(53.5)).toBe("53,50");
  });
});
