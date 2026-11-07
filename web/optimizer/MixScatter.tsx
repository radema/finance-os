import { ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useCallback } from "react";
import type { MixView, OptimizerRunView } from "../../engine/optimizerView.ts";
import { formatAmount, formatPercent } from "../money.ts";
import { readTokens, useEchart } from "../useEchart.ts";
import { mixText, scatterAxisStart, spreadMixes } from "./model.ts";

echarts.use([ScatterChart, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

const euros = (value: number) => formatAmount(value).replace(/,00/, "");
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildOption(view: OptimizerRunView, slot: number, names: ReadonlyMap<string, string>) {
  const colour = readTokens(slot);
  const text = { color: colour.muted, fontFamily: colour.font, fontSize: 12 };
  // The axis starts below the lowest chance and the required one, so the dots are not squeezed to one side.
  const lowest = Math.min(view.requiredP, view.current.p, ...view.mixes.map((mix) => mix.p));
  const axisMin = scatterAxisStart(lowest);
  // Dots are spread sideways so a stack reads as a group; the tooltip and the two key marks keep the true values.
  const spread = spreadMixes(view.mixes, axisMin, 1, view.requiredP).map(({ mix, x, y }) => ({
    value: [x, y],
    mix,
  }));
  const point = (mix: MixView) => ({ value: [mix.p, mix.median], mix });
  // Above for the suggested mix, below for the current one: they stay apart even when they are the same mix.
  const label = (formatter: string, position: "top" | "bottom") => ({
    show: true,
    formatter,
    position,
    distance: colour.markKey / 2 + 2,
    color: colour.ink,
    fontFamily: colour.font,
    fontSize: 13,
    fontWeight: 600,
  });
  const tip = (params: unknown) => {
    const { mix } = (params as { data: { mix: MixView } }).data;
    return `${escapeHtml(mixText(mix.weights, names))}<br/>Chance of success ${formatPercent(mix.p)}<br/>Typical case ${euros(mix.median)}`;
  };
  return {
    animation: false,
    grid: { left: 8, right: 48, top: 32, bottom: 36, containLabel: true },
    tooltip: {
      trigger: "item" as const,
      formatter: tip,
      backgroundColor: colour.raised,
      borderColor: colour.base,
      textStyle: { color: colour.ink, fontFamily: colour.font, fontSize: 13 },
    },
    xAxis: {
      type: "value" as const,
      min: axisMin,
      max: 1,
      name: "Chance of success",
      nameLocation: "middle" as const,
      nameGap: 28,
      nameTextStyle: text,
      axisLine: { lineStyle: { color: colour.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...text, formatter: (value: number) => formatPercent(value) },
    },
    yAxis: {
      type: "value" as const,
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: colour.grid } },
      axisLabel: { ...text, formatter: (value: number) => euros(value) },
    },
    series: [
      {
        name: "All mixes",
        type: "scatter" as const,
        data: spread,
        symbolSize: colour.markDot,
        itemStyle: { color: colour.muted, borderColor: colour.surface, borderWidth: 1 },
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: colour.ink2, type: "dashed" as const, width: 1.5 },
          data: [{ xAxis: view.requiredP }],
        },
      },
      {
        name: "Current mix",
        type: "scatter" as const,
        data: [point(view.current)],
        symbol: "diamond",
        symbolSize: colour.markKey,
        itemStyle: { color: colour.surface, borderColor: colour.ink2, borderWidth: 2 },
        label: label("Current mix", "bottom"),
        z: 3,
      },
      {
        name: "Suggested mix",
        type: "scatter" as const,
        data: [point(view.chosen)],
        symbolSize: colour.markKey,
        itemStyle: { color: colour.slot, borderColor: colour.ink2, borderWidth: 2 },
        label: label("Suggested mix", "top"),
        z: 4,
      },
    ],
  };
}

/** Every mix of the run: x = chance of success, y = the typical case. The suggested mix is in the goal's colour; both key marks are ringed and labelled. */
export function MixScatter({
  view,
  slot,
  names,
  label,
}: {
  view: OptimizerRunView;
  slot: number;
  names: ReadonlyMap<string, string>;
  label: string;
}) {
  const build = useCallback(() => buildOption(view, slot, names), [view, slot, names]);
  const box = useEchart(build);
  return <div className="chart" ref={box} role="img" aria-label={label} />;
}
