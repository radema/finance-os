import { describe, expect, it } from "vitest";
import { colour, darkTokens, lightTokens, ratio } from "../cssTokens.testkit.ts";

// MixScatter paints the mix dots in --muted and rings the suggested and the current mark in --ink2.
describe.each([
  ["light", lightTokens],
  ["dark", darkTokens],
])("MixScatter marks in the %s theme (AC-91)", (_theme, tokensOf) => {
  it.each(["--muted", "--ink2"])("%s is at least 3:1 against the surface", (token) => {
    const palette = tokensOf();
    const on = (name: string) => colour(`var(${name})`, palette);
    expect(ratio(on(token), on("--surface"))).toBeGreaterThanOrEqual(3);
  });
});

describe("MixScatter mark sizes (AC-91)", () => {
  it("are tokens, and the key marks are larger than the mix dots", () => {
    const size = (name: string) => Number.parseFloat(lightTokens()[name] ?? "");
    expect(size("--mark-key")).toBeGreaterThan(size("--mark-dot"));
    expect(size("--mark-dot")).toBeGreaterThanOrEqual(10);
  });
});
