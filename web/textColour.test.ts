import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colour,
  darkTokens,
  declarations,
  lightTokens,
  ratio,
  stripComments,
} from "./cssTokens.testkit.ts";

const webDir = new URL("./", import.meta.url);
const sheets = readdirSync(webDir).filter((name) => name.endsWith(".css"));
const css = (name: string) => stripComments(readFileSync(new URL(name, webDir), "utf8"));

/** Selectors that may set `color: var(--hl)`: icons and marks, never text. */
const MARK_SELECTORS = new Set([
  ".field-error-mark",
  ".status-at_risk svg",
  ".status-off_track svg",
  ".severity-Medium svg",
  ".severity-High svg",
]);

const highlightColourSelectors = (): string[] => {
  const found: string[] = [];
  for (const sheet of sheets) {
    for (const rule of css(sheet).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|;|\s)color\s*:\s*var\(--hl\)/.test(rule[2] ?? "")) continue;
      for (const selector of (rule[1] ?? "").split(",")) found.push(selector.trim());
    }
  }
  return found;
};

describe("text colour (issue 73, AC-91)", () => {
  it("never sets --hl as a text colour outside the listed mark selectors", () => {
    expect(sheets.length).toBeGreaterThan(5);
    const text = highlightColourSelectors().filter((selector) => !MARK_SELECTORS.has(selector));
    expect(text).toEqual([]);
  });

  it("gives the required-field asterisk a text token of at least 4.5:1 on --surface and --raised", () => {
    const setup = css("setup.css");
    for (const selector of [".field-required", ".form-legend > span"]) {
      const value = declarations(setup, selector).color;
      for (const [theme, palette] of [
        ["light", lightTokens()],
        ["dark", darkTokens()],
      ] as const) {
        for (const ground of ["--surface", "--raised"]) {
          const contrast = ratio(colour(value, palette), colour(`var(${ground})`, palette));
          expect(contrast, `${selector} on ${ground}, ${theme}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
