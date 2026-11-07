import { readFileSync } from "node:fs";
import * as echarts from "echarts/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FiPoint, FiResult } from "../engine/financialIndependence.ts";
import type { FanPoint, SeriesPoint } from "../engine/goalViews.ts";
import type { PensionYearView } from "../engine/pensionView.ts";
import { buildOption as buildFan } from "./goals/FanChart.tsx";
import { buildOption as buildValue } from "./goals/ValueChart.tsx";
import { fanOption } from "./independence/FiCharts.tsx";
import { LEVEL_NAMES } from "./independence/model.ts";
import { buildOption as buildSchedule } from "./pension/ScheduleChart.tsx";
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

describe("the independence end labels", () => {
  const band = { p10: 100, p50: 200, p90: 300, deterministic: 200 };
  const levels = [18_000, 300_000, 450_000, 550_000];
  const fiPoint = (year: number): FiPoint => ({
    year,
    t: 0,
    total: band,
    nonPension: band,
    targets: levels,
    pReached: [0, 0, 0, 0],
    progress: [0, 0, 0, 0],
  });
  const result: FiResult = {
    levels,
    wealthToday: { total: 100, nonPension: 100, pension: 0 },
    points: [fiPoint(2026), fiPoint(2027)],
    reached: levels.map(() => ({ median: null, deterministic: null })),
    correlationShrunk: false,
  };

  it("fit inside the chart box, the longest level name included", () => {
    const chart = echarts.init(null as never, null as never, {
      renderer: "svg",
      ssr: true,
      width: 1000,
      height: 300,
    });
    chart.setOption(fanOption(result));
    const right: Record<string, number> = {};
    for (const el of chart.getZr().storage.getDisplayList(true)) {
      const text = (el as { style?: { text?: string } }).style?.text;
      if (!text) continue;
      const box = el.getBoundingRect().clone();
      const placed = el.getComputedTransform();
      if (placed) box.applyTransform(placed);
      right[text] = box.x + box.width;
    }
    chart.dispose();
    for (const name of [...LEVEL_NAMES, "Typical case"]) {
      expect(right[name], name).toBeLessThanOrEqual(1000);
    }
  });
});

describe("the axis labels of a chart with its own margins", () => {
  const year = (n: number): PensionYearView => ({
    year: 2026 + n,
    ral: 40_000,
    tfr: 3_000,
    worker: 500,
    employer: 500,
    voluntary: 1_234_567,
    deductible: 1,
    refund: 1,
    refundYear: 2027 + n,
  });

  it("stay inside the chart box, y labels at the left edge and x labels at the bottom", () => {
    const chart = echarts.init(null as never, null as never, {
      renderer: "svg",
      ssr: true,
      width: 1000,
      height: 300,
    });
    chart.setOption(buildSchedule([year(0), year(1), year(2)], 2));
    const texts = chart
      .getZr()
      .storage.getDisplayList(true)
      .filter((el) => (el as { style?: { text?: string } }).style?.text);
    expect(texts.length).toBeGreaterThan(3);
    for (const el of texts) {
      const box = el.getBoundingRect().clone();
      const placed = el.getComputedTransform();
      if (placed) box.applyTransform(placed);
      const text = (el as { style?: { text?: string } }).style?.text;
      expect(box.x, text).toBeGreaterThanOrEqual(0);
      expect(box.y, text).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, text).toBeLessThanOrEqual(1000);
      expect(box.y + box.height, text).toBeLessThanOrEqual(300);
    }
    chart.dispose();
  });

  it("are contained by `outerBoundsContain`, not by `containLabel`", () => {
    const grid = buildSchedule([year(0)], 2).grid as Record<string, unknown>;
    expect(grid.outerBoundsContain).toBe("axisLabel");
    expect(grid.containLabel).toBeUndefined();
  });
});
