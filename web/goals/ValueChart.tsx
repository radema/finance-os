import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { SeriesPoint } from "../../engine/goalViews.ts";
import { formatAmount } from "../money.ts";
import { PLOT_GRID, readTokens, useEchart } from "../useEchart.ts";
import { fitAxis, SPREAD_END_LABELS } from "./valueAxis.ts";

echarts.use([LineChart, GridComponent, SVGRenderer]);

const AREA_OPACITY = { light: 0.3, dark: 0.4 };
/** Pixels kept clear between the two end labels. */
const LABEL_MARGIN = 2;

export function buildOption(points: readonly SeriesPoint[], slot: number) {
  const colour = readTokens(slot);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const endLabel = {
    show: true,
    formatter: "{a}",
    color: colour.ink2,
    fontFamily: colour.font,
    fontSize: 13,
    minMargin: LABEL_MARGIN,
  };
  const amounts = points.flatMap((point) =>
    point.value === null ? [point.moneyIn] : [point.value, point.moneyIn],
  );
  return {
    animation: false,
    grid: { ...PLOT_GRID },
    xAxis: {
      type: "category" as const,
      data: points.map((point) => point.month),
      boundaryGap: false,
      axisLine: { lineStyle: { color: colour.grid } },
      axisTick: { show: false },
      axisLabel: { ...text, hideOverlap: true },
    },
    yAxis: {
      type: "value" as const,
      ...fitAxis(Math.min(...amounts), Math.max(...amounts)),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: colour.grid } },
      axisLabel: { ...text, formatter: (value: number) => formatAmount(value).replace(/,00/, "") },
    },
    series: [
      {
        name: "Value",
        type: "line" as const,
        data: points.map((point) => point.value),
        symbol: "none",
        lineStyle: { width: 0 },
        areaStyle: { color: colour.slot, opacity: dark ? AREA_OPACITY.dark : AREA_OPACITY.light },
        endLabel,
        labelLayout: SPREAD_END_LABELS,
      },
      {
        name: "Money put in",
        type: "line" as const,
        data: points.map((point) => point.moneyIn),
        symbol: "none",
        lineStyle: { width: 1.5, color: colour.ctx },
        itemStyle: { color: colour.ctx },
        endLabel,
        labelLayout: SPREAD_END_LABELS,
      },
    ],
  };
}

/** Value against money put in, one month per point. ECharts, SVG renderer, colours from the tokens. */
export function ValueChart({
  points,
  slot,
  label,
}: {
  points: readonly SeriesPoint[];
  slot: number;
  label: string;
}) {
  const build = useCallback(() => buildOption(points, slot), [points, slot]);
  const box = useEchart(build);

  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
