import { describe, expect, it } from "vitest";
import { confirmSplit } from "../../engine/split.ts";
import { buildOpeningInput } from "./openingForm.ts";

const products = [
  { id: "p1", name: "VWCE" },
  { id: "p2", name: "Pension fund" },
];
const split = confirmSplit({
  totalUnits: 100,
  commissionCents: 0,
  units: [
    { goalId: "A", units: 60 },
    { goalId: "B", units: 40 },
  ],
});

describe("buildOpeningInput", () => {
  it("turns a filled row into total, PMC and parts, and skips an empty row", () => {
    const result = buildOpeningInput("2026-01-01", products, {
      p1: { units: "100", pmc: "50", split },
      p2: { units: "", pmc: "" },
    });
    expect(result).toEqual({
      input: {
        asOf: "2026-01-01",
        positions: [
          {
            productId: "p1",
            totalUnits: 100,
            pmc: 50,
            parts: [
              { goalId: "A", units: 60 },
              { goalId: "B", units: 40 },
            ],
          },
        ],
      },
    });
  });

  it("names the product when the PMC is missing or not positive", () => {
    for (const pmc of ["", "0", "-3"]) {
      expect(
        buildOpeningInput("2026-01-01", products, { p1: { units: "100", pmc, split } }),
      ).toEqual({ error: "VWCE: the PMC must be above 0." });
    }
  });

  it("names the product when the units are not positive", () => {
    expect(buildOpeningInput("2026-01-01", products, { p1: { units: "0", pmc: "5" } })).toEqual({
      error: "VWCE: the units must be above 0.",
    });
  });

  it("blocks a row whose split is not confirmed", () => {
    expect(buildOpeningInput("2026-01-01", products, { p1: { units: "100", pmc: "50" } })).toEqual({
      error: "VWCE: confirm the split over the buckets.",
    });
  });

  it("asks for at least one product, and for a date", () => {
    expect(buildOpeningInput("2026-01-01", products, {})).toEqual({
      error: "Fill in at least one product.",
    });
    expect(buildOpeningInput("", products, { p1: { units: "100", pmc: "50", split } })).toEqual({
      error: "Choose the as-of date.",
    });
  });

  it("allows no product when the caller supplies opening cash", () => {
    expect(buildOpeningInput("2026-01-01", products, {}, true)).toEqual({
      input: { asOf: "2026-01-01", positions: [] },
    });
  });
});
