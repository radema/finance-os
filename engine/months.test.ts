import { describe, expect, it } from "vitest";
import { addMonths, monthEnd, monthsEnding } from "./months.ts";

describe("months", () => {
  it("finds the last day of a month, leap years included", () => {
    expect(monthEnd("2026-03")).toBe("2026-03-31");
    expect(monthEnd("2026-04")).toBe("2026-04-30");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });

  it("adds months across a year end", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("lists the months that end at a month", () => {
    expect(monthsEnding("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
