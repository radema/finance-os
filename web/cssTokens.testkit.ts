import { readFileSync } from "node:fs";

/** Helpers for tests that read `tokens.css` and the page CSS: declarations, token palettes, contrast. */

export const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const tokens = stripComments(readFileSync(new URL("./tokens.css", import.meta.url), "utf8"));

/** The declarations of every rule whose selector list holds exactly `selector`, later rules winning. */
export const declarations = (css: string, selector: string): Record<string, string> => {
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

export const lightTokens = () => declarations(tokens, ":root");
export const darkTokens = () => {
  const dark = tokens.slice(tokens.indexOf("prefers-color-scheme: dark"));
  return { ...lightTokens(), ...declarations(dark, ":root") };
};

/** A colour value with its `var(--token)` references resolved in `palette`. */
export const colour = (value: string | undefined, palette: Record<string, string>): string => {
  const name = /^var\((--[a-z0-9-]+)\)$/.exec(value ?? "")?.[1];
  const resolved = name ? palette[name] : value;
  if (!resolved) throw new Error(`no colour for ${value}`);
  return resolved.startsWith("var(") ? colour(resolved, palette) : resolved;
};

export const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two `#rrggbb` colours. */
export const ratio = (a: string, b: string): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
