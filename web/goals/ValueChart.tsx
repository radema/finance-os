import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { SeriesPoint } from "../../engine/goalViews.ts";
import { formatAmount } from "../money.ts";

echarts.use([LineChart, GridComponent, SVGRenderer]);

const AREA_OPACITY = { light: 0.3, dark: 0.4 };

/** The chart colours: custom properties of the page, read when the chart is drawn. */
export function readTokens(slot: number) {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    slot: token(`--slot${slot}`),
    ctx: token("--ctx"),
    grid: token("--grid"),
    muted: token("--muted"),
    ink2: token("--ink2"),
    font: token("--font-text"),
  };
}

function buildOption(points: readonly SeriesPoint[], slot: number) {
  const colour = readTokens(slot);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const endLabel = {
    show: true,
    formatter: "{a}",
    color: colour.ink2,
    fontFamily: colour.font,
    fontSize: 13,
  };
  return {
    animation: false,
    grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
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
      },
      {
        name: "Money put in",
        type: "line" as const,
        data: points.map((point) => point.moneyIn),
        symbol: "none",
        lineStyle: { width: 1.5, color: colour.ctx },
        itemStyle: { color: colour.ctx },
        endLabel,
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
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "svg" });
    const draw = () => chart.setOption(buildOption(points, slot), true);
    let live = true;
    // Draw after the fonts load, so the axis text is measured with Geist.
    void document.fonts.ready.then(() => live && draw());
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", draw);
    return () => {
      live = false;
      scheme.removeEventListener("change", draw);
      resize.disconnect();
      chart.dispose();
    };
  }, [points, slot]);

  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
