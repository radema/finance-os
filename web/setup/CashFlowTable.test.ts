import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CashFlowYear } from "../../engine/cashFlow.ts";
import { CashFlowTable } from "./CashFlowTable.tsx";

const NBSP = "\u00a0";
const row = (year: number, label: string, gap: number): CashFlowYear => ({
  year,
  label,
  income: 3_000_049,
  expenses: 1_800_051,
  events: -250_000,
  refund: 12_345,
  capacity: 962_345,
  planned: 1_682_345,
  gap,
});
const html = renderToStaticMarkup(
  createElement(CashFlowTable, {
    rows: [row(2026, "rest of year", -720_049), row(2027, "2027", -2_248_451)],
  }),
);

describe("Cash flow table (AC-87, AC-89)", () => {
  it("sits in the sticky scroll wrapper, so a narrow card scrolls instead of clipping", () => {
    expect(html).toMatch(/^<div class="table-scroll table-scroll-sticky"><table class="table /);
  });

  it("shows whole euros, with the thousands dot and no cents", () => {
    expect(html).toContain(`30.000${NBSP}€`);
    expect(html).toContain(`-7.200${NBSP}€`);
    expect(html).toContain(`-22.485${NBSP}€`);
    expect(html).not.toMatch(/\d,\d\d/);
  });

  it("names the stub row '2026 (rest)' and keeps the other rows as the bare year", () => {
    expect(html).toContain("2026 (rest)");
    expect(html).not.toContain("rest of year");
    expect(html).toMatch(/<td>2027<\/td>/);
  });

  it("keeps the short column headers", () => {
    const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual([
      "Year",
      "Income",
      "Expenses",
      "Events",
      "Pension refund",
      "Capacity",
      "Planned from savings",
      "Gap",
    ]);
  });
});
