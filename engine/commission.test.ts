import { describe, expect, it } from "vitest";
import { estimateCommission, isCostly, minEfficientTicket } from "./commission.ts";
import { type Commission, commissionSchema } from "./schemas.ts";

const percent: Commission = commissionSchema.parse({});
const flat: Commission = commissionSchema.parse({
  feeModel: "flat",
  flatFeeCents: 500,
  minTicketCents: 100_000,
});
const bears = { zeroCommission: false };

describe("estimateCommission", () => {
  it("clamps the percent fee at the minimum, in the middle and at the maximum", () => {
    expect(estimateCommission(percent, bears, "buy", 50_000)).toBe(295);
    expect(estimateCommission(percent, bears, "buy", 400_000)).toBeCloseTo(760);
    expect(estimateCommission(percent, bears, "sell", 5_000_000)).toBe(1900);
  });

  it("charges the flat fee whatever the amount", () => {
    expect(estimateCommission(flat, bears, "buy", 1_000)).toBe(500);
    expect(estimateCommission(flat, bears, "sell", 9_000_000)).toBe(500);
  });

  it("is zero for a zero-commission product", () => {
    expect(estimateCommission(percent, { zeroCommission: true }, "buy", 50_000)).toBe(0);
  });

  it("is zero for the types other than buy and sell", () => {
    for (const type of ["opening", "pensionContribution", "coupon"] as const) {
      expect(estimateCommission(percent, bears, type, 50_000)).toBe(0);
    }
  });
});

describe("minEfficientTicket", () => {
  it("is min / rate for percent: 295 / 0.0019 cents with the defaults", () => {
    expect(minEfficientTicket(percent)).toBeCloseTo(155_263.16, 2);
  });

  it("is the user's ticket for flat", () => {
    expect(minEfficientTicket(flat)).toBe(100_000);
  });

  it("is 0 for a percent plan with a zero rate", () => {
    expect(minEfficientTicket({ ...percent, rate: 0 })).toBe(0);
  });
});

describe("isCostly", () => {
  it("fires below the minimum efficient ticket and not at it", () => {
    expect(isCostly(percent, bears, "buy", 155_000)).toBe(true);
    expect(isCostly(percent, bears, "buy", 156_000)).toBe(false);
    expect(isCostly(flat, bears, "buy", 99_999)).toBe(true);
    expect(isCostly(flat, bears, "buy", 100_000)).toBe(false);
  });

  it("stays quiet when the product bears no commission or the type is not a trade", () => {
    expect(isCostly(percent, { zeroCommission: true }, "buy", 1_000)).toBe(false);
    expect(isCostly(percent, bears, "coupon", 1_000)).toBe(false);
  });
});
