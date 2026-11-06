import { describe, expect, it } from "vitest";
import { eurosToCents, num, percentToFraction, showDecimal } from "./forms.ts";

describe("num reads a decimal comma and a decimal dot (AC-89)", () => {
  it.each([
    ["12,50", 12.5],
    ["12.50", 12.5],
    ["53,5", 53.5],
    ["1.234", 1.234],
    ["50.0983", 50.0983],
    ["1.234,5", 1234.5],
    ["1.234.567,89", 1234567.89],
    ["  6,5  ", 6.5],
    ["-3,5", -3.5],
    ["42000", 42000],
  ])("%s gives %d", (text, expected) => {
    expect(num(text)).toBe(expected);
  });

  it.each(["", "   ", "abc", "1,2,3", "1.2.3", "1,234.5", "12,5x", "1e3", ",", "."])(
    "%j gives NaN",
    (text) => {
      expect(num(text)).toBeNaN();
    },
  );
});

describe("the money and percent helpers use the same parser (AC-89)", () => {
  it("turns a comma into cents and a fraction", () => {
    expect(eurosToCents("12,50")).toBe(1250);
    expect(eurosToCents("1.234,5")).toBe(123450);
    expect(percentToFraction("6,5")).toBe(0.065);
    expect(percentToFraction("6.5")).toBe(0.065);
  });
});

describe("showDecimal (AC-89)", () => {
  it("shows a stored dot as a comma", () => {
    expect(showDecimal("6.5")).toBe("6,5");
    expect(showDecimal("42000")).toBe("42000");
  });

  it("keeps a text that already has a comma", () => {
    expect(showDecimal("1.234,5")).toBe("1.234,5");
  });
});
