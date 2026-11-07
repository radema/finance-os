import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = stripComments(read("./tokens.css"));
const app = stripComments(read("./app.css"));

/** The declarations of every rule whose selector list holds exactly `selector`, later rules winning. */
const declarations = (css: string, selector: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]?.split(",").map((s) => s.trim());
    if (!selectors?.includes(selector)) continue;
    for (const line of (rule[2] ?? "").split(";")) {
      const [name, ...value] = line.split(":");
      if (name?.trim()) out[name.trim()] = value.join(":").trim();
    }
  }
  return out;
};

const lightTokens = () => declarations(tokens, ":root");
const darkTokens = () => {
  const dark = tokens.slice(tokens.indexOf("prefers-color-scheme: dark"));
  return { ...lightTokens(), ...declarations(dark, ":root") };
};

const colour = (value: string | undefined, palette: Record<string, string>): string => {
  const name = /^var\((--[a-z0-9-]+)\)$/.exec(value ?? "")?.[1];
  const resolved = name ? palette[name] : value;
  if (!resolved) throw new Error(`no colour for ${value}`);
  return resolved.startsWith("var(") ? colour(resolved, palette) : resolved;
};

const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a: string, b: string): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

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
