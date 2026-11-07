import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  colour,
  darkTokens,
  declarations,
  lightTokens,
  ratio,
  stripComments,
} from "../cssTokens.testkit.ts";
import { ConfirmButton } from "./ui.tsx";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const setup = stripComments(read("../setup.css"));

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
