import { BarChart, LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import { PLOT_GRID, readColour, useEchart } from "../useEchart.ts";

echarts.use([LineChart, BarChart, GridComponent, SVGRenderer]);

const AREA_OPACITY = { light: 0.3, dark: 0.4 };
const MARKER_SIZE = 8;

export interface ChartSeries {
  name: string;
  /** One value per month; `null` is a gap. */
  data: readonly (number | null)[];
  /** The custom property that holds the colour, for example `--hl` or `--slot3`. */
  colour: string;
  kind?: "line" | "area" | "bar";
  dashed?: boolean;
  /** Areas with the same stack name are drawn one on top of the other. */
  stack?: string;
  /** Draw a marker on every point. A `true` entry of `hollow` makes that marker hollow. */
  markers?: boolean;
  hollow?: readonly boolean[];
  /** Label the end of the line with the series name. */
  endLabel?: boolean;
}

export function buildOption(
  months: readonly string[],
  series: readonly ChartSeries[],
  format: (value: number) => string,
  zeroBase: boolean,
) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const font = readColour("--font-text");
  const text = { color: readColour("--muted"), fontFamily: font, fontSize: 12 };
  const surface = readColour("--surface");
  const hasBars = series.some((s) => s.kind === "bar");

  return {
    animation: false,
    grid: { ...PLOT_GRID },
    xAxis: {
      type: "category" as const,
      data: months,
      boundaryGap: hasBars,
      axisLine: { lineStyle: { color: readColour("--base") } },
      axisTick: { show: false },
      axisLabel: { ...text, hideOverlap: true },
    },
    yAxis: {
      type: "value" as const,
      scale: !zeroBase,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: readColour("--grid") } },
      axisLabel: { ...text, formatter: format },
    },
    series: series.map((s) => {
      const colour = readColour(s.colour);
      const base = { name: s.name, itemStyle: { color: colour } };
      if (s.kind === "bar") {
        return { ...base, type: "bar" as const, data: s.data, barMaxWidth: 24 };
      }
      return {
        ...base,
        type: "line" as const,
        data: s.data.map((value, index) =>
          s.hollow?.[index]
            ? { value, itemStyle: { color: surface, borderColor: colour, borderWidth: 2 } }
            : value,
        ),
        stack: s.stack,
        symbol: s.markers ? "circle" : "none",
        symbolSize: MARKER_SIZE,
        lineStyle: {
          width: s.kind === "area" ? 0 : 2,
          color: colour,
          type: s.dashed ? ("dashed" as const) : ("solid" as const),
        },
        areaStyle:
          s.kind === "area"
            ? { color: colour, opacity: dark ? AREA_OPACITY.dark : AREA_OPACITY.light }
            : undefined,
        endLabel: s.endLabel
          ? {
              show: true,
              formatter: "{a}",
              color: readColour("--ink2"),
              fontFamily: font,
              fontSize: 13,
            }
          : undefined,
      };
    }),
  };
}

/**
 * Monthly series as lines, areas or bars. ECharts, SVG renderer, colours from the tokens. The
 * caller shows the legend and the numbers: the chart has no tooltip.
 */
export function TimeChart({
  months,
  series,
  format,
  label,
  zeroBase = true,
}: {
  months: readonly string[];
  series: readonly ChartSeries[];
  format: (value: number) => string;
  label: string;
  /** False lets the value axis start near the data, for an index. */
  zeroBase?: boolean;
}) {
  const build = useCallback(
    () => buildOption(months, series, format, zeroBase),
    [months, series, format, zeroBase],
  );
  const box = useEchart(build);
  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
