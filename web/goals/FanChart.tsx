import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { FanPoint } from "../../engine/goalViews.ts";
import { formatAmount } from "../money.ts";
import { PLOT_RIGHT, readTokens, useEchart } from "../useEchart.ts";
import { usesSlotLine } from "./outlook.ts";
import { fitAxis, SPREAD_END_LABELS } from "./valueAxis.ts";

echarts.use([LineChart, GridComponent, MarkLineComponent, SVGRenderer]);

const BAND_OPACITY = { light: 0.22, dark: 0.3 };
const EDGE_OPACITY = 0.6;
/** Pixels kept clear between two end labels. */
const LABEL_MARGIN = 2;
const amount = (value: number) => formatAmount(value).replace(/,00/, "");

export function buildOption(fan: readonly FanPoint[], target: number, slot: number) {
  const colour = readTokens(slot);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const line = usesSlotLine(slot) ? colour.slot : colour.ink2;
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const label = (name: string, value: number) => ({
    show: true,
    formatter: () => `${name} ${amount(value)}`,
    color: colour.ink2,
    fontFamily: colour.font,
    fontSize: 13,
    minMargin: LABEL_MARGIN,
  });
  const last = fan.at(-1) as FanPoint;
  const edge = (name: string, data: number[], endLabel: ReturnType<typeof label>) => ({
    name,
    type: "line" as const,
    data,
    symbol: "none",
    lineStyle: { width: 1, color: line, opacity: EDGE_OPACITY },
    itemStyle: { color: line },
    endLabel,
    labelLayout: SPREAD_END_LABELS,
    z: 2,
  });
  return {
    animation: false,
    grid: { left: 8, right: PLOT_RIGHT, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: fan.map((point) => String(point.year)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: colour.grid } },
      axisTick: { show: false },
      axisLabel: { ...text, hideOverlap: true },
    },
    yAxis: {
      type: "value" as const,
      ...fitAxis(
        Math.min(...fan.map((point) => point.bad)),
        Math.max(...fan.map((point) => point.good)),
        target,
      ),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: colour.grid } },
      axisLabel: { ...text, formatter: (value: number) => amount(value) },
    },
    series: [
      {
        name: "Band base",
        type: "line" as const,
        data: fan.map((point) => point.bad),
        stack: "band",
        symbol: "none",
        lineStyle: { width: 0 },
        areaStyle: { color: "transparent" },
        silent: true,
      },
      {
        name: "Bad to good case",
        type: "line" as const,
        data: fan.map((point) => point.good - point.bad),
        stack: "band",
        symbol: "none",
        lineStyle: { width: 0 },
        areaStyle: { color: colour.slot, opacity: dark ? BAND_OPACITY.dark : BAND_OPACITY.light },
        silent: true,
      },
      edge(
        "Good case",
        fan.map((point) => point.good),
        label("Good case", last.good),
      ),
      edge(
        "Bad case",
        fan.map((point) => point.bad),
        label("Bad case", last.bad),
      ),
      {
        name: "Typical case",
        type: "line" as const,
        data: fan.map((point) => point.typical),
        symbol: "none",
        lineStyle: { width: 2.25, color: line },
        itemStyle: { color: line },
        endLabel: label("Typical case", last.typical),
        labelLayout: SPREAD_END_LABELS,
        z: 4,
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          lineStyle: { color: colour.ink2, type: "dashed" as const, width: 1 },
          label: {
            show: true,
            position: "insideStartTop" as const,
            color: colour.ink2,
            fontFamily: colour.font,
            fontSize: 13,
            formatter: `Target ${amount(target)}`,
          },
          data: [{ yAxis: target }],
        },
      },
    ],
  };
}

/** The fan of outcomes: bad, typical and good case net value by year, with the target line. */
export function FanChart({
  fan,
  target,
  slot,
  label,
}: {
  fan: readonly FanPoint[];
  target: number;
  slot: number;
  label: string;
}) {
  const build = useCallback(() => buildOption(fan, target, slot), [fan, target, slot]);
  const box = useEchart(build);

  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
