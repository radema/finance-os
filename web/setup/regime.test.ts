import { describe, expect, it } from "vitest";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import { REGIMES } from "../../engine/schemas.ts";
import { regimeHint, suggestRegime } from "./regime.ts";

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
