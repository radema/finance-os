import { describe, expect, it } from "vitest";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import { REGIMES } from "../../engine/schemas.ts";
import { regimeFields, regimeHint, resetHiddenFields, suggestRegime } from "./regime.ts";

describe("suggested tax regime", () => {
  it("maps every asset class to a regime, and never to pension", () => {
    for (const assetClass of ASSET_CLASSES) {
      const regime = suggestRegime(assetClass);
      expect(REGIMES).toContain(regime);
      expect(regime).not.toBe("pension");
    }
  });

  it("follows the table chosen in #71", () => {
    expect(ASSET_CLASSES.map(suggestRegime)).toEqual([
      "etf",
      "govt",
      "direct",
      "etf",
      "cash",
      "direct",
    ]);
  });

  it("gives nothing for a class it does not know", () => {
    expect(suggestRegime("Art")).toBeUndefined();
  });
});

describe("regime hint", () => {
  it("names the suggestion when the regime differs", () => {
    expect(regimeHint("Govt bonds", "etf")).toBe("govt");
  });

  it("stays silent when the regime already matches", () => {
    expect(regimeHint("Govt bonds", "govt")).toBeUndefined();
  });

  it("stays silent for a pension fund: a wrapper, not an asset-class regime", () => {
    expect(regimeHint("Multi-asset", "pension")).toBeUndefined();
  });
});

describe("fields that apply to a regime", () => {
  it("shows the white-list share for an ETF, and no coupon or maturity", () => {
    expect(regimeFields("etf")).toEqual({
      whiteListShare: true,
      couponRate: false,
      maturity: false,
    });
  });

  it("shows none of the three for cash", () => {
    expect(regimeFields("cash")).toEqual({
      whiteListShare: false,
      couponRate: false,
      maturity: false,
    });
  });

  it("shows the coupon rate and maturity for a government bond", () => {
    expect(regimeFields("govt")).toEqual({
      whiteListShare: false,
      couponRate: true,
      maturity: true,
    });
  });

  it("shows maturity alone for a direct holding: a corporate bond has one, the engine alerts on it", () => {
    expect(regimeFields("direct")).toEqual({
      whiteListShare: false,
      couponRate: false,
      maturity: true,
    });
  });

  it("shows none of the three for a pension fund", () => {
    expect(regimeFields("pension")).toEqual({
      whiteListShare: false,
      couponRate: false,
      maturity: false,
    });
  });
});

describe("reset of hidden fields", () => {
  const filled = { regime: "govt", whiteListShare: "40", couponRate: "3.5", maturity: "2031-06" };

  it("puts the fields a new regime hides back to their defaults", () => {
    expect(resetHiddenFields({ ...filled, regime: "etf" })).toEqual({
      regime: "etf",
      whiteListShare: "40",
      couponRate: "0",
      maturity: "",
    });
    expect(resetHiddenFields({ ...filled, regime: "cash" })).toEqual({
      regime: "cash",
      whiteListShare: "0",
      couponRate: "0",
      maturity: "",
    });
  });

  it("keeps the fields the regime shows", () => {
    expect(resetHiddenFields(filled)).toEqual({ ...filled, whiteListShare: "0" });
  });
});
