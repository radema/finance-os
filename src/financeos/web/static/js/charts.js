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
   3. HTMX-SAFE LIFECYCLE. Charts init on htmx:load for the swapped fragment
      and dispose on htmx:beforeSwap, so repeated fragment swaps never leak
      instances.
   4. NO CHART READS THE DOM FOR DATA. The option arrives as JSON in a
      <script type="application/json">, assembled server-side.
   5. THE TABLE IS NOT A FALLBACK. It ships open; we collapse it only after a
      chart is successfully live, so a JS-off or JS-failed reader keeps every
      number. If echarts is missing we leave the tables open and stop.
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

  /* Build the ECharts theme from the CSS token layer. Typography follows the
     three voices: numeric axis labels and tooltip values in Mono, series
     names and titles in Sans (ADR-L03 §4). */
  function buildTheme(el) {
    function t(name, fallback) { return token(el, name, fallback); }
    var ink = t("--chart-ink", t("--ink", "#14181d"));
    var ink2 = t("--chart-ink-2", t("--ink-2", "#464e57"));
    var ink3 = t("--chart-ink-3", t("--ink-3", "#5a636d"));
    var grid = t("--chart-grid", "#e0e4e9");
    var axis = t("--chart-axis", "#b6bec7");
    var surface = t("--sheet", "#f7f8fa");

    var faceValue = t("--face-value", "monospace");
    var faceSystem = t("--face-system", "sans-serif");

    // Categorical slots, in fixed order. Assigned to entities by the caller's
    // series order; never cycled. A 6th series is not a generated hue — it
    // folds into "altro" or the chart is faceted.
    var series = [
      t("--series-1", "#0e6ea6"),
      t("--series-2", "#0b8f68"),
      t("--series-3", "#c07408"),
      t("--series-4", "#c33f7d"),
      t("--series-5", "#3f5cc4")
    ];

    var axisCommon = {
      axisLine: { show: true, lineStyle: { color: axis, width: 1 } },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: grid, width: 1 } },
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
      categoryAxis: axisCommon,
      valueAxis: axisCommon,
      logAxis: axisCommon,
      timeAxis: axisCommon,
      tooltip: {
        backgroundColor: surface,
        borderColor: axis,
        borderWidth: 1,
        // zero radius: the register has no rounded corners
        extraCssText: "border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,.14)",
        textStyle: { color: ink, fontFamily: faceValue, fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: axis, width: 1 } }
      },
      // 2px surface gap between adjacent fills, and a surface ring on marks
      bar: { itemStyle: { borderColor: surface, borderWidth: 2 } },
      line: {
        lineStyle: { width: 2 },
        symbolSize: 8,
        itemStyle: { borderColor: surface, borderWidth: 2 }
      },
      scatter: { itemStyle: { borderColor: surface, borderWidth: 2 } },
      pie: { itemStyle: { borderColor: surface, borderWidth: 2 } }
    };
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
        if (Object.prototype.hasOwnProperty.call(node, k)) {
          node[k] = resolveTokens(node[k], el);
        }
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

  function initOne(el) {
    if (!el || instances[el.id]) return;
    var option = readOption(el);
    if (!option) return; // no data: leave the table open, show no empty canvas

    // A theme OBJECT, built from this element's own tokens — not a globally
    // registered theme name, which would bake one scheme in at first init.
    var chart = echarts.init(el, buildTheme(el), { renderer: "canvas" });
    option = applyLocaleFormatting(resolveTokens(option, el));
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
  document.body.addEventListener("htmx:load", function (e) { initIn(e.target); });
  document.body.addEventListener("htmx:beforeSwap", function (e) { disposeIn(e.target); });

  // Exposed so a theme toggle (and the design preview) can force a re-theme.
  window.FinanceOSCharts = {
    init: initIn,
    dispose: disposeIn,
    retheme: rethemeAll,
    theme: buildTheme
  };
})();
