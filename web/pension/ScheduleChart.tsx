import { BarChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { PensionYearView } from "../../engine/pensionView.ts";
import { formatAmount } from "../money.ts";
import { readTokens, useEchart } from "../useEchart.ts";

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
  const build = useCallback(() => buildOption(rows), [rows]);
  const box = useEchart(build);

  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
