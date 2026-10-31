import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { FanPoint } from "../../engine/goalViews.ts";
import { formatAmount } from "../money.ts";
import { readTokens, useEchart } from "../useEchart.ts";
import { usesSlotLine } from "./outlook.ts";

echarts.use([LineChart, GridComponent, MarkLineComponent, SVGRenderer]);

const BAND_OPACITY = { light: 0.22, dark: 0.3 };
const EDGE_OPACITY = 0.6;
const amount = (value: number) => formatAmount(value).replace(/,00/, "");

function buildOption(fan: readonly FanPoint[], target: number, slot: number) {
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
    z: 2,
  });
  return {
    animation: false,
    grid: { left: 8, right: 168, top: 16, bottom: 8, containLabel: true },
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
      min: 0,
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
