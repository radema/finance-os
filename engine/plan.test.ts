import { describe, expect, it } from "vitest";
import { planInForce } from "./plan.ts";

describe("planInForce", () => {
  const history = [
    { fromMonth: "2026-07", monthly: 150 },
    { fromMonth: "2026-01", monthly: 100 },
  ];

  it("takes the version with the greatest fromMonth not after the month", () => {
    expect(planInForce(history, "2026-06")).toBe(100);
    expect(planInForce(history, "2026-07")).toBe(150);
    expect(planInForce(history, "2027-12")).toBe(150);
  });

  it("is 0 before the first version and with no versions", () => {
    expect(planInForce(history, "2025-12")).toBe(0);
    expect(planInForce([], "2026-01")).toBe(0);
  });
});
