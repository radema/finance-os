import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { GoalAnalysis } from "../../engine/goalViews.ts";
import type { OutcomeBins } from "../../engine/outcomeChart.ts";
import { formatAmount } from "../money.ts";
import { LABELS_INSIDE, readTokens, useEchart } from "../useEchart.ts";

echarts.use([LineChart, ScatterChart, GridComponent, MarkLineComponent, SVGRenderer]);

const FILL_OPACITY = { light: 0.12, dark: 0.18 };
const BAND_OPACITY = { light: 0.3, dark: 0.4 };
/** Room above the tallest bin for the typical-case label. */
const HEADROOM = 1.35;
/** Where the typical-case line ends, as a share of the axis height: under the target line, over the bins. */
const TYPICAL_HEIGHT = 0.8;
/** Pixels between a bad or good point and its label, lifting it clear of the axis line. */
const LABEL_LIFT = 14;
const LABEL_GAP = 8;
const amount = (value: number) => formatAmount(value).replace(/,00/, "");

/** The outline of the bins as a closed area, clipped to `[from, to]`: bin `i` is a step of its count. */
function outline({ min, max, counts }: OutcomeBins, from: number, to: number): [number, number][] {
  const width = (max - min) / counts.length;
  const steps = counts.flatMap((count, index): [number, number][] => {
    const left = Math.max(min + index * width, from);
    const right = Math.min(min + (index + 1) * width, to);
    return right > left
      ? [
          [left, count],
          [right, count],
        ]
      : [];
  });
  const first = steps[0];
  const last = steps.at(-1);
  return first && last ? [[first[0], 0], ...steps, [last[0], 0]] : [];
}

function buildOption(range: GoalAnalysis["range"], bins: OutcomeBins, slot: number) {
  const colour = readTokens(slot);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const opacity = (pair: typeof FILL_OPACITY) => (dark ? pair.dark : pair.light);
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  const label = (name: string, value: number) => ({
    show: true,
    formatter: `${name} ${amount(value)}`,
    color: colour.ink2,
    fontFamily: colour.font,
    fontSize: 13,
    backgroundColor: colour.surface,
    padding: [1, 3],
  });
  const peak = Math.max(...bins.counts, 1);
  const top = peak * HEADROOM;
  const guide = (name: string, value: number, height: number, style: object) => [
    {
      coord: [value, 0],
      label: { ...label(name, value), position: "end" as const },
      lineStyle: style,
    },
    { coord: [value, height] },
  ];
  const point = (name: string, value: number, position: "left" | "right") => ({
    name,
    type: "scatter" as const,
    data: [[value, 0]],
    symbol: "circle",
    symbolSize: 8,
    itemStyle: { color: colour.slot, borderColor: colour.surface, borderWidth: 2 },
    label: {
      ...label(name, value),
      position,
      offset: [position === "left" ? -LABEL_GAP : LABEL_GAP, -LABEL_LIFT],
    },
    z: 10,
  });
  return {
    animation: false,
    // The top margin holds the target label, which sits above the axis.
    grid: { left: 8, right: 16, top: 32, bottom: 8, ...LABELS_INSIDE },
    xAxis: {
      type: "value" as const,
      min: bins.min,
      max: bins.max,
      axisLine: { lineStyle: { color: colour.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...text, formatter: (value: number) => amount(value) },
    },
    yAxis: { type: "value" as const, min: 0, max: top, show: false },
    series: [
      {
        name: "Outcomes",
        type: "line" as const,
        data: outline(bins, bins.min, bins.max),
        symbol: "none",
        lineStyle: { width: 1.5, color: colour.slot },
        areaStyle: { color: colour.slot, opacity: opacity(FILL_OPACITY) },
        silent: true,
        z: 1,
      },
      {
        name: "Bad to good case",
        type: "line" as const,
        data: outline(bins, range.bad, range.good),
        symbol: "none",
        lineStyle: { width: 0 },
        areaStyle: { color: colour.slot, opacity: opacity(BAND_OPACITY) },
        silent: true,
        z: 2,
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          // Under the points, so a guide line does not cut through the bad and good labels.
          z: 3,
          data: [
            guide("Target", range.target, top, { color: colour.ink2, type: "dashed", width: 1 }),
            guide("Typical case", range.typical, top * TYPICAL_HEIGHT, {
              color: colour.slot,
              type: "solid",
              width: 2,
            }),
          ],
        },
      },
      point("Bad case", range.bad, "left"),
      point("Good case", range.good, "right"),
    ],
  };
}

/**
 * The outcomes of the simulated paths at the goal date, counted in bins, with the target, the typical
 * case and the band from the bad to the good case marked and labelled. Needs a range wider than 0.
 */
export function RangeChart({
  range,
  distribution,
  slot,
  label,
}: {
  range: GoalAnalysis["range"];
  distribution: OutcomeBins;
  slot: number;
  label: string;
}) {
  const build = useCallback(
    () => buildOption(range, distribution, slot),
    [range, distribution, slot],
  );
  const box = useEchart(build);

  return <div className="chart chart-range" ref={box} role="img" aria-label={label} />;
}
