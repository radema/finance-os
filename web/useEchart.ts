import { type EChartsCoreOption, init } from "echarts/core";
import { type RefObject, useEffect, useRef } from "react";

/** The chart colours: custom properties of the page, read when the chart is drawn. */
export function readTokens(slot: number) {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    slot: token(`--slot${slot}`),
    ctx: token("--ctx"),
    surface: token("--surface"),
    raised: token("--raised"),
    ink: token("--ink"),
    base: token("--base"),
    grid: token("--grid"),
    muted: token("--muted"),
    ink2: token("--ink2"),
    font: token("--font-text"),
    markDot: Number.parseFloat(token("--mark-dot")),
    markKey: Number.parseFloat(token("--mark-key")),
  };
}

/**
 * The plot area of the time-axis charts, the same for every chart of a screen, so the plots end at
 * one x. `right` holds the longest end label ("Typical case 1.234.567 €") whether or not the chart
 * has one. The axis labels must stay inside `outerBounds`, which runs to the right edge of the
 * chart: the last x label ("2026-10") may hang over the plot edge into that room. With
 * `containLabel` it would shrink the plot by half its own width, and the plots would end at
 * different x.
 */
export const PLOT_GRID = {
  left: 8,
  top: 16,
  right: 168,
  bottom: 8,
  outerBounds: { left: 8, top: 16, right: 0, bottom: 8 },
  outerBoundsContain: "axisLabel" as const,
};

/**
 * For a chart that sets its own `grid` margins: the axis labels stay inside those margins. It is
 * what `containLabel` did; `containLabel` itself needs the legacy ECharts module.
 */
export const LABELS_INSIDE = {
  outerBoundsMode: "same" as const,
  outerBoundsContain: "axisLabel" as const,
};

/** One custom property of the page as a colour, for example `--hl`. Read when the chart is drawn. */
export const readColour = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Draws an ECharts chart (SVG renderer) in the returned box. `build` is read when the chart is
 * drawn: after the fonts load, so the axis text is measured with Geist, and again when the colour
 * scheme changes. A new `build` redraws; wrap it in `useCallback` over what it reads.
 */
export function useEchart(build: () => EChartsCoreOption): RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: "svg" });
    const draw = () => chart.setOption(build(), true);
    let live = true;
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
  }, [build]);

  return box;
}
