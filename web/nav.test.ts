import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell.tsx";
import { findPage, NAV } from "./nav.ts";

describe("NAV", () => {
  it("has the seven sections of the spec, in order", () => {
    expect(NAV.map((section) => section.label)).toEqual([
      "Overview",
      "Goals",
      "Independence",
      "Analysis",
      "Pension",
      "Operations",
      "Setup",
    ]);
  });

  it("lists the items of each section", () => {
    const labels = (section: string) =>
      NAV.find((s) => s.label === section)?.items.map((item) => item.label);
    expect(labels("Goals")).toEqual(["List", "Detail", "History"]);
    expect(labels("Analysis")).toEqual(["Optimizer", "Performance", "Plan vs actual"]);
    expect(labels("Operations")).toEqual(["Transactions", "Import", "Prices"]);
    expect(labels("Setup")).toEqual([
      "Products",
      "Allocation",
      "Cash flow",
      "Assumptions",
      "Glossary",
    ]);
    expect(labels("Overview")).toEqual([]);
  });

  it("gives every page a unique route key", () => {
    const keys = NAV.flatMap((section) => [section.key, ...section.items.map((item) => item.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("findPage", () => {
  it("finds a section page and an item page by route key", () => {
    expect(findPage("overview")?.label).toBe("Overview");
    expect(findPage("setup/cash-flow")?.label).toBe("Cash flow");
  });

  it("returns undefined for an unknown key", () => {
    expect(findPage("nope")).toBeUndefined();
  });
});

describe("AppShell", () => {
  const render = (route: string) => renderToString(createElement(AppShell, { route }));

  it("shows every section in the sidebar", () => {
    const html = render("overview");
    for (const section of NAV) expect(html).toContain(section.label);
  });

  it("marks the current page and shows the soon placeholder", () => {
    const html = render("analysis/optimizer");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("This page is not built yet");
    expect(html).toContain("Optimizer");
  });

  it("tells the user when the route is unknown", () => {
    expect(render("nope")).toContain("Page not found");
  });
});
