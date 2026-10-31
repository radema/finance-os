import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { FiResult } from "../../engine/financialIndependence.ts";
import { formatAmount } from "../money.ts";
import { readTokens, useEchart } from "../useEchart.ts";
import { LEVEL_NAMES } from "./model.ts";

echarts.use([LineChart, GridComponent, SVGRenderer]);

const BAND_OPACITY = { light: 0.22, dark: 0.3 };
const BAND_LINE_OPACITY = 0.6;
/** Level lines of the % chart: slots 1, 2 and 5 are the slots a line may use (DESIGN.md). */
const LEVEL_SLOTS = [5, 2, 1];

/** x-axis labels: point 0 is today; the others are 31 December of their year. */
const labelsOf = (result: FiResult) =>
  result.points.map((point, index) => (index === 0 ? "Today" : String(point.year)));

const euros = (value: number) => formatAmount(value).replace(/,00/, "");

function frame(result: FiResult, format: (value: number) => string) {
  const colour = readTokens(5);
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  return {
    colour,
    option: {
      animation: false,
      grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: "category" as const,
        data: labelsOf(result),
        boundaryGap: false,
        axisLine: { lineStyle: { color: colour.grid } },
        axisTick: { show: false },
        axisLabel: { ...text, hideOverlap: true },
      },
      yAxis: {
        type: "value" as const,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: colour.grid } },
        axisLabel: { ...text, formatter: format },
      },
    },
  };
}

const endLabel = (colour: ReturnType<typeof readTokens>) => ({
  show: true,
  formatter: "{a}",
  color: colour.ink2,
  fontFamily: colour.font,
  fontSize: 13,
});

const line = (name: string, data: (number | null)[], color: string, extra = {}) => ({
  name,
  type: "line" as const,
  data,
  symbol: "none",
  lineStyle: { width: 1.5, color },
  itemStyle: { color },
  ...extra,
});

function fanOption(result: FiResult) {
  const { colour, option } = frame(result, euros);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const band = result.points.map((point) => point.total);
  const label = endLabel(colour);
  return {
    ...option,
    series: [
      {
        name: "Bad case",
        type: "line" as const,
        stack: "range",
        data: band.map((b) => b.p10),
        symbol: "none",
        lineStyle: { width: 0 },
        itemStyle: { color: colour.slot },
      },
      {
        name: "Range",
        type: "line" as const,
        stack: "range",
        data: band.map((b) => b.p90 - b.p10),
        symbol: "none",
        lineStyle: { width: 0 },
        itemStyle: { color: colour.slot },
        areaStyle: {
          color: colour.slot,
          opacity: dark ? BAND_OPACITY.dark : BAND_OPACITY.light,
        },
      },
      {
        ...line(
          "Typical case",
          band.map((b) => b.p50),
          colour.slot,
          { endLabel: label },
        ),
        lineStyle: { width: 2.25, color: colour.slot },
        z: 3,
      },
      {
        ...line(
          "Deterministic",
          band.map((b) => b.deterministic),
          colour.slot,
          { endLabel: label },
        ),
        lineStyle: {
          width: 1.5,
          color: colour.slot,
          type: "dashed" as const,
          opacity: BAND_LINE_OPACITY,
        },
      },
      ...LEVEL_NAMES.map((name, level) =>
        line(
          name,
          result.points.map((point) => point.targets[level] as number),
          colour.ctx,
          { endLabel: label },
        ),
      ),
    ],
  };
}

/** FI wealth as a fan (bad to good case, typical case, deterministic line) with the level targets. */
export function FanChart({ result, label }: { result: FiResult; label: string }) {
  const build = useCallback(() => fanOption(result), [result]);
  const box = useEchart(build);
  return <div className="chart chart-tall" ref={box} role="img" aria-label={label} />;
}

function progressOption(result: FiResult) {
  const { colour, option } = frame(result, (value) => `${Math.round(value)}%`);
  const label = endLabel(colour);
  return {
    ...option,
    series: [
      line(
        "Target",
        result.points.map(() => 100),
        colour.ctx,
        { endLabel: label, lineStyle: { width: 1.5, color: colour.ctx, type: "dashed" as const } },
      ),
      ...LEVEL_NAMES.map((name, level) => {
        const colourOfLevel = readTokens(LEVEL_SLOTS[level] ?? 5).slot;
        return line(
          name,
          result.points.map((point) => {
            const progress = point.progress[level];
            return progress === null || progress === undefined ? null : progress * 100;
          }),
          colourOfLevel,
          { endLabel: label },
        );
      }),
    ],
  };
}

/** Median wealth as a percentage of each level's target, year by year. */
export function ProgressChart({ result, label }: { result: FiResult; label: string }) {
  const build = useCallback(() => progressOption(result), [result]);
  const box = useEchart(build);
  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
