import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmButton } from "./ui.tsx";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = stripComments(read("../tokens.css"));
const setup = stripComments(read("../setup.css"));

/** The declarations of the first rule whose selector list is exactly `selector`. */
const declarations = (css: string, selector: string): Record<string, string> => {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1]
      ?.split(",")
      .map((s) => s.trim())
      .includes(selector),
  );
  const out: Record<string, string> = {};
  for (const line of (rule?.[2] ?? "").split(";")) {
    const [name, ...value] = line.split(":");
    if (name?.trim()) out[name.trim()] = value.join(":").trim();
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

describe("disabled buttons (AC-91)", () => {
  // `.btn` and `.btn.btn-primary` are the two looks of a disabled button ("Read pasted text", "Import prices").
  const looks = {
    ".btn": declarations(setup, ".btn:disabled"),
    ".btn-primary": {
      ...declarations(setup, ".btn:disabled"),
      ...declarations(setup, ".btn-primary:disabled"),
    },
  };
  for (const [look, rule] of Object.entries(looks)) {
    for (const [theme, palette] of [
      ["light", lightTokens()],
      ["dark", darkTokens()],
    ] as const) {
      it(`keeps the label of a disabled ${look} at 4.5:1 or more in ${theme}`, () => {
        const text = colour(rule.color, palette);
        const fill = colour(rule.background ?? rule["background-color"], palette);
        expect(ratio(text, fill)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`shows a disabled ${look} as unavailable by fill and cursor, not by faded text`, () => {
      expect(rule.background).toBe("var(--wash)");
      expect(rule.cursor).toBe("not-allowed");
      expect(rule.opacity).toBeUndefined();
    });
  }
  it("has no hover effect on a disabled button", () => {
    expect(setup).toContain(".btn:hover:not(:disabled)");
    expect(setup).toContain(".btn-primary:hover:not(:disabled)");
  });
});

describe("outlined confirm button (AC-89)", () => {
  const markup = (props: { outlined?: boolean; apart?: boolean }) =>
    renderToStaticMarkup(
      createElement(ConfirmButton, { label: "Reset assumptions", onConfirm: () => {}, ...props }),
    );

  it("is a quiet button by default, so a row Delete stays quiet", () => {
    expect(markup({})).toContain('class="btn btn-quiet"');
  });
  it("is the normal outlined button when asked, for Reset", () => {
    const html = markup({ outlined: true });
    expect(html).toContain('class="btn"');
    expect(html).not.toContain("btn-quiet");
  });
});
