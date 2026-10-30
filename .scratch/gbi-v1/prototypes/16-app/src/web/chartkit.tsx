/* ECharts with one theme built from the CSS tokens (prototype 11: app.js registerTheme, mount, ResizeObserver). Only the used chart types are imported. */
import { useEffect, useRef } from 'react';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useStore } from './store.tsx';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export interface Colors { hl: string; hl2: string; hl3: string; ctx: string; ink: string; ink2: string; muted: string; base: string; grid: string; surface: string; raised: string; slot: string[] }
export const colors = (): Colors => ({ hl: css('--hl'), hl2: css('--hl2'), hl3: css('--hl3'), ctx: css('--ctx'), ink: css('--ink'), ink2: css('--ink2'), muted: css('--muted'), base: css('--base'), grid: css('--grid'),
  surface: css('--surface'), raised: css('--raised'), slot: [1, 2, 3, 4, 5, 6].map(n => css('--slot' + n)) });
export const isDark = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
export const bandOpacity = (): number => (isDark() ? .3 : .22);
export const alpha = (hex: string, a: number): string => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

function registerTheme(): void {
  const c = colors(), font = css('--font-text');
  const axis = { axisLine: { lineStyle: { color: c.base } }, axisTick: { lineStyle: { color: c.base } }, axisLabel: { color: c.muted, fontSize: 12, fontFamily: font }, splitLine: { lineStyle: { color: c.grid, width: 1 } } };
  echarts.registerTheme('gbi', {
    color: [c.hl, c.hl2, c.hl3], backgroundColor: 'transparent', animation: false, textStyle: { fontFamily: font, color: c.ink2, fontSize: 13 },
    categoryAxis: { ...axis, splitLine: { show: false } }, valueAxis: { ...axis, axisLine: { show: false }, axisTick: { show: false } },
    line: { lineStyle: { width: 1.5 }, symbol: 'none', symbolSize: 6 },
    tooltip: { backgroundColor: c.raised, borderColor: c.base, textStyle: { color: c.ink, fontSize: 13, fontFamily: font }, extraCssText: 'box-shadow:none;border-radius:4px;' }
  });
}
export type Build = (c: Colors, w: number, h: number) => echarts.EChartsCoreOption;

/** Draws a chart into the returned ref. Rebuilds on data/theme change and on every width change (label sizes depend on the width). */
export function useChart(build: Build, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null), { theme } = useStore();
  useEffect(() => {
    const el = ref.current; if (!el) return;
    registerTheme();
    let inst: echarts.ECharts | null = null, w = 0, t: ReturnType<typeof setTimeout>;
    const draw = (): void => {
      if (inst) inst.dispose(); inst = null; w = el.clientWidth; if (!w) return;
      inst = echarts.init(el, 'gbi', { renderer: 'svg' }); inst.setOption({ animation: false, ...build(colors(), w, el.clientHeight) });
    };
    draw();
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!inst) draw(); else if (el.clientWidth !== w) { w = el.clientWidth; inst.resize(); inst.setOption({ animation: false, ...build(colors(), w, el.clientHeight) }, true); } }, 120); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); inst?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps]);
  return ref;
}
export function Chart({ build, deps, cls, label }: { build: Build; deps: unknown[]; cls?: string; label: string }) {
  const ref = useChart(build, deps);
  return <div className={`chart ${cls ?? ''}`} ref={ref} role="img" aria-label={label} />;
}
/** Push direct labels apart: values in data units, px per unit, minimum gap in px; returns a y offset (px) per label. */
export function spread(vals: number[], pxPerUnit: number, minPx: number): number[] {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[b] - vals[a]), pos: Record<number, number> = {}; let last = -Infinity;
  idx.forEach(i => { let p = -vals[i] * pxPerUnit; if (p < last + minPx) p = last + minPx; pos[i] = p; last = p; });
  return vals.map((v, i) => pos[i] + v * pxPerUnit);
}
export const endLabel = (txt: string, c: Colors, strong: boolean) => ({ show: true, formatter: txt, color: strong ? c.ink : c.ink2, fontWeight: strong ? 600 : 400, fontSize: 13, lineHeight: 17, distance: 6 });
