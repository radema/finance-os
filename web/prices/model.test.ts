import { describe, expect, it } from "vitest";
import { formatPrice } from "../money.ts";
import {
  brokerBody,
  brokerFields,
  canRefetch,
  changedBrokerRows,
  priceText,
  priceToSave,
  sourceOptions,
} from "./model.ts";

describe("month grid price text (AC-89)", () => {
  it("shows a stored price in the format of the read-only cells", () => {
    expect(priceText({ price: 53.5 })).toBe("53,50");
    expect(priceText({ price: 1234.5 })).toBe(formatPrice(1234.5));
    expect(priceText(undefined)).toBe("");
  });

  it("stores the same price for a typed comma and a typed dot", () => {
    expect(priceToSave("53,5", "")).toBe(53.5);
    expect(priceToSave("53.5", "")).toBe(53.5);
  });

  it("saves nothing for an unchanged, empty or bad text", () => {
    expect(priceToSave("53,50", "53,50")).toBeUndefined();
    expect(priceToSave("", "53,50")).toBeUndefined();
    expect(priceToSave("abc", "")).toBeUndefined();
  });
});

describe("source options (AC-89)", () => {
  const row = (
    regime: "etf" | "govt",
    ticker: string,
    priceSource: "provider" | "csv" | "manual" = "manual",
  ) => ({
    regime,
    ticker,
    priceSource,
  });

  it("offers Provider for a product with a ticker", () => {
    expect(sourceOptions(row("etf", "SWDA.MI"))).toEqual(["provider", "csv", "manual"]);
  });

  it("does not offer Provider for a product with no ticker", () => {
    expect(sourceOptions(row("etf", ""))).toEqual(["csv", "manual"]);
    expect(sourceOptions(row("etf", "  "))).toEqual(["csv", "manual"]);
  });

  it("does not offer Provider where the regime forbids it", () => {
    expect(sourceOptions(row("govt", "BTP1"))).toEqual(["csv", "manual"]);
  });

  it("keeps the source a product already has, so the select shows it", () => {
    expect(sourceOptions(row("etf", "", "provider"))).toEqual(["provider", "csv", "manual"]);
  });
});

describe("broker units edits (AC-89)", () => {
  const saved = {
    productId: "p1",
    brokerUnits: 12.5,
    brokerUnitsDate: "2026-03-14" as string | null,
  };
  const empty = { productId: "p2", brokerUnits: null, brokerUnitsDate: null };

  it("shows the saved values when nothing was edited", () => {
    expect(brokerFields(saved, {})).toEqual({ units: "12.5", date: "2026-03-14" });
    expect(brokerFields(empty, {})).toEqual({ units: "", date: "" });
  });

  it("is clean when nothing differs, even if the units are typed with a comma", () => {
    expect(changedBrokerRows([saved, empty], {})).toEqual([]);
    expect(changedBrokerRows([saved], { p1: { units: "12,5" } })).toEqual([]);
  });

  it("lists the rows that differ from the saved values", () => {
    expect(
      changedBrokerRows([saved, empty], { p1: { units: "13" }, p2: { date: "2026-04-01" } }),
    ).toEqual(["p1", "p2"]);
  });

  it("builds the body of a save: both set, or both cleared", () => {
    expect(brokerBody("p1", { units: "12,5", date: "2026-03-14" })).toEqual({
      productId: "p1",
      units: 12.5,
      date: "2026-03-14",
    });
    expect(brokerBody("p1", { units: " ", date: "" })).toEqual({
      productId: "p1",
      units: null,
      date: null,
    });
    expect(brokerBody("p1", { units: "3", date: "" })).toEqual({
      productId: "p1",
      units: 3,
      date: null,
    });
  });
});

describe("re-fetch (AC-89)", () => {
  it("is offered only for a Provider product with a ticker", () => {
    expect(canRefetch({ priceSource: "provider", ticker: "SWDA.MI" })).toBe(true);
    expect(canRefetch({ priceSource: "provider", ticker: "" })).toBe(false);
    expect(canRefetch({ priceSource: "csv", ticker: "SWDA.MI" })).toBe(false);
  });
});
