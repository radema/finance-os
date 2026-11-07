import { readFileSync } from "node:fs";
import * as echarts from "echarts/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FanPoint, SeriesPoint } from "../engine/goalViews.ts";
import { buildOption as buildFan } from "./goals/FanChart.tsx";
import { buildOption as buildValue } from "./goals/ValueChart.tsx";
import { buildOption as buildTime, type ChartSeries } from "./tracking/TimeChart.tsx";
import { PLOT_GRID } from "./useEchart.ts";

beforeAll(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", { documentElement: {}, createElement: () => false });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "currentcolor" }));
});
afterAll(() => vi.unstubAllGlobals());

const gridOf = (option: { grid: object }) => option.grid;

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

describe("the plot area", () => {
  it("is one grid for the charts of a screen, labelled or not", () => {
    const grids = [
      gridOf(buildFan(fan, 1_200, 2)),
      gridOf(buildValue(points, 2)),
      gridOf(buildTime(months, [line("A", true), line("B", true)], ident, true)),
      gridOf(buildTime(months, [line("A", false)], ident, true)),
    ];
    expect(grids).toEqual(grids.map(() => PLOT_GRID));
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

describe("the plot right edge", () => {
  /** Where the plot of a chart ends, as ECharts lays it out in a 1000 px wide chart box. */
  type Laid = {
    setOption: (option: unknown) => void;
    getModel: () => { getComponent: (type: string, index: number) => unknown };
    dispose: () => void;
  };
  const plotEnd = (option: object): number => {
    const chart = echarts.init(null as never, null as never, {
      renderer: "svg",
      ssr: true,
      width: 1000,
      height: 300,
    }) as unknown as Laid;
    chart.setOption(option);
    const grid = chart.getModel().getComponent("grid", 0) as {
      coordinateSystem: { getRect: () => { x: number; width: number } };
    };
    const { x, width } = grid.coordinateSystem.getRect();
    chart.dispose();
    return x + width;
  };
  const sixMonths = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const bar: ChartSeries = {
    name: "Bars",
    data: [1, 2, 3, 4, 5, 6],
    colour: "--ink2",
    kind: "bar",
  };

  it("is the same in every chart, whatever its last x label and y labels", () => {
    const ends = [
      plotEnd(buildFan(fan, 1_200, 2)),
      plotEnd(buildValue(points, 2)),
      plotEnd(buildTime(sixMonths, [line("A", true)], ident, true)),
      plotEnd(buildTime(sixMonths, [bar], (value) => `${value * 100_000} €`, true)),
    ];
    for (const end of ends) expect(Math.abs(end - ends[0])).toBeLessThan(1);
    expect(ends[0]).toBeCloseTo(1000 - PLOT_GRID.right, 0);
  });
});
