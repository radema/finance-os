import { describe, expect, it } from "vitest";
import { fromMonthInForce, monthlyInForce, valuationMonth } from "./goalPlan.ts";

const versions = [
  { fromMonth: "2026-01", monthlyCents: 45_000 },
  { fromMonth: "2026-12", monthlyCents: 70_000 },
];

describe("plan in force on the Setup Goals tab", () => {
  it("takes the valuation month from the API date, not from the clock", () => {
    expect(valuationMonth("2026-10-31")).toBe("2026-10");
  });

  it("keeps the old version when the newer one starts after the valuation month", () => {
    const month = valuationMonth("2026-10-31");
    expect(monthlyInForce(versions, month)).toBe(45_000);
    expect(fromMonthInForce(versions, month)).toBe("2026-01");
  });

  it("switches to the newer version once the valuation month reaches it", () => {
    const month = valuationMonth("2026-12-31");
    expect(monthlyInForce(versions, month)).toBe(70_000);
    expect(fromMonthInForce(versions, month)).toBe("2026-12");
  });

  it("has no version in force before the first one starts", () => {
    expect(monthlyInForce(versions, "2025-12")).toBe(0);
    expect(fromMonthInForce(versions, "2025-12")).toBeUndefined();
  });
});
