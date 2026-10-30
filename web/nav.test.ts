import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell.tsx";
import { findPage, goalDetailHref, goalIdOf, isBuilt, NAV, SETUP_TABS } from "./nav.ts";

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

  it("shows the Setup tabs on a built Setup page, and no placeholder", () => {
    const html = render("setup/goals");
    expect(html).not.toContain("This page is not built yet");
    for (const tab of SETUP_TABS) expect(html).toContain(`href="#/${tab.key}"`);
    expect(html).toContain("Add goal");
  });

  it("keeps the soon tag on the Setup items without a screen", () => {
    const html = render("setup/products");
    const item = (label: string) =>
      html.match(new RegExp(`class="nav-item"[^>]*>${label}(.*?)</a>`))?.[1] ?? "";
    expect(item("Products")).not.toContain("soon");
    expect(item("Cash flow")).toContain("soon");
  });
});

describe("Goals screens", () => {
  const render = (route: string) => renderToString(createElement(AppShell, { route }));

  it("builds the Goals list and the Goal detail, and drops their soon tags", () => {
    expect(isBuilt("goals/list")).toBe(true);
    expect(isBuilt("goals/detail")).toBe(true);
    expect(isBuilt("goals/history")).toBe(false);
    expect(render("goals/list")).not.toContain("This page is not built yet");
  });

  it("reads the goal id of a detail route", () => {
    expect(goalIdOf("goals/detail/g-car")).toBe("g-car");
    expect(goalIdOf(goalDetailHref("a b").slice(1).replace(/^\//, ""))).toBe("a b");
    expect(goalIdOf("goals/detail")).toBeUndefined();
    expect(goalIdOf("goals/list")).toBeUndefined();
  });

  it("marks Detail as the current page on a goal's detail route", () => {
    const html = render("goals/detail/g-car");
    expect(html).toMatch(/aria-current="page"[^>]*>Detail/);
    expect(html).not.toContain("This page is not built yet");
  });

  it("asks for a goal on the detail route without an id", () => {
    expect(render("goals/detail")).toContain("Pick a goal");
  });
});

describe("SETUP_TABS", () => {
  it("lists the four Setup tabs, and the sidebar items keep the spec list", () => {
    expect(SETUP_TABS.map((tab) => tab.label)).toEqual([
      "Products",
      "Allocation",
      "Goals",
      "Assumptions",
    ]);
    expect(isBuilt("setup/goals")).toBe(true);
    expect(isBuilt("setup/cash-flow")).toBe(false);
    expect(isBuilt("operations/transactions")).toBe(true);
  });
});
