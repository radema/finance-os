import { BarChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { GoalAnalysis } from "../../engine/goalViews.ts";
import { formatAmount } from "../money.ts";
import { readTokens, useEchart } from "../useEchart.ts";

echarts.use([BarChart, ScatterChart, GridComponent, MarkLineComponent, SVGRenderer]);

const BAND_OPACITY = { light: 0.22, dark: 0.3 };
const ROW = "Net value";
/** Pixels between a point and its label: clear of the 28 px band. */
const LABEL_GAP = 12;
const amount = (value: number) => formatAmount(value).replace(/,00/, "");

function buildOption(range: GoalAnalysis["range"], slot: number) {
  const colour = readTokens(slot);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const label = (name: string, value: number, position: "top" | "bottom") => ({
    show: true,
    position,
    offset: [0, position === "top" ? -LABEL_GAP : LABEL_GAP],
    formatter: () => `${name} ${amount(value)}`,
    color: colour.ink2,
    fontFamily: colour.font,
    fontSize: 13,
  });
  const point = (name: string, value: number, position: "top" | "bottom", size: number) => ({
    name,
    type: "scatter" as const,
    data: [[value, ROW]],
    symbol: "circle",
    symbolSize: size,
    itemStyle: { color: colour.slot, borderColor: colour.surface, borderWidth: 2 },
    label: label(name, value, position),
    z: 4,
  });
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: "value" as const,
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: colour.grid } },
      axisLabel: { ...text, formatter: (value: number) => amount(value) },
    },
    yAxis: {
      type: "category" as const,
      data: [ROW],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    series: [
      {
        name: "Band base",
        type: "bar" as const,
        stack: "range",
        data: [range.bad],
        itemStyle: { color: "transparent" },
        barWidth: 28,
        silent: true,
      },
      {
        name: "Bad to good case",
        type: "bar" as const,
        stack: "range",
        data: [range.good - range.bad],
        itemStyle: { color: colour.slot, opacity: dark ? BAND_OPACITY.dark : BAND_OPACITY.light },
        barWidth: 28,
        silent: true,
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          lineStyle: { color: colour.ink2, type: "dashed" as const, width: 1 },
          label: {
            show: true,
            position: "end" as const,
            color: colour.ink2,
            fontFamily: colour.font,
            fontSize: 13,
            formatter: `Target ${amount(range.target)}`,
          },
          data: [{ xAxis: range.target }],
        },
      },
      point("Bad case", range.bad, "bottom", 8),
      point("Typical case", range.typical, "top", 12),
      point("Good case", range.good, "bottom", 8),
    ],
  };
}

/** The range of outcomes at the goal date, bad to good case, against the target. */
export function RangeChart({
  range,
  slot,
  label,
}: {
  range: GoalAnalysis["range"];
  slot: number;
  label: string;
}) {
  const build = useCallback(() => buildOption(range, slot), [range, slot]);
  const box = useEchart(build);

  return <div className="chart chart-range" ref={box} role="img" aria-label={label} />;
}
