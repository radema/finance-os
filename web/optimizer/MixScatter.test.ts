import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
// The light tokens are the first rule; the dark ones sit in the media query after it.
const [light, dark] = [
  tokens.slice(0, tokens.indexOf("@media")),
  tokens.slice(tokens.indexOf("@media")),
];

const value = (block: string, name: string): string => {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token ${name} not found`);
  return match[1].trim();
};
const channel = (hex: string, at: number) => {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// MixScatter paints the mix dots in --muted and rings the suggested and the current mark in --ink2.
describe.each([
  ["light", light],
  ["dark", dark],
])("MixScatter marks in the %s theme (AC-91)", (_theme, block) => {
  it.each(["--muted", "--ink2"])("%s is at least 3:1 against the surface", (token) => {
    expect(contrast(value(block, token), value(block, "--surface"))).toBeGreaterThanOrEqual(3);
  });
});

describe("MixScatter mark sizes (AC-91)", () => {
  it("are tokens, and the key marks are larger than the mix dots", () => {
    const size = (name: string) => Number.parseFloat(value(light, name));
    expect(size("--mark-key")).toBeGreaterThan(size("--mark-dot"));
    expect(size("--mark-dot")).toBeGreaterThanOrEqual(10);
  });
});
