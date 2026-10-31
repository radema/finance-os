import { describe, expect, it } from "vitest";
import { classifyFetchedPrice, monthEndCloses } from "./priceFetch.ts";

const check = (priceScaled: number, previousScaled: number | null, currency = "EUR") =>
  classifyFetchedPrice({ currency, priceScaled, previousScaled });

describe("classifyFetchedPrice", () => {
  it("accepts a EUR price that moved less than 25%", () => {
    expect(check(110_000_000, 100_000_000)).toBeNull();
    expect(check(90_000_000, 100_000_000)).toBeNull();
  });

  it("accepts a move of exactly 25%, up or down", () => {
    expect(check(125_000_000, 100_000_000)).toBeNull();
    expect(check(75_000_000, 100_000_000)).toBeNull();
  });

  it("flags a move above 25%, up or down", () => {
    expect(check(130_000_000, 100_000_000)).toBe("move-above-25");
    expect(check(74_999_999, 100_000_000)).toBe("move-above-25");
  });

  it("skips the move check when there is no previous price", () => {
    expect(check(900_000_000, null)).toBeNull();
  });

  it("flags a currency other than EUR, whatever the move", () => {
    expect(check(100_000_000, 100_000_000, "USD")).toBe("non-eur");
    expect(check(100_000_000, null, "GBp")).toBe("non-eur");
  });

  it("names the currency before the move when both are wrong", () => {
    expect(check(300_000_000, 100_000_000, "USD")).toBe("non-eur");
  });
});

describe("monthEndCloses", () => {
  const row = (date: string, close = 1, ticker = "VWCE.MI") => ({
    ticker,
    date,
    close,
    currency: "EUR",
  });

  it("keeps the last trading day of each month, oldest month first", () => {
    const closes = monthEndCloses([
      row("2026-03-10", 3),
      row("2026-02-27", 2),
      row("2026-02-26", 1),
      row("2026-03-12", 4),
    ]);
    expect(closes.map((c) => [c.date, c.close])).toEqual([
      ["2026-02-27", 2],
      ["2026-03-12", 4],
    ]);
  });
});
