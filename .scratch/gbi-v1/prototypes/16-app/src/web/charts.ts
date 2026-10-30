/* ECharts option builders, ported from prototype 11 (dashboard.html, goal.html, independence.html, app.js) onto the live overview. */
import { alpha, bandOpacity, endLabel, spread } from './chartkit.tsx';
import type { Build, Colors } from './chartkit.tsx';
import { eur, eurK, monthLabel, niceMax, pct } from './format.ts';
import { shortName } from './ui.tsx';
import type { GoalView, Overview } from '../shared/view.ts';
import type { FireOut } from '../engine/core.ts';

export type Slot = (id: string) => number;
const LINE_OK = [1, 2, 5];
const gcol = (c: Colors, slot: Slot, id: string, line = false): string => (line && !LINE_OK.includes(slot(id)) ? c.ctx : c.slot[slot(id) - 1]);
const stackOrder = (goals: GoalView[], slot: Slot): string[] => goals.map(g => g.id).sort((a, b) => slot(a) - slot(b));
const L = (data: unknown[], wd: number, col: string) => ({ type: 'line', data, symbol: 'none', lineStyle: { width: wd, color: col }, itemStyle: { color: col }, emphasis: { disabled: true } });
const yAxisK = (c: Colors) => ({ type: 'value', min: 0, axisLabel: { formatter: (v: number) => (v === 0 ? '€0' : eurK(v)), color: c.muted, fontSize: 12 } });

export const heroChart = (goals: GoalView[], slot: Slot): Build => (c, w) => {
  const order = goals.slice().sort((a, b) => (a.prob - a.reqP) - (b.prob - b.reqP)), small = w < 520, names = order.map(g => (small ? shortName(g.name) : g.name));
  return {
    grid: { left: 0, right: small ? 118 : 150, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => { const g = order[p.dataIndex]; return g ? `${g.name}<br>${pct(g.prob)} chance, ${pct(g.reqP)} required` : ''; } },
    xAxis: { type: 'value', min: 0, max: 100, show: false },
    yAxis: { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: c.base } }, axisLabel: { color: c.ink2, fontSize: 13, width: small ? 84 : 140, overflow: 'break', lineHeight: 16, margin: 10 } },
    series: [
      { type: 'bar', barWidth: 14, data: order.map(g => ({ value: g.prob * 100, itemStyle: { color: gcol(c, slot, g.id) } })), z: 2 },
      { type: 'scatter', symbol: 'rect', symbolSize: [2, 26], z: 5, tooltip: { show: false }, itemStyle: { color: c.ink }, data: order.map((g, i) => [g.reqP * 100, names[i]]) },
      { type: 'scatter', symbol: 'circle', symbolSize: 0, z: 1, silent: true, data: order.map((g, i) => ({ value: [Math.max(g.prob, g.reqP) * 100, names[i]],
        label: { show: true, position: 'right', distance: 8, fontSize: 13, color: g.status !== 'on' ? c.ink : c.ink2, fontWeight: g.status !== 'on' ? 600 : 400, formatter: g.status !== 'on' ? `${pct(g.prob)} · needs ${pct(g.reqP)}` : pct(g.prob) } })) }
    ]
  };
};

/** Net worth by goal, stacked, against money put in. Each goal's series starts at its own first transaction, so months are aligned on the "all" series. */
export const nwChart = (ov: Overview, slot: Slot): Build => (c, w) => {
  const all = ov.perf.all!.rows, small = w < 520, last = all[all.length - 1], ids = stackOrder(ov.goals, slot);
  const val = (id: string): number[] => { const m = new Map((ov.perf[id]?.rows ?? []).map(r => [r[0], r[1]])); return all.map(r => m.get(r[0]) ?? 0); };
  return {
    grid: { left: 4, right: small ? 92 : 100, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => eur(v) },
    xAxis: { type: 'category', data: all.map(r => r[0]), boundaryGap: false, axisLabel: { interval: small ? 11 : 5, color: c.muted, fontSize: 12, formatter: monthLabel } },
    yAxis: yAxisK(c),
    series: [...ids.map(id => ({ name: shortName(ov.goals.find(g => g.id === id)!.name), type: 'line', stack: 'nw', symbol: 'none', data: val(id), z: 2, lineStyle: { width: 1, color: c.surface }, areaStyle: { color: gcol(c, slot, id), opacity: .92 }, itemStyle: { color: gcol(c, slot, id) }, emphasis: { disabled: true } })),
      { name: 'Money put in', type: 'line', data: all.map(r => r[2]), symbol: 'none', z: 5, lineStyle: { width: 1.5, color: c.ink2, type: 'dashed' }, itemStyle: { color: c.ink2 }, emphasis: { disabled: true }, endLabel: { ...endLabel(`Put in ${eurK(last[2])}`, c, false), offset: [0, 10] } },
      { name: 'Value', type: 'line', data: all.map(r => r[1]), symbol: 'none', z: 0, silent: true, tooltip: { show: false }, lineStyle: { width: 0 }, itemStyle: { color: 'transparent' }, endLabel: { ...endLabel(`Value ${eurK(last[1])}`, c, true), offset: [0, -4] } }]
  };
};

/** Chance of success per goal at each month-end snapshot plus today. Three coloured lines, the rest grey. */
export const trendChart = (ov: Overview, slot: Slot, focus: string): Build => (c, w, h) => {
  const small = w < 520, dates = ov.snaps.map(s => s.month).concat(ov.valMonth), ids = stackOrder(ov.goals, slot);
  const series = (id: string): number[] => ov.snaps.map(s => s.goals.find(g => g.id === id)?.prob ?? 0).concat(ov.goals.find(g => g.id === id)!.prob).map(v => Math.round(v * 1000) / 10);
  const colored = ids.filter(id => LINE_OK.includes(slot(id))), ppu = (h - 34) / 100, ends = colored.map(id => series(id).at(-1)!), off = spread(ends, ppu, small ? 30 : 15);
  return {
    grid: { left: 4, right: small ? 84 : 108, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v + '%' },
    xAxis: { type: 'category', data: dates, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: small ? 3 : 1, formatter: monthLabel } },
    yAxis: { type: 'value', min: 0, max: 100, interval: 25, axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => v + '%' } },
    series: ids.slice().sort((a, b) => Number(colored.includes(a)) - Number(colored.includes(b))).map(id => {
      const k = colored.indexOf(id), col = gcol(c, slot, id, true), hot = k >= 0, nm = shortName(ov.goals.find(g => g.id === id)!.name);
      return { name: nm, ...L(series(id), hot ? 2.25 : 1.5, col), z: hot ? 4 : 2, ...(hot ? { endLabel: { ...endLabel(`${nm}${small ? '\n' : ' '}${Math.round(ends[k])}%`, c, id === focus), offset: [0, off[k]] } } : {}) };
    })
  };
};

export const rangeChart = (goals: GoalView[], slot: Slot): Build => (c, w) => {
  const rg = goals.slice().sort((a, b) => a.year - b.year), small = w < 520, names = rg.map(g => (small ? shortName(g.name) : g.name)), pc = (v: number, g: GoalView): number => Math.round(v / g.targetNom * 100);
  const mx = niceMax(Math.max(150, ...rg.map(g => pc(g.p90, g))));
  const lab = (i: number, key: number, txt: string) => ({ value: [key, names[i]], label: { show: true, position: 'right', distance: 6, fontSize: 13, lineHeight: 16, color: c.ink2, formatter: txt, rich: { b: { color: c.ink, fontWeight: 600, fontSize: 13, lineHeight: 16 } } } });
  return {
    grid: { left: 0, right: small ? 86 : 104, top: 22, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => { const g = rg[p.dataIndex]; return g ? `${g.name}, ${g.year}<br>Good case ${pc(g.p90, g)}% of target<br>Typical ${pc(g.median, g)}%<br>Bad case ${pc(g.p10, g)}%` : ''; } },
    xAxis: { type: 'value', min: 50, max: mx, interval: 50, axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => (small && v % 100 ? '' : v + '%') }, splitLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: c.base } }, axisLabel: { color: c.ink2, fontSize: 13, width: small ? 74 : 130, overflow: 'break', lineHeight: 16, margin: 10 } },
    series: [
      { type: 'bar', stack: 'r', barWidth: 16, silent: true, itemStyle: { color: 'transparent' }, data: rg.map(g => Math.max(50, pc(g.p10, g))) },
      { type: 'bar', stack: 'r', barWidth: 16, z: 2, data: rg.map(g => ({ value: Math.max(0, pc(g.p90, g) - Math.max(50, pc(g.p10, g))), itemStyle: { color: alpha(gcol(c, slot, g.id), bandOpacity() + .08), borderColor: gcol(c, slot, g.id), borderWidth: 1 } })) },
      { type: 'scatter', symbol: 'rect', symbolSize: [3, 22], z: 6, tooltip: { show: false }, data: rg.map((g, i) => ({ value: [Math.max(50, pc(g.median, g)), names[i]], itemStyle: { color: gcol(c, slot, g.id) } })),
        markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: c.ink2, type: 'dashed', width: 1 }, label: { show: true, position: 'start', distance: 4, color: c.ink2, fontSize: 13, formatter: 'Target' }, data: [{ xAxis: 100 }] } },
      { type: 'scatter', symbolSize: 0, silent: true, z: 1, data: rg.map((g, i) => lab(i, Math.max(50, pc(g.p90, g)), g.p10 < g.targetNom ? `{b|bad case ${pc(g.p10, g)}%}\ntypical ${pc(g.median, g)}%` : `typical ${pc(g.median, g)}%`)) }
    ]
  };
};

export const capChart = (ov: Overview, slot: Slot): Build => (c, w) => {
  const cap = ov.capacity, small = w < 520, ids = stackOrder(ov.goals, slot), cl = cap[cap.length - 1];
  return {
    grid: { left: 4, right: small ? 84 : 112, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => eur(v) },
    xAxis: { type: 'category', data: cap.map(r => r.year), axisLabel: { color: c.muted, fontSize: 12, interval: small ? 1 : 0 } },
    yAxis: { type: 'value', axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? '€0' : eurK(v)) } },
    series: [...ids.map(id => ({ name: shortName(ov.goals.find(g => g.id === id)!.name), type: 'bar', stack: 'plan', barMaxWidth: 26, data: cap.map(r => r.per[id] ?? 0), itemStyle: { color: gcol(c, slot, id), borderColor: c.surface, borderWidth: 1 } })),
      { name: 'Savings capacity', ...L(cap.map(r => r.capacity), 2.25, c.ink), z: 5, endLabel: { ...endLabel(`Capacity${small ? '\n' : ' '}${eurK(cl.capacity)}`, c, true), offset: [0, -2] } }]
  };
};

/** "% of target per year" (ticket 07). Level 2 = the message, Level 3 = context. Level 1 is left out: it starts above the scale. */
export const fiPctChart = (fire: FireOut): Build => (c, w) => {
  const small = w < 520, rows = fire.rows, n = rows.length - 1, years = rows.map(r => r.year);
  const L2 = rows.map(r => Math.round(r.ratio[1] * 100)), L3 = rows.map(r => Math.round(r.ratio[2] * 100)), lab = (name: string, v: number) => (small ? `${name}\n${v}%` : `${name} ${v}%`);
  const mx = Math.max(250, Math.min(400, Math.ceil(Math.max(...L2, ...L3) / 50) * 50));
  return {
    grid: { left: 4, right: small ? 66 : 110, top: 14, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (ps: { dataIndex: number }[]) => { const t = ps[0].dataIndex; return `<b>${years[t]}</b><br>Level 2: ${L2[t]}% of target<br>Level 3: ${L3[t]}% of target`; } },
    xAxis: { type: 'category', data: years, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: small ? 12 : 7 } },
    yAxis: { type: 'value', min: 0, max: mx, interval: 50, axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => v + '%' } },
    series: [{ ...L(L3, 1.5, c.ctx), z: 2, endLabel: endLabel(lab('Level 3', L3[n]), c, false) },
      { ...L(L2, 2.25, c.hl), z: 4, endLabel: endLabel(lab('Level 2', L2[n]), c, true), markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: c.ink2, type: 'dashed', width: 1 }, label: { show: true, position: 'insideStartTop', color: c.ink2, fontSize: 13, formatter: 'Target reached' }, data: [{ yAxis: 100 }] } }]
  };
};

/** Monte Carlo fan of one goal: soft band in the goal colour, solid median, dashed target. */
export const fanChart = (g: GoalView, slot: Slot, startYear: number): Build => (c, w) => {
  const small = w < 520, f = g.fan, col = gcol(c, slot, g.id), years = f.p50.map((_, t) => startYear + t), n = f.p50.length - 1, max = niceMax(Math.max(f.p90[n], g.targetNom));
  const lab = (name: string, v: number) => (small ? `${name}\n${eurK(v)}` : `${name} ${eurK(v)}`);
  return {
    grid: { left: 4, right: small ? 76 : 128, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: c.base } }, formatter: (ps: { dataIndex: number }[]) => { const t = ps[0].dataIndex; return `<b>${years[t]}</b><br>Good case ${eur(f.p90[t])}<br>Typical ${eur(f.p50[t])}<br>Bad case ${eur(f.p10[t])}`; } },
    xAxis: { type: 'category', data: years, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: n <= 3 ? 0 : (small ? Math.ceil(n / 3) - 1 : Math.ceil(n / 6) - 1) } },
    yAxis: { ...yAxisK(c), max },
    series: [
      { type: 'line', data: f.p10, stack: 'band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
      { type: 'line', data: f.p90.map((v, i) => v - f.p10[i]), stack: 'band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: col, opacity: bandOpacity() }, silent: true, tooltip: { show: false } },
      { ...L(f.p90, 1, alpha(col, .6)), endLabel: endLabel(lab('Good case', f.p90[n]), c, false), z: 2 },
      { ...L(f.p10, 1, alpha(col, .6)), endLabel: endLabel(lab('Bad case', f.p10[n]), c, false), z: 2 },
      { ...L(f.p50, 2.5, col), endLabel: endLabel(lab('Typical', f.p50[n]), c, true), z: 4,
        markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: c.ink2, type: 'dashed', width: 1 }, label: { show: true, position: 'insideStartTop', color: c.ink2, fontSize: 13, formatter: `Target ${eurK(g.targetNom)}` }, data: [{ yAxis: g.targetNom }] } }
    ]
  };
};

export const perfChart = (rows: [string, number, number][], slot: number): Build => (c, w) => {
  const small = w < 520, last = rows[rows.length - 1], col = c.slot[slot - 1];
  return {
    grid: { left: 4, right: small ? 92 : 108, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => eur(v) },
    xAxis: { type: 'category', data: rows.map(r => r[0]), boundaryGap: false, axisLabel: { interval: small ? 11 : 5, color: c.muted, fontSize: 12, formatter: monthLabel } },
    yAxis: yAxisK(c),
    series: [{ name: 'Value', ...L(rows.map(r => r[1]), 2.5, col), z: 3, endLabel: { ...endLabel(`Value ${eurK(last[1])}`, c, true), offset: [0, -8] } },
      { name: 'Put in', ...L(rows.map(r => r[2]), 1.5, c.ctx), z: 2, endLabel: { ...endLabel(`Put in ${eurK(last[2])}`, c, false), offset: [0, 8] } }]
  };
};

/** Independence: funding of each level, one segment per counted goal (ticket 07: Level 1 without pension). */
export const levelsChart = (ov: Overview, slot: Slot, counted: Set<string>): Build => (c, w) => {
  const fire = ov.fire!, lv = fire.levels, small = w < 520, ids = stackOrder(ov.goals, slot), names = lv.map(l => `Level ${l.n} · ${l.name}`);
  const seg = (id: string, i: number): number => { const g = ov.goals.find(x => x.id === id)!; return counted.has(id) && !(g.isP && i === 0) && (!g.isP || fire.includePension) ? g.netNow / lv[i].target : 0; };
  const tot = (i: number): number => ids.reduce((a, id) => a + seg(id, i), 0), k = (i: number): number => Math.min(1, 1 / (tot(i) || 1));
  const measure = (i: number): number => tot(i) * lv[i].target, next = lv.findIndex((l, i) => measure(i) < l.target);
  return {
    grid: { left: 0, right: small ? 100 : 170, top: 6, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p: { seriesName: string }) => { const g = ov.goals.find(x => shortName(x.name) === p.seriesName); return g ? `${g.name}: ${eur(g.netNow)} net` : ''; } },
    xAxis: { type: 'value', min: 0, max: 100, show: false },
    yAxis: { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: c.base } }, axisLabel: { color: c.ink2, fontSize: 13, width: small ? 84 : 150, overflow: 'break', lineHeight: 16, margin: 10 } },
    series: [...ids.map(id => ({ name: shortName(ov.goals.find(g => g.id === id)!.name), type: 'bar', stack: 'a', barWidth: 16, data: lv.map((_, i) => seg(id, i) * k(i) * 100), itemStyle: { color: gcol(c, slot, id), borderColor: c.surface, borderWidth: 1 } })),
      { type: 'scatter', symbol: 'circle', symbolSize: 0, silent: true, data: lv.map((l, i) => ({ value: [Math.min(1, tot(i)) * 100, names[i]], label: { show: true, position: 'right', distance: 8, fontSize: 13, color: i === next ? c.ink : c.ink2, fontWeight: i === next ? 600 : 400,
        formatter: measure(i) >= l.target ? 'Reached' : `${pct(Math.min(1, tot(i)))} · ${eurK(measure(i))} of ${eurK(l.target)}` } })) }]
  };
};

export const projChart = (fire: FireOut): Build => (c, w) => {
  const small = w < 520, rows = fire.rows, n = rows.length - 1, years = rows.map(r => r.year), lv = fire.levels, lab = (name: string, v: number) => (small ? `${name}\n${eurK(v)}` : `${name} ${eurK(v)}`);
  const p10 = rows.map(r => r.p10), p50 = rows.map(r => r.p50), p90 = rows.map(r => r.p90);
  const tline = (i: number, pos: string) => { const d: unknown[] = rows.map(r => Math.round(r.targets[i])); d[0] = { value: d[0], label: { show: true, position: pos, align: 'left', distance: 4, color: c.ink2, fontSize: 13, formatter: `Level ${lv[i].n} ${eurK(lv[i].target)}` } };
    return { ...L(d, 1, c.ink2), symbol: 'circle', symbolSize: 1, showSymbol: true, lineStyle: { width: 1, color: c.ink2, type: 'dashed' }, z: 3, silent: true, tooltip: { show: false } }; };
  return {
    grid: { left: 4, right: small ? 76 : 128, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (ps: { dataIndex: number }[]) => { const t = ps[0].dataIndex; return `<b>${years[t]}</b><br>Good case ${eur(p90[t])}<br>Typical ${eur(p50[t])}<br>Bad case ${eur(p10[t])}<br>Level 2 reached in ${pct(rows[t].probs[1])} of markets<br>Level 3 in ${pct(rows[t].probs[2])}`; } },
    xAxis: { type: 'category', data: years, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: small ? 12 : 7 } },
    yAxis: { ...yAxisK(c), max: niceMax(Math.max(...p90, ...rows.map(r => r.targets[2]))) },
    series: [
      { type: 'line', data: p10, stack: 'band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
      { type: 'line', data: p90.map((v, i) => v - p10[i]), stack: 'band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: c.hl, opacity: bandOpacity() }, silent: true, tooltip: { show: false } },
      { ...L(p90, 1, alpha(c.hl, .55)), endLabel: endLabel(lab('Good case', p90[n]), c, false), z: 2 },
      { ...L(p10, 1, alpha(c.hl, .55)), endLabel: endLabel(lab('Bad case', p10[n]), c, false), z: 2 },
      { ...L(p50, 2.25, c.hl), endLabel: endLabel(lab('Typical', p50[n]), c, true), z: 4 }, tline(1, 'bottom'), tline(2, 'top')
    ]
  };
};

/** Cumulative plan against what was put in, per goal (ticket 10). */
export const pvaChart = (months: string[], planned: number[], actual: number[], slotNo: number): Build => (c, w) => {
  const small = w < 520, col = c.slot[slotNo - 1];
  return {
    grid: { left: 4, right: small ? 84 : 112, top: 12, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => eur(v) },
    xAxis: { type: 'category', data: months, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: small ? 3 : 0, formatter: monthLabel } },
    yAxis: yAxisK(c),
    series: [{ name: 'Plan', ...L(planned, 1.5, c.ink2), lineStyle: { width: 1.5, color: c.ink2, type: 'dashed' }, endLabel: { ...endLabel(`Plan ${eurK(planned.at(-1) ?? 0)}`, c, false), offset: [0, -8] } },
      { name: 'Put in', ...L(actual, 2.5, col), endLabel: { ...endLabel(`Put in ${eurK(actual.at(-1) ?? 0)}`, c, true), offset: [0, 8] } }]
  };
};

/** Optimizer: every mix, x = chance of success, y = median. The chosen and the current mix are marked. */
export const scatterChart = (pts: { prob: number; median: number }[], best: { prob: number; median: number }, cur: { prob: number; median: number }, req: number): Build => (c, w) => {
  const small = w < 520;
  return {
    grid: { left: 4, right: small ? 70 : 100, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p: { value: number[] }) => `${pct(p.value[0], 1)} chance<br>median ${eur(p.value[1])}` },
    xAxis: { type: 'value', min: Math.max(0, Math.floor(Math.min(...pts.map(p => p.prob)) * 20) / 20), max: 1.02, axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => (v > 1 ? '' : Math.round(v * 100) + '%') }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: c.muted, fontSize: 12, formatter: (v: number) => eurK(v) } },
    series: [{ type: 'scatter', symbolSize: 7, itemStyle: { color: alpha(c.ctx, .8) }, data: pts.map(p => [p.prob, p.median]),
      markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: c.ink2, type: 'dashed', width: 1 }, label: { show: true, position: 'insideEndTop', color: c.ink2, fontSize: 13, formatter: `Required ${pct(req)}` }, data: [{ xAxis: req }] } },
    { type: 'scatter', symbolSize: 13, z: 5, itemStyle: { color: c.hl }, data: [{ value: [best.prob, best.median], label: { show: true, position: 'right', formatter: 'Suggested', color: c.ink, fontSize: 13, fontWeight: 600 } }] },
    { type: 'scatter', symbolSize: 11, z: 4, symbol: 'diamond', itemStyle: { color: c.ink }, data: [{ value: [cur.prob, cur.median], label: { show: true, position: 'left', formatter: 'Current', color: c.ink2, fontSize: 13 } }] }]
  };
};
