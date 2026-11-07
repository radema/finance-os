import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GoalListView } from "../../engine/goalViews.ts";
import { GoalsTable } from "./GoalsListScreen.tsx";

const goal = (id: string, name: string, slot: number): GoalListView["goals"][number] => ({
  id,
  name,
  slot,
  priority: "Need",
  value: 1_000_00,
  target: 2_000_00,
  missingPrices: false,
  outlook: { status: "on_track", pSuccess: 0.9, requiredP: 0.8 },
});

describe("Goals list table (AC-87, AC-89)", () => {
  const html = renderToStaticMarkup(
    createElement(GoalsTable, {
      goals: [goal("a", "Home deposit", 1), goal("b", "Retirement", 2)],
      gapOf: () => 5_00,
    }),
  );
  const withoutPopovers = html.replace(/<span[^>]*class="term-popover".*?<\/span><\/span>/g, "");
  const headers = [...withoutPopovers.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => ({
    open: m[0].slice(0, m[0].indexOf(">") + 1),
    text: m[1]?.replace(/<[^>]+>/g, "").trim(),
  }));

  it("keeps all eight columns, with the key ones never optional", () => {
    expect(headers.map((h) => h.text)).toEqual([
      "Goal",
      "Priority",
      "Status",
      "P vs required",
      "Value",
      "Target",
      "Value vs target",
      "Plan gap",
    ]);
    for (const key of ["Goal", "Status", "P vs required", "Value", "Value vs target"]) {
      expect(headers.find((h) => h.text === key)?.open).not.toContain("col-opt");
    }
  });

  it("ranks Priority and Target before Plan gap in the drop order", () => {
    const tier = (text: string) =>
      headers.find((h) => h.text === text)?.open.match(/col-opt-\d/)?.[0];
    expect(tier("Priority")).toBe("col-opt-1");
    expect(tier("Target")).toBe("col-opt-1");
    expect(tier("Plan gap")).toBe("col-opt-2");
  });

  it("gives every body cell the same tier as its header", () => {
    const row = html.split("<tbody>")[1]?.split("</tr>")[0] ?? "";
    const tiers = [...row.matchAll(/<td([^>]*)>/g)].map((m) => m[1]?.match(/col-opt-\d/)?.[0]);
    expect(tiers).toEqual([
      undefined,
      "col-opt-1",
      undefined,
      undefined,
      undefined,
      "col-opt-1",
      undefined,
      "col-opt-2",
    ]);
  });
});
