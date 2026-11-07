import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colour,
  darkTokens,
  declarations,
  lightTokens,
  ratio,
  stripComments,
} from "./cssTokens.testkit.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = stripComments(read("./app.css"));

describe("pointer targets (AC-89)", () => {
  it("makes --s4 the 24 px minimum the rules below use", () => {
    expect(lightTokens()["--s4"]).toBe("24px");
  });

  it("gives a checkbox row at least 24 px", () => {
    expect(declarations(app, ".check")["min-height"]).toBe("var(--s4)");
  });

  it.each([".card-head a", ".pbar-text", ".alert-rule a", ".goal-nav a"])(
    "gives the link %s a box of at least 24 px",
    (selector) => {
      const rule = declarations(app, selector);
      expect(rule["min-height"]).toBe("var(--s4)");
      expect(rule.display).toBe("inline-flex");
      expect(rule["align-items"]).toBe("center");
    },
  );

  it("keeps a card header as tall as before: the link grows, the padding shrinks", () => {
    expect(declarations(app, ".card-head:has(> a)")["padding-block"]).toBe("var(--s1)");
  });
});

describe("card title links (AC-89)", () => {
  it.each([
    ["light", lightTokens],
    ["dark", darkTokens],
  ])("draw the underline in %s with at least 3:1 against the card header", (_theme, palette) => {
    const rule = declarations(app, ".card-head a");
    expect(rule["text-decoration-line"]).toBe("underline");
    const colours = palette();
    const line = colour(rule["text-decoration-color"], colours);
    expect(ratio(line, colour("var(--tint-blue-faint)", colours))).toBeGreaterThanOrEqual(3);
  });
});
