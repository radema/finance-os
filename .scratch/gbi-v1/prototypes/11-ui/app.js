/* PROTOTYPE shared code (ticket 11): formatters, shell, glossary popover, ECharts theme from tokens. Throwaway. */
(function () {
  const G = window.GBI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- formatters (en-GB; the real app localises) ---------- */
  const eur = n => (n < 0 ? '−' : '') + '€' + Math.abs(Math.round(n)).toLocaleString('en-GB');
  const eur2 = n => '€' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eurK = n => {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e6) return s + '€' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'm';
    if (a >= 1e4) return s + '€' + Math.round(a / 1e3) + 'k';
    if (a >= 1e3) return s + '€' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return s + '€' + Math.round(a);
  };
  const pct = (p, d) => (p * 100).toFixed(d || 0) + '%';
  const sgn = (p, d) => (p >= 0 ? '+' : '−') + (Math.abs(p) * 100).toFixed(d == null ? 1 : d) + '%';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MON[m - 1] + ' ' + y; };
  const dtShort = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MON[m - 1]; };
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  /* ---------- sample-data helpers ---------- */
  const goal = id => G.goals.find(g => g.id === id);
  const prod = id => G.products.find(p => p.id === id);
  const STATUS = { on: 'On track', risk: 'At risk', off: 'Off track' };
  const REQ_PLAIN = { Need: 'Need', Want: 'Want', Wish: 'Wish' };

  /* One fixed colour per goal, by palette slot, the same in every chart. Slots 1, 2, 5 (highlight, orange, teal) are the ones lines may use;
     slots 3, 4, 6 (green, ochre, olive) appear only in stacked bars and areas, which follow slot order 1 to 6 (STACK). */
  const GOAL_SLOT = { g6: 1, g2: 2, g3: 3, g4: 4, g5: 5, g1: 6 };
  const STACK = ['g6', 'g2', 'g3', 'g4', 'g5', 'g1'];
  const SHORT = { g1: 'Emergency', g2: 'Parents', g3: 'Children', g4: 'MIP', g5: 'Long-term', g6: 'Retirement' };
  const LINE_OK = [1, 2, 5];
  const gdot = id => `<i class="gdot" style="background:var(--slot${GOAL_SLOT[id]})"></i>`;
  const slotVars = id => `--g:var(--slot${GOAL_SLOT[id]});--gt:var(--tint${GOAL_SLOT[id]})`;
  const gchip = (id, label) => `<span class="gchip" style="${slotVars(id)}"><i></i>${esc(label || goal(id).name)}</span>`;
  const prTag = pri => `<span class="ptag pr-${pri.toLowerCase()}"><i></i>${esc(pri)}</span>`;
  /* product kind for the small tag (prototype rule: BTP by name, pension funds by name, everything else an ETF) */
  const kindOf = p => /^BTP/.test(p.name) ? 'BTP' : /Allianz Insieme|Fon\.Te/.test(p.name) ? 'Pension' : 'ETF';
  const kindTag = p => `<span class="ktag k-${kindOf(p).toLowerCase()}">${kindOf(p)}</span>`;
  /* legend items: [kind, css colour, label]; kind = sw (swatch), ln, ln dash, bd (band), tk (tick) */
  const legend = items => `<ul class="legend" aria-label="Legend">${items.map(([k, col, l]) => `<li class="lg"><i class="${k}" style="--c:${col}"></i>${esc(l)}</li>`).join('')}</ul>`;
  const goalItems = ids => ids.map(id => ['sw', `var(--slot${GOAL_SLOT[id]})`, SHORT[id]]);
  const goalLegend = (ids, extra) => legend(goalItems(ids).concat(extra || []));
  const monthLabel = v => { const [y, m] = v.split('-'); return MON[+m - 1] + ' ' + y.slice(2); };

  /* net worth value per product (all goals) + price age */
  function priceInfo() {
    const val = {};
    Object.values(G.holdings).forEach(items => items.forEach(i => { val[i.pid] = (val[i.pid] || 0) + i.value; }));
    const rows = Object.keys(val).map(pid => {
      const p = prod(pid), asOf = G.priceAsOf[pid], age = days(asOf, G.asOf);
      return { pid, name: p.name, source: p.source, asOf, age, old: age > G.staleDays, value: val[pid] };
    }).sort((a, b) => b.age - a.age || b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0), oldRows = rows.filter(r => r.old);
    const oldValue = oldRows.reduce((a, r) => a + r.value, 0), oldest = rows[0];
    return { rows, total, oldRows, oldValue, oldShare: oldValue / total, oldest };
  }
  const ageText = age => age <= 1 ? (age === 0 ? 'today' : 'yesterday') : age + ' days old';

  /* ---------- icons (inline, stroke = currentColor) ---------- */
  const SV = (p, extra) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ''}>${p}</svg>`;
  const ICON = {
    overview: SV('<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>'),
    goals: SV('<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/>'),
    tx: SV('<path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3"/>'),
    indep: SV('<path d="M3 16h14M5 16V9l5-5 5 5v7"/><path d="M8 16v-4h4v4"/>'),
    ok: SV('<circle cx="10" cy="10" r="7"/><path d="M6.8 10.2l2.2 2.2 4.2-4.6"/>'),
    risk: SV('<path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.2M10 14v.1"/>'),
    off: `<svg viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.2M10 14v.1" stroke="var(--surface)" stroke-linecap="round"/></svg>`,
    dash: SV('<circle cx="10" cy="10" r="7"/><path d="M6.5 10h7"/>'),
    plus: SV('<path d="M10 4v12M4 10h12"/>'),
    inn: SV('<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>'),
    out: SV('<path d="M10 14V4M6 8l4-4 4 4M4 16h12"/>'),
    info: SV('<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.2v.1"/>'),
    clock: SV('<circle cx="10" cy="10" r="7"/><path d="M10 6v4.4l2.8 1.6"/>'),
    trend: SV('<path d="M3 15l5-5 3 3 6-7M13 6h4v4"/>'),
    wallet: SV('<rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3 8.5h14M13 12h2"/>'),
    flag: SV('<path d="M5 17V4M5 4h9l-2 3 2 3H5"/>'),
    chart: SV('<path d="M3 16h14M5 13l3-4 3 2 4-6"/>'),
    menu: SV('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>'),
    close: SV('<path d="M5 5l10 10M15 5L5 15"/>'),
    analysis: SV('<path d="M3 16h14M5 13V9M9 13V5M13 13V8M17 13v-5"/>'),
    pension: SV('<path d="M10 3.5c-2.6 0-4.5 1.6-4.5 3.8 0 3.6 4.5 4.4 4.5 7.2M10 3.5c2.6 0 4.5 1.6 4.5 3.8M5 16.5h10"/>'),
    ops: SV('<path d="M4 5h12M4 10h12M4 15h8"/>'),
    setup: SV('<path d="M4 6h8M15 6h1M4 14h1M8 14h8"/><circle cx="13.5" cy="6" r="1.7"/><circle cx="6.5" cy="14" r="1.7"/>')
  };
  const statusHTML = s => `<span class="status ${s}"><span class="${s === 'on' ? 'ic-ok' : 'ic-hl'}">${ICON[s === 'on' ? 'ok' : s]}</span>${STATUS[s]}</span>`;
  const glyph = k => `<span class="glyph">${ICON[k]}</span>`;
  const term = (key, label) => `<button type="button" class="term" data-t="${key}" aria-haspopup="dialog">${esc(label || G.glossary[key][0])}</button>`;
  const ageHTML = (info) => `<span class="age ${info.old ? 'old' : ''}"><i></i>${info.old ? 'Old price · ' : ''}${dtShort(info.asOf)} (${ageText(info.age)})</span>`;

  /* ---------- theme ---------- */
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('gbi-proto-theme', t); } catch (e) { /* ignore */ }
    $$('.theme-toggle').forEach(b => { b.textContent = isDark() ? 'Light mode' : 'Dark mode'; });
    redrawCharts();
  }

  /* ---------- shell ---------- */
  /* [label, href, key, soon?]. Screens that are not built lead to placeholder.html?s=<key>. */
  const PH = k => 'placeholder.html?s=' + k;
  const NAV = [
    { label: 'Overview', icon: 'overview', href: 'dashboard.html', key: 'dashboard' },
    { label: 'Goals', icon: 'goals', items: [['List', 'goals.html', 'goals'], ['Detail', 'goal.html', 'goal'], ['History', PH('history'), 'history', 1]] },
    { label: 'Independence', icon: 'indep', href: 'independence.html', key: 'indep' },
    { label: 'Analysis', icon: 'analysis', items: [['Optimizer', PH('optimizer'), 'optimizer', 1], ['Performance', PH('performance'), 'performance', 1], ['Plan vs actual', PH('plan'), 'plan', 1]] },
    { label: 'Pension', icon: 'pension', href: PH('pension'), key: 'pension', soon: 1 },
    { label: 'Operations', icon: 'ops', items: [['Transactions', 'transactions.html', 'tx'], ['Import', 'transactions.html#import', 'import'], ['Prices', PH('prices'), 'prices', 1]] },
    { label: 'Setup', icon: 'setup', items: [['Products', PH('products'), 'products', 1], ['Allocation', PH('allocation'), 'allocation', 1], ['Cash flow', PH('cashflow'), 'cashflow', 1],
      ['Assumptions', PH('assumptions'), 'assumptions', 1], ['Glossary', PH('glossary'), 'glossary', 1]] }
  ];
  /* what each placeholder will hold: title, one sentence */
  const PLACEHOLDERS = {
    history: ['Goal history', 'The goal analysis saved on a date, to see whether your plans are getting better or worse. The Overview already draws the chance-of-success trend per goal.'],
    optimizer: ['Optimizer', 'Where to put the next contribution so each goal gets closer to its required probability.'],
    performance: ['Performance', 'How each goal and the whole portfolio have done: time-weighted and money-weighted return, drawdown.'],
    plan: ['Plan vs actual', 'What the plan said you would put in against what you did, per goal and per month.'],
    pension: ['Pension', 'Your pension funds, contributions, the tax refund and what counts toward independence.'],
    prices: ['Prices', 'Every product with its price, its date and its source; enter prices by hand or fetch them online.'],
    products: ['Products', 'The funds, bonds and ETCs you hold or may hold, with ISIN, ticker and price source.'],
    allocation: ['Allocation', 'The target mix per goal and the correlation between asset classes used in the simulations.'],
    cashflow: ['Cash flow', 'Income, essential and optional spending, one-off events and the savings capacity per year.'],
    assumptions: ['Assumptions', 'Inflation, tax, commission, number of simulated markets and the seed.'],
    glossary: ['Glossary', 'Every term used in the app with its plain-language explanation. The popovers already show the same wording where a term appears.']
  };
  const here = () => { const page = document.body.dataset.page;
    if (page === 'tx') return location.hash === '#import' ? 'import' : 'tx';
    if (page === 'placeholder') return new URLSearchParams(location.search).get('s'); return page; };
  function navHTML() {
    const cur = here(), a = (k, c) => k === cur ? ' aria-current="page"' : '';
    return `<nav class="nav" aria-label="Main">${NAV.map(sec => sec.items
      ? `<div class="sec"><div class="sh">${ICON[sec.icon]}<span>${sec.label}</span></div>${sec.items.map(([l, h, k, soon]) =>
          `<a class="it" href="${h}"${a(k)}><span>${l}</span>${soon ? '<span class="soon">soon</span>' : ''}</a>`).join('')}</div>`
      : `<div class="sec"><a class="sh" href="${sec.href}"${a(sec.key)}>${ICON[sec.icon]}<span>${sec.label}</span>${sec.soon ? '<span class="soon" style="margin-left:auto">soon</span>' : ''}</a></div>`).join('')}</nav>`;
  }
  function shell() {
    const info = priceInfo();
    const theme = `<button type="button" class="iconbtn theme-toggle">${isDark() ? 'Light mode' : 'Dark mode'}</button>`;
    const chip = `<a class="fresh-chip ${info.oldRows.length ? 'old' : ''}" href="dashboard.html#prices"><i></i>${info.oldRows.length ? info.oldRows.length + ' old prices' : 'Prices up to date'}</a>`;
    $('#side').innerHTML = `<a class="brand" href="index.html">Goal-based investing<small>Prototype 11 · sample data</small></a>
      ${navHTML()}
      <div class="foot">${chip}${theme}<a href="start.html">Preview: first run</a></div>`;
    $('#top').innerHTML = `<a class="brand" href="index.html" style="text-decoration:none">Goal-based investing</a>
      <button type="button" class="iconbtn menubtn" id="menuBtn" aria-expanded="false" aria-controls="menu">${ICON.menu}<span>Menu</span></button>`;
    const menu = document.createElement('div'); menu.id = 'menu'; menu.className = 'menu'; menu.hidden = true;
    menu.innerHTML = `${navHTML()}<div class="foot">${chip}${theme}<a href="start.html">Preview: first run</a></div>`;
    document.body.appendChild(menu);
    const btn = $('#menuBtn'), setMenu = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); btn.querySelector('span').textContent = open ? 'Close' : 'Menu';
      btn.querySelector('svg').outerHTML = open ? ICON.close : ICON.menu; document.body.style.overflow = open ? 'hidden' : ''; };
    btn.addEventListener('click', () => setMenu(menu.hidden));
    menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); btn.focus(); } });
    matchMedia('(min-width: 960px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
    document.addEventListener('click', e => { if (e.target.closest('.theme-toggle')) setTheme(isDark() ? 'light' : 'dark'); });
  }

  /* ---------- glossary popover (tap, focus or hover) ---------- */
  let pop, popFor = null;
  function initPop() {
    pop = document.createElement('div'); pop.id = 'pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); document.body.appendChild(pop);
    const show = el => {
      const g = G.glossary[el.dataset.t]; if (!g) return;
      pop.innerHTML = `<div class="it">${esc(g[1])}</div><b>${esc(g[0])}</b><p>${esc(g[2])}</p>${g[3] ? `<p class="why">${esc(g[3])}</p>` : ''}`;
      pop.hidden = false; popFor = el;
      const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      let x = Math.min(Math.max(12, r.left), innerWidth - w - 12), y = r.bottom + 8;
      if (y + h > innerHeight - 12) y = Math.max(12, r.top - h - 8);
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    };
    const hide = () => { pop.hidden = true; popFor = null; };
    document.addEventListener('click', e => {
      const t = e.target.closest('.term');
      if (t) { popFor === t ? hide() : show(t); e.stopPropagation(); } else if (!e.target.closest('#pop')) hide();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    if (matchMedia('(hover: hover)').matches) {
      document.addEventListener('mouseover', e => { const t = e.target.closest('.term'); if (t && popFor !== t) show(t); });
      document.addEventListener('mouseout', e => { if (e.target.closest('.term') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.term'))) hide(); });
    }
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- ECharts: one theme, built from the CSS tokens ---------- */
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colors = () => ({ hl: css('--hl'), hl2: css('--hl2'), hl3: css('--hl3'), ctx: css('--ctx'), ink: css('--ink'), ink2: css('--ink2'), muted: css('--muted'),
    base: css('--base'), grid: css('--grid'), surface: css('--surface'), raised: css('--raised'),
    slot: [1, 2, 3, 4, 5, 6].map(n => css('--slot' + n)) });
  /* goal colour for any chart; `line` = true: only slots 1, 2, 5 are coloured, the other goals fall back to the context grey */
  const gcol = (c, id, line) => line && !LINE_OK.includes(GOAL_SLOT[id]) ? c.ctx : c.slot[GOAL_SLOT[id] - 1];
  /* soft band for Monte Carlo fans: the series colour at low opacity */
  const bandOpacity = () => isDark() ? .3 : .22;
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function registerTheme() {
    const c = colors(), font = css('--font-text');
    const axis = { axisLine: { lineStyle: { color: c.base } }, axisTick: { lineStyle: { color: c.base } }, axisLabel: { color: c.muted, fontSize: 12, fontFamily: font }, splitLine: { lineStyle: { color: c.grid, width: 1 } } };
    echarts.registerTheme('gbi', {
      color: [c.hl, c.hl2, c.hl3], backgroundColor: 'transparent', animation: false,
      textStyle: { fontFamily: font, color: c.ink2, fontSize: 13 },
      categoryAxis: Object.assign({}, axis, { splitLine: { show: false } }),
      valueAxis: Object.assign({}, axis, { axisLine: { show: false }, axisTick: { show: false } }),
      line: { lineStyle: { width: 1.5 }, symbol: 'none', symbolSize: 6 },
      tooltip: { backgroundColor: c.raised, borderColor: c.base, textStyle: { color: c.ink, fontSize: 13, fontFamily: font }, extraCssText: 'box-shadow:none;border-radius:4px;' }
    });
  }
  const charts = [];
  function mount(id, build) {
    const el = document.getElementById(id); if (!el) return;
    const c = { el, build, inst: null, w: 0 }; charts.push(c); drawOne(c);
    /* every chart follows its own box: window, sidebar or grid column changes all land here */
    new ResizeObserver(() => { clearTimeout(c.t); c.t = setTimeout(() => resizeOne(c), 120); }).observe(el);
  }
  function opt(c) { return Object.assign({ animation: false }, c.build(colors(), c.el.clientWidth, c.el.clientHeight)); }
  function drawOne(c) {
    if (c.inst) c.inst.dispose();
    c.w = c.el.clientWidth; c.inst = null;
    if (!c.w) return;
    c.inst = echarts.init(c.el, 'gbi', { renderer: 'svg' });
    c.inst.setOption(opt(c));
  }
  function resizeOne(c) {
    if (!c.el.clientWidth) return;
    if (!c.inst) return drawOne(c);
    if (c.el.clientWidth === c.w) return;
    c.w = c.el.clientWidth; c.inst.resize(); c.inst.setOption(opt(c), true);   /* builders pick label sizes from the width */
  }
  function redrawCharts() { registerTheme(); charts.forEach(drawOne); }
  /* push direct labels apart: values in data units, px per unit, minimum gap in px; returns a y offset (px) per label */
  function spread(vals, pxPerUnit, minPx) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a]), pos = {}; let last = -Infinity;
    idx.forEach(i => { let p = -vals[i] * pxPerUnit; if (p < last + minPx) p = last + minPx; pos[i] = p; last = p; });
    return vals.map((v, i) => pos[i] + v * pxPerUnit);
  }
  /* direct label: end-of-line text in a grey, never the series colour */
  const endLabel = (txt, c, strong) => ({ show: true, formatter: txt, color: strong ? c.ink : c.ink2, fontWeight: strong ? 600 : 400, fontSize: 13, lineHeight: 17, distance: 6 });

  /* "% of target per year": median projected FI wealth (net, today's euros) / target(t). Level 2 = message, Level 3 = context.
     Level 1 is left out: it is already above 200% in year 0 and would leave the scale. */
  function fiPctOption(c, w) {
    const small = w < 520, rows = G.fi.rows, n = rows.length - 1, years = rows.map(r => r.y);
    const L2 = rows.map(r => Math.round(r.ratio[1] * 100)), L3 = rows.map(r => Math.round(r.ratio[2] * 100));
    const lab = (name, v) => small ? `${name}\n${v}%` : `${name} ${v}%`;
    const line = (data, wd, col) => ({ type: 'line', data, symbol: 'none', lineStyle: { width: wd, color: col }, itemStyle: { color: col }, emphasis: { disabled: true } });
    return {
      grid: { left: 4, right: small ? 66 : 110, top: 14, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => { const t = ps[0].dataIndex; return `<b>${years[t]}</b><br>Level 2: ${L2[t]}% of target<br>Level 3: ${L3[t]}% of target`; } },
      xAxis: { type: 'category', data: years, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 12, interval: small ? 12 : 7 } },
      yAxis: { type: 'value', min: 0, max: 250, interval: 50, axisLabel: { color: c.muted, fontSize: 12, formatter: v => v + '%' } },
      series: [
        Object.assign(line(L3, 1.5, c.ctx), { z: 2, endLabel: endLabel(lab('Level 3', L3[n]), c, false) }),
        Object.assign(line(L2, 2.25, c.hl), { z: 4, endLabel: endLabel(lab('Level 2', L2[n]), c, true),
          markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: c.ink2, type: 'dashed', width: 1 },
            label: { show: true, position: 'insideStartTop', color: c.ink2, fontSize: 13, formatter: 'Target reached' }, data: [{ yAxis: 100 }] } })
      ]
    };
  }

  function init() {
    shell(); initPop(); registerTheme();
    if (window.PAGE) window.PAGE();
  }
  window.U = { $, $$, esc, eur, eur2, eurK, pct, sgn, dt, dtShort, days, goal, prod, STATUS, priceInfo, ageText, ICON, statusHTML, glyph, term, ageHTML, mount, endLabel, colors, setTheme, isDark, G, redraw: () => charts.forEach(drawOne),
    fiPctOption, gcol, GOAL_SLOT, STACK, SHORT, gdot, slotVars, gchip, prTag, kindOf, kindTag, legend, goalLegend, monthLabel, bandOpacity, alpha, spread, PLACEHOLDERS, MON,
    niceMax: v => { const m = Math.pow(10, Math.floor(Math.log10(v))), st = m / 2; return Math.ceil(v / st) * st; } };
  /* wait for the bundled fonts so ECharts measures labels with the real glyphs */
  document.addEventListener('DOMContentLoaded', () => {
    const fams = ['--font-display', '--font-text', '--font-mono'].map(v => css(v).split(',')[0].trim());
    const loads = document.fonts ? fams.flatMap(f => [400, 500, 600].map(w => document.fonts.load(`${w} 14px ${f}`))) : [];
    Promise.race([Promise.all(loads).catch(() => {}), new Promise(r => setTimeout(r, 1500))]).then(init);
  });
})();
