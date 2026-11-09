import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.tsx";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarState.ts";

afterEach(() => vi.unstubAllGlobals());

describe("sidebar preference", () => {
  it("defaults to expanded and restores only a stored true value", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(readSidebarCollapsed()).toBe(false);
    writeSidebarCollapsed(true);
    expect(values.get("gbi.sidebar.collapsed")).toBe("true");
    expect(readSidebarCollapsed()).toBe(true);
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
    values.set("gbi.sidebar.collapsed", "invalid");
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("continues when storage is unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("Storage denied");
      },
    });
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });

  it.each([false, true])(
    "renders the accessible toggle and sidebar when collapsed is %s",
    (collapsed) => {
      vi.stubGlobal("window", { localStorage: { getItem: () => String(collapsed) } });
      const html = renderToStaticMarkup(createElement(AppShell, { route: "unknown-route" }));
      expect(html).toContain(`data-sidebar-collapsed="${collapsed}"`);
      expect(html).toContain(`aria-label="${collapsed ? "Show sidebar" : "Hide sidebar"}"`);
      expect(html).toContain(`aria-expanded="${!collapsed}"`);
      expect(html).toContain('aria-controls="main-sidebar"');
      expect(html).toMatch(collapsed ? /id="main-sidebar" hidden=""/ : /id="main-sidebar">/);
      expect(html).toContain("Page not found");
    },
  );
});
