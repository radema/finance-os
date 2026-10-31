import { BarChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { PensionYearView } from "../../engine/pensionView.ts";
import { readTokens } from "../goals/ValueChart.tsx";
import { formatAmount } from "../money.ts";

echarts.use([BarChart, GridComponent, SVGRenderer]);

const VOLUNTARY_OPACITY = 0.45;

function buildOption(rows: readonly PensionYearView[]) {
  const colour = readTokens(1);
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const bar = (name: string, data: number[], opacity: number) => ({
    name,
    type: "bar" as const,
    stack: "contributions",
    data,
    barWidth: "56%",
    itemStyle: { color: colour.slot, opacity },
  });
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: rows.map((row) => String(row.year)),
      axisLine: { lineStyle: { color: colour.grid } },
      axisTick: { show: false },
      axisLabel: text,
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: colour.grid } },
      axisLabel: { ...text, formatter: (value: number) => formatAmount(value).replace(/,00/, "") },
    },
    series: [
      bar(
        "Work",
        rows.map((row) => row.tfr + row.worker + row.employer),
        1,
      ),
      bar(
        "Voluntary",
        rows.map((row) => row.voluntary),
        VOLUNTARY_OPACITY,
      ),
    ],
  };
}

/** The yearly contributions, Work and Voluntary stacked, in the pension goal's colour (slot 1). */
export function ScheduleChart({
  rows,
  label,
}: {
  rows: readonly PensionYearView[];
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "svg" });
    const draw = () => chart.setOption(buildOption(rows), true);
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
  }, [rows]);

  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
