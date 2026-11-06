import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatEuro,
  formatPercent,
  formatPrice,
  formatUnitPrice,
  formatWholeEuro,
} from "./money.ts";

const NBSP = " ";

describe("euro formats", () => {
  it("keep the thousands dot on 4-digit and 5-digit amounts", () => {
    expect(formatEuro(180_000)).toBe(`1.800,00${NBSP}€`);
    expect(formatAmount(-4321.2)).toBe(`-4.321,20${NBSP}€`);
    expect(formatEuro(1_800_000)).toBe(`18.000,00${NBSP}€`);
    expect(formatUnitPrice(1800)).toBe(`1.800,00${NBSP}€`);
  });

  it("never print a negative zero", () => {
    expect(formatEuro(-0)).toBe(`0,00${NBSP}€`);
    expect(formatAmount(-0.001)).toBe(`0,00${NBSP}€`);
    expect(formatUnitPrice(-0.00001)).toBe(`0,00${NBSP}€`);
    expect(formatWholeEuro(-0.4)).toBe(`0${NBSP}€`);
  });

  it("formats whole euros grouped, without cents", () => {
    expect(formatWholeEuro(1800)).toBe(`1.800${NBSP}€`);
    expect(formatWholeEuro(-12_345.6)).toBe(`-12.346${NBSP}€`);
  });
});

describe("formatPercent", () => {
  it("prints 0% for a value that rounds to zero", () => {
    expect(formatPercent(-0.00001)).toBe("0%");
    expect(formatPercent(-0)).toBe("0%");
  });

  it("keeps the sign and the decimal comma otherwise", () => {
    expect(formatPercent(-0.088)).toBe("-8,8%");
    expect(formatPercent(0.065)).toBe("6,5%");
  });
});

describe("price rule: 2 to 4 decimals, trailing zeros kept to 2", () => {
  it("pads to 2 decimals and keeps up to 4", () => {
    expect(formatPrice(13)).toBe("13,00");
    expect(formatPrice(98.5)).toBe("98,50");
    expect(formatPrice(50.0983)).toBe("50,0983");
    expect(formatPrice(1800)).toBe("1.800,00");
  });

  it("matches the euro unit price without the symbol", () => {
    expect(formatUnitPrice(50.0983)).toBe(`50,0983${NBSP}€`);
  });
});
