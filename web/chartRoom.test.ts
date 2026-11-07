import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FanPoint, SeriesPoint } from "../engine/goalViews.ts";
import { buildOption as buildFan } from "./goals/FanChart.tsx";
import { buildOption as buildValue } from "./goals/ValueChart.tsx";
import { buildOption as buildTime, type ChartSeries } from "./tracking/TimeChart.tsx";
import { PLOT_RIGHT } from "./useEchart.ts";

beforeAll(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", { documentElement: {}, createElement: () => false });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "currentcolor" }));
});
afterAll(() => vi.unstubAllGlobals());

const rightOf = (option: { grid: { right: number } }) => option.grid.right;

const fan: FanPoint[] = [
  { year: 2026, bad: 1_000, typical: 1_000, good: 1_000 },
  { year: 2027, bad: 1_100, typical: 1_200, good: 1_300 },
];
const points: SeriesPoint[] = [
  { month: "2026-01", value: 1_000, moneyIn: 900 },
  { month: "2026-02", value: 1_100, moneyIn: 950 },
];
const line = (name: string, endLabel: boolean): ChartSeries => ({
  name,
  data: [1, 2],
  colour: "--ink2",
  endLabel,
});
const months = ["2026-01", "2026-02"];
const ident = (value: number) => String(value);

describe("the room right of the plot", () => {
  it("is one value for the charts of a screen, labelled or not", () => {
    const rights = [
      rightOf(buildFan(fan, 1_200, 2)),
      rightOf(buildValue(points, 2)),
      rightOf(buildTime(months, [line("A", true), line("B", true)], ident, true)),
      rightOf(buildTime(months, [line("A", false)], ident, true)),
    ];
    expect(rights).toEqual(rights.map(() => PLOT_RIGHT));
  });
});

describe("the exhibit box", () => {
  it("has no width cap of its own, so a chart ends where the card above it ends", () => {
    const css = readFileSync(new URL("./goals.css", import.meta.url), "utf8");
    const rule = css.match(/\n\.exhibit \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/max-width/);
  });
});
