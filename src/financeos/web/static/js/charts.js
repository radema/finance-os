/* ==========================================================================
   FINANCE OS — the one ECharts integration pattern.            (ADR-L03 §4)

   Vanilla ES2018. No modules, no bundler, no build step (ADR-0007). Loaded
   after echarts.min.js, both from this app's own static mount (ADR-0008).

   WHAT THIS FILE GUARANTEES
   -------------------------------------------------------------------------
   1. ONE THEME, DERIVED FROM THE DESIGN TOKENS. The theme is read out of the
      CSS custom properties in scope on the chart element itself, so charts are
      literally the same palette as the rest of the interface and cannot drift
      from it. Every hex below is a fallback for a missing token, never a
      choice — add a colour here and you have created a second source of truth.
   2. LIGHT AND DARK ARE THE SAME CODE PATH. Because tokens are read per
      element, a chart is correct inside any themed container and the design
      preview can show both schemes on one page. Dark is not a flip: its series
      steps are their own validated set in tokens.css.
   3. THE MARK LANGUAGE IS INHERITED, NOT RETYPED. A server-assembled series
      names the ROLE it plays — "casing", "core", "edge", "void", "segment" —
      and this file supplies that role's geometry. See THE CASED CANE below. A
      screen that hand-rolls opacities and offsets has forked the chart
      language; it should name a role instead.
   4. HTMX-SAFE LIFECYCLE. Charts init on htmx:load for the swapped fragment
      and dispose on htmx:beforeSwap, so repeated fragment swaps never leak
      instances.
   5. NO CHART READS THE DOM FOR DATA. The option arrives as JSON in a
      <script type="application/json">, assembled server-side.
   6. THE TABLE IS NOT A FALLBACK. It ships open; we collapse it only after a
      chart is successfully live, so a JS-off or JS-failed reader keeps every
      number. If echarts is missing we leave the tables open and stop.
   7. ONE POINT IS NEVER A LINE. A line series with a single datum is forced to
      a labelled dot, because a one-point line draws a trend the data does not
      support. Enforced here so that no caller can forget it.
   ========================================================================== */

(function () {
  "use strict";

  if (typeof echarts === "undefined") {
    // Charts are the only JS-dependent surface. Leave every data table open
    // and say nothing: the reader loses the picture, not the numbers.
    return;
  }

  var instances = Object.create(null);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Tokens are read from the CHART ELEMENT's own computed style, not from
     :root. That is what makes a chart correct inside any themed container —
     including the design preview, which renders a light pane and a dark pane
     on one page — without a second theme or a second code path. */
  function token(el, name, fallback) {
    var v = getComputedStyle(el || document.documentElement).getPropertyValue(name);
    v = (v || "").trim();
    return v || fallback;
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  /* Deep merge in which the CALLER always wins over the preset. */
  function merge(base, extra) {
    var out = {}, k;
    for (k in base) if (has(base, k)) out[k] = base[k];
    for (k in extra) {
      if (!has(extra, k)) continue;
      if (isPlain(out[k]) && isPlain(extra[k])) out[k] = merge(out[k], extra[k]);
      else out[k] = extra[k];
    }
    return out;
  }

  /* ---- the chart language, as geometry ----------------------------------
     Every number here is a mark spec, never a colour. Colours arrive from the
     theme (series identity) or as "token:--name" (role colours). */
  var GAP = 2;              // surface gap between adjacent fills
  var RING = 2;             // surface ring on an overlapping mark
  var CANE = 20;            // the cased cane's casing height, px
  var EDGE = 3;             // the luminous leading edge, px
  var CASING_ALPHA = 0.3;   // the casing is glass: you see the ground through it

  function buildTheme(el) {
    function t(name, fallback) { return token(el, name, fallback); }
    var ink = t("--chart-ink", t("--ink", "#272c33"));
    var ink2 = t("--chart-ink-2", t("--ink-2", "#4e555f"));
    var ink3 = t("--chart-ink-3", t("--ink-3", "#67717d"));
    var grid = t("--chart-grid", "#d0dff2");
    var axis = t("--chart-axis", "#a8b7c9");
    var surface = t("--sheet", "#f5f7f9");

    var faceValue = t("--face-value", "monospace");
    var faceSystem = t("--face-system", "sans-serif");

    // Categorical slots, in fixed order. Assigned to entities by the caller's
    // series order; never cycled. A 6th TARGETED class is not a generated hue —
    // it folds into "altro" or the chart is faceted. Untargeted capital is not
    // a 6th hue either: it is the void cane, and has no hue at all.
    var series = [
      t("--series-1", "#900078"),
      t("--series-2", "#0098c7"),
      t("--series-3", "#1b5dd3"),
      t("--series-4", "#14a357"),
      t("--series-5", "#a96cf4")
    ];

    /* Axis and grid are recessive by construction: a hairline axis line, no
       ticks, and split lines on the VALUE axis only — there is nothing to
       measure between two categories, so a category grid is decoration. */
    var axisCommon = {
      axisLine: { show: true, lineStyle: { color: axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: ink3, fontFamily: faceValue, fontSize: 11 }
    };

    return {
      color: series,
      backgroundColor: "transparent",
      textStyle: { fontFamily: faceSystem, fontSize: 12, color: ink2 },
      title: {
        textStyle: { fontFamily: faceSystem, fontSize: 13, fontWeight: 600, color: ink },
        subtextStyle: { fontFamily: faceSystem, fontSize: 11, color: ink3 }
      },
      // The partial always renders an HTML legend, so ECharts' own is off by
      // default: two legends for one chart is a defect, not redundancy.
      legend: { show: false },
      grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
      categoryAxis: merge(axisCommon, { splitLine: { show: false } }),
      valueAxis: merge(axisCommon, {
        splitLine: { show: true, lineStyle: { color: grid, width: 1 } }
      }),
      logAxis: axisCommon,
      timeAxis: axisCommon,
      tooltip: {
        backgroundColor: surface,
        borderColor: axis,
        borderWidth: 1,
        // Zero radius: this world has no rounded corners. The tooltip is the
        // one element allowed a real offset shadow, because it is the one
        // element that genuinely floats above its plot.
        extraCssText: "border-radius:0;box-shadow:0 2px 10px rgba(0,0,0,.28)",
        textStyle: { color: ink, fontFamily: faceValue, fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: axis, width: 1 } }
      },
      bar: { itemStyle: { borderColor: surface, borderWidth: GAP } },
      line: {
        lineStyle: { width: 2 },
        symbolSize: 8,
        itemStyle: { borderColor: surface, borderWidth: RING }
      },
      scatter: { itemStyle: { borderColor: surface, borderWidth: RING } },
      pictorialBar: { itemStyle: { borderWidth: 0 } }
    };
  }

  /* ======================================================================
     THE CASED CANE — the allocation mark, and the reason this world was
     chosen. Sommerso is the Murano technique of casing one colour inside
     another, and that is exactly what an apportioned allocation is: a declared
     shape with an actual quantity sitting inside it.

       casing    the TARGET extent. Translucent, no border, behind everything:
                 the shape the frozen strategy declared.
       core      the CURRENT quantity. Opaque, narrower, with a surface gap.
       edge      the luminous leading edge at the core's end. ONE light source
                 for the whole world, so it is one token, not a lighter step
                 per hue. It also makes the exact current value readable to a
                 pixel without reading a colour.
       void      untargeted capital: no hue, plus a hatch decal. It stays in the
                 denominator (RFC-0007 §4.1) and reads as absence, not as a
                 sixth category.
       segment   a stacked part of a nested whole (the composition cane).

     Reading it needs no colour at all:
       core short of the casing   -> a shortfall: unfilled casing
       core past the target tick  -> an overshoot: a protrusion
     Polarity is carried by GEOMETRY; hue only carries identity. That is what
     lets the palette be pushed hard without colour becoming load-bearing (P9).
     ====================================================================== */
  function markPresets(el, caneWidth) {
    var surface = token(el, "--sheet", "#f5f7f9");
    var edge = token(el, "--edge", token(el, "--ink", "#00141a"));
    var voidInk = token(el, "--series-void", "#818fa0");
    var body = caneWidth || CANE;
    var core = Math.max(8, Math.round(body * 0.55));
    return {
      casing: {
        type: "bar",
        barWidth: body,
        barGap: "-100%",
        z: 1,
        itemStyle: { opacity: CASING_ALPHA, borderWidth: 0 }
      },
      core: {
        type: "bar",
        barWidth: core,
        barGap: "-100%",
        z: 3,
        itemStyle: { borderColor: surface, borderWidth: GAP }
      },
      edge: {
        type: "pictorialBar",
        symbol: "rect",
        symbolSize: [EDGE, core],
        symbolPosition: "end",
        barGap: "-100%",
        barWidth: body,
        z: 5,
        silent: true,
        tooltip: { show: false },
        itemStyle: { color: edge, borderWidth: 0 }
      },
      void: {
        type: "bar",
        barWidth: body,
        z: 3,
        itemStyle: {
          color: voidInk,
          borderColor: surface,
          borderWidth: GAP,
          // The register's cancellation hatch, inside the canvas: this is the
          // texture channel dataviz requires for CVD, print and forced-colors.
          decal: {
            symbol: "rect",
            color: "rgba(0,0,0,0.45)",
            dashArrayX: [1, 0],
            dashArrayY: [2, 5],
            rotation: -Math.PI / 4,
            symbolSize: 1
          }
        }
      },
      segment: {
        type: "bar",
        stack: "insieme",
        barWidth: body,
        z: 3,
        itemStyle: { borderColor: surface, borderWidth: GAP }
      }
    };
  }

  /* A series names its role; this applies that role's geometry underneath it,
     so anything the caller states explicitly still wins. */
  function applyMarks(option, el) {
    if (!option || !option.series) return option;
    var list = Array.isArray(option.series) ? option.series : [option.series];
    var presets = markPresets(el, option.caneWidth);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !s.mark) continue;
      var preset = presets[s.mark];
      delete s.mark;
      if (preset) list[i] = merge(preset, s);
    }
    option.series = Array.isArray(option.series) ? list : list[0];
    delete option.caneWidth;
    return option;
  }

  /* ONE POINT IS NEVER A LINE. A single-datum line series draws a slope out of
     nothing, and ECharts will render it happily. Force the honest mark. */
  function guardSinglePoint(option) {
    if (!option || !option.series) return option;
    var list = Array.isArray(option.series) ? option.series : [option.series];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || s.type !== "line" || !s.data || s.data.length > 1) continue;
      s.showSymbol = true;
      s.symbolSize = 9;
      s.lineStyle = merge(s.lineStyle || {}, { width: 0, opacity: 0 });
      s.label = merge({ show: true, position: "top", fontSize: 11 }, s.label || {});
    }
    return option;
  }

  function readOption(el) {
    var id = el.getAttribute("data-chart");
    var node = id && document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (e) {
      return null;
    }
  }

  /* ---- token references inside an option -------------------------------
     A server-assembled option must not contain hex colours, or the chart
     palette forks from the interface palette. But some marks (a target
     reference tick, the in-tolerance band) need a specific token that a theme
     cannot express, because a theme only carries series colours.

     The convention: any string "token:--name" anywhere in the option is
     replaced with that CSS custom property's value, read from the chart
     element. So the server says WHICH ROLE it wants and the token layer stays
     the only place a colour is chosen.                                       */
  function resolveTokens(node, el) {
    if (typeof node === "string") {
      return node.indexOf("token:") === 0 ? token(el, node.slice(6), "") : node;
    }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) node[i] = resolveTokens(node[i], el);
      return node;
    }
    if (node && typeof node === "object") {
      for (var k in node) {
        if (has(node, k)) node[k] = resolveTokens(node[k], el);
      }
    }
    return node;
  }

  /* ---- it-IT number formatting  (ADR-L03 §5.2) -------------------------
     Locale formatting is a presentation concern, so it belongs here and never
     in core. Axis ticks and tooltips get it-IT by default (decimal comma) —
     otherwise a chart would print 1.5 next to a table printing 1,5 for the
     same number, which is exactly the kind of quiet inconsistency that makes
     a reader stop trusting the arithmetic. A caller that sets its own
     formatter keeps it.                                                      */
  var nf = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

  function applyLocaleFormatting(option) {
    ["yAxis", "xAxis"].forEach(function (key) {
      var axes = option[key];
      if (!axes) return;
      (Array.isArray(axes) ? axes : [axes]).forEach(function (ax) {
        if (!ax || ax.type !== "value") return;
        ax.axisLabel = ax.axisLabel || {};
        if (!ax.axisLabel.formatter) {
          ax.axisLabel.formatter = function (v) { return nf.format(v); };
        }
      });
    });
    if (option.tooltip && !option.tooltip.valueFormatter) {
      option.tooltip.valueFormatter = function (v) {
        return typeof v === "number" ? nf.format(v) : v;
      };
    }
    return option;
  }

  /* The whole server-option -> ECharts-option pipeline, in one place so the
     offline audit can run exactly what the browser runs. */
  function prepare(option, el) {
    return applyLocaleFormatting(
      guardSinglePoint(applyMarks(resolveTokens(option, el), el))
    );
  }

  function initOne(el) {
    if (!el || instances[el.id]) return;
    var option = readOption(el);
    if (!option) return; // no data: leave the table open, show no empty canvas

    // A theme OBJECT, built from this element's own tokens — not a globally
    // registered theme name, which would bake one scheme in at first init.
    var chart = echarts.init(el, buildTheme(el), { renderer: "canvas" });
    option = prepare(option, el);
    if (reduceMotion) option.animation = false;
    chart.setOption(option);

    el.setAttribute("data-chart-ready", "true");
    instances[el.id] = chart;

    // The chart is live, so the table can recede — but it stays in the DOM and
    // one click away, which is the graceful-degradation promise of ADR-L03 §4.
    var details = document.getElementById(el.id + "-data");
    if (details) details.open = false;

    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () { chart.resize(); });
      ro.observe(el);
      chart.__ro = ro;
    }
  }

  function disposeIn(root) {
    var nodes = (root || document).querySelectorAll("[data-chart]");
    Array.prototype.forEach.call(nodes, function (el) {
      var chart = instances[el.id];
      if (!chart) return;
      if (chart.__ro) chart.__ro.disconnect();
      chart.dispose();
      delete instances[el.id];
      el.removeAttribute("data-chart-ready");
    });
  }

  function initIn(root) {
    var nodes = (root || document).querySelectorAll("[data-chart]");
    Array.prototype.forEach.call(nodes, initOne);
  }

  /* Re-theme on scheme change. The tokens have already flipped by the time
     this fires; a theme is baked into an instance at init, so live charts are
     disposed and re-initialised against the new token values. */
  function rethemeAll() {
    var n = Object.keys(instances).length;
    disposeIn(document);
    initIn(document);
    return n;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { initIn(document); });
  } else {
    initIn(document);
  }

  var scheme = window.matchMedia("(prefers-color-scheme: dark)");
  if (scheme.addEventListener) scheme.addEventListener("change", rethemeAll);

  // HTMX fragment lifecycle (ADR-0007: the unit of work is a fragment).
  if (document.body) {
    document.body.addEventListener("htmx:load", function (e) { initIn(e.target); });
    document.body.addEventListener("htmx:beforeSwap", function (e) { disposeIn(e.target); });
  }

  // Exposed so a theme toggle (and the design preview) can force a re-theme.
  // `prepare` is exposed for the offline audit, which pushes every shipped
  // option through it in Node to prove no option carries a hex, that every
  // token reference resolves, and that ECharts accepts the result.
  window.FinanceOSCharts = {
    init: initIn,
    dispose: disposeIn,
    retheme: rethemeAll,
    theme: buildTheme,
    prepare: prepare
  };
})();
