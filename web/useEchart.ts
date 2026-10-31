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
    grid: token("--grid"),
    muted: token("--muted"),
    ink2: token("--ink2"),
    font: token("--font-text"),
  };
}

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
