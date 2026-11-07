import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarations, lightTokens, stripComments } from "./cssTokens.testkit.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = (path: string) => stripComments(read(path));

describe("fonts (issue 164, AC-89)", () => {
  it("sets Source Serif 4 on titles and KPI values only, Geist on text", () => {
    const tokens = lightTokens();
    expect(tokens["--font-display"]).toMatch(/^"Source Serif 4"/);
    expect(tokens["--font-text"]).toMatch(/^"Geist"/);
    expect(declarations(css("./app.css"), ".title").font).toContain("var(--font-display)");
    expect(declarations(css("./goals.css"), ".kpi-value").font).toContain("var(--font-display)");
  });

  it("bundles every font file with its licence and loads nothing from a network", () => {
    const fonts = css("./fonts.css");
    expect(fonts).not.toMatch(/https?:/);
    const files = [...fonts.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1] ?? "");
    expect(files).toContain("source-serif-4-latin-wght-normal.woff2");
    for (const file of files) {
      expect(existsSync(new URL(`./fonts/${file}`, import.meta.url)), file).toBe(true);
      const licence = file.replace(/-latin-wght-normal\.woff2$/, "-LICENSE.txt");
      expect(existsSync(new URL(`./fonts/${licence}`, import.meta.url)), licence).toBe(true);
    }
  });
});

describe("kicker (issue 164, AC-89)", () => {
  it("is Geist 13 px, weight 500, --ink2, sentence case, no letter-spacing", () => {
    const tag = declarations(css("./app.css"), ".tag");
    expect(tag.font).toBe("500 var(--t-label) / var(--lh-label) var(--font-text)");
    expect(tag.color).toBe("var(--ink2)");
    expect(tag["text-transform"]).toBeUndefined();
    expect(tag["letter-spacing"]).toBeUndefined();
    expect(lightTokens()["--t-label"]).toBe("13px");
  });
});

describe("card accents (issue 164, AC-89)", () => {
  const goals = css("./goals.css");
  const setup = css("./setup.css");

  it("gives a KPI card a 1 px --grid outline and no accent bar", () => {
    const kpi = declarations(goals, ".kpi");
    expect(kpi.border).toBe("1px solid var(--grid)");
    expect(kpi["border-top"]).toBeUndefined();
  });

  it("puts an 8 px goal-colour dot before the KPI label, except where no goal owns the KPI", () => {
    const dot = declarations(goals, ".kpi-label::before");
    expect(dot.width).toBe("8px");
    expect(dot.height).toBe("8px");
    expect(dot.background).toBe("var(--slot)");
    expect(declarations(goals, ".kpis-blue .kpi-label::before").display).toBe("none");
    expect(declarations(goals, ".level-tile .kpi-label::before").display).toBe("none");
  });

  it("keeps the blue header strip on a section card and drops its bar", () => {
    const card = declarations(setup, ".card");
    expect(card["border-top"]).toBeUndefined();
    expect(declarations(setup, ".card-head").background).toBe("var(--tint-blue-faint)");
  });
});
