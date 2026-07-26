"""Build the three candidate visual-world proofs.

    uv run python docs/design/worlds/build_proofs.py

Each proof is a standalone offline HTML page showing the parts that decide the
question: the tolerance rail in and out of tolerance, the four outcome chips, a
few trace-ladder rows, and one real ECharts chart carrying the fixture's five
asset classes -- which is where the first direction failed.

The component MARKUP is shared across all three worlds and only the token block
and the chart option change. That is deliberate evidence: the five UX-0001 §4
contracts are world-independent, so choosing a world does not re-open them.

Every series palette here was solved against dataviz/scripts/validate_palette.js
and clears its gates in BOTH modes. No colour is hand-waved.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
STATIC = (HERE.parents[2] / "src" / "financeos" / "web" / "static")

# --- fixture (UX-0001 §8) ---------------------------------------------------
CLASSES = ["EQ/DEV", "EQ/EMG", "GOV/EUR", "CORP/IG", "CASH"]
CURRENT = [34.00, 9.50, 27.90, 8.00, 12.00]
TARGET = [40.00, 10.00, 30.00, 10.00, 10.00]

LADDER_ROWS = [
    ("3", "subtract", "current_weight − effective_target", "drift = −0.0600", False),
    ("4", "abs", "drift", "abs_drift = 0.0600", False),
    ("5", "divide_safe", "abs_drift ÷ effective_band", "severity = 3.0000", False),
    ("6", "abs_gt", "drift, effective_band", "FIRED", True),
]

# ---------------------------------------------------------------------------
# THE THREE WORLDS
# ---------------------------------------------------------------------------
# Each carries the same structural principle, which is what failed last time:
#   ONE reserved alarm hue, absent from the series set, so chrome and data can
#   never drift apart or collide; and status distinguished by TEXTURE so hue is
#   never the sole carrier.

WORLDS = [
    {
        "slug": "a-calcolatrice",
        "name": "La Calcolatrice",
        "subtitle": "Olivetti · Pintori · la macchina da calcolo italiana",
        "concept": (
            "The interface as a well-made Italian calculating machine: Olivetti's design "
            "programme, which existed to make computation legible and humane. Flat poster inks "
            "on warm near-white, hard-edged marks, no gradients, generous air, geometric "
            "grotesque set tight. One vermilion warning lamp and nothing else that shouts."
        ),
        "why": (
            "The only cultural world where Italian design and computation are already the same "
            "subject. It gives the product an idiom for being precise without being cold, and "
            "for treating a number as something a machine produced and a person must read. "
            "In-tolerance is NEUTRAL here, not green: the machine reports, it does not "
            "congratulate — which is the Manifest's refusal to reassure, rendered as palette."
        ),
        "elevation": "none — hairlines and flat colour only",
        "faces": {
            "system": ("Archivo", "archivo-var-400-700.woff2", "100 700", "normal"),
            "value": ("Martian Mono", "martian-mono-400.woff2", "400 500", "normal"),
            "declared": ("Faustina", "faustina-400-600.woff2", "400 600", "normal"),
        },
        "light": {
            "ground": "#efece5", "sheet": "#fbfaf7", "sunken": "#e8e4db",
            "ink": "#1b1913", "ink2": "#544f46", "ink3": "#6b655b",
            "rule": "#d6d1c6", "rule2": "#bdb7a9", "control": "#7e7768",
            "alarm": "#c1330f", "alarm_tint": "#f9e9e3",
            "band": "#e2ddd0", "band_edge": "#a9a08c",
            "series": ["#4f6eb7", "#32a67d", "#94436d", "#1292c0", "#9f7100"],
            "void": "#8b8477",
        },
        "dark": {
            "ground": "#14130f", "sheet": "#1c1a16", "sunken": "#24211c",
            "ink": "#efece3", "ink2": "#b0a99c", "ink3": "#8c8578",
            "rule": "#332f28", "rule2": "#474137", "control": "#6d6659",
            "alarm": "#f0714a", "alarm_tint": "#2a1710",
            "band": "#2b2721", "band_edge": "#5c5548",
            "series": ["#5474be", "#3aac83", "#9a4873", "#1f99c7", "#a57710"],
            "void": "#756f63",
        },
        "chart_note": (
            "Flat poster blocks with hard edges. The target is a heavy ink rule crossing the "
            "bar, so \"where you are\" and \"where you said you'd be\" are one glance and one "
            "axis. Category labels in wide mono."
        ),
        "chart": "poster",
    },
    {
        "slug": "b-vetro-sommerso",
        "name": "Vetro Sommerso",
        "subtitle": "Murano · canne di vetro · sommerso a strati",
        "concept": (
            "Venetian glass, dark-first. A deep ink-blue ground with luminous jewel canes read "
            "against it, and marks built as submerged layers with a single light source. "
            "Sommerso — the technique of casing one colour inside another — is what "
            "apportionment actually looks like: a whole seen through the layers that compose it."
        ),
        "why": (
            "The most chart-native of the three: layering IS the data structure, so a stacked "
            "or nested chart stops being a convention and becomes the material. It also gives "
            "the product genuine visual ambition and reads as valuable without reading as "
            "playful. The risk is that glass reads precious; it is held in check by keeping the "
            "type plain and the numbers dominant."
        ),
        "elevation": "one named level — a luminous edge, tokenised per theme, no drop shadows",
        "faces": {
            "system": ("Archivo", "archivo-var-400-700.woff2", "100 700", "normal"),
            "value": ("IBM Plex Mono", "ibm-plex-mono-400.woff2", "400", "normal"),
            "declared": ("Faustina", "faustina-400-italic.woff2", "400", "italic"),
        },
        "dark": {
            "ground": "#0d1220", "sheet": "#141b2b", "sunken": "#1c2537",
            "ink": "#e9edf6", "ink2": "#a4b0c8", "ink3": "#8493ad",
            "rule": "#26314a", "rule2": "#38455f", "control": "#5d6d8a",
            "alarm": "#f2607f", "alarm_tint": "#2b1520",
            "band": "#1a2740", "band_edge": "#4a6b8f",
            "series": ["#5376b8", "#19a9b0", "#1e7c50", "#b58037", "#9b6aab"],
            "void": "#69768e",
        },
        "light": {
            "ground": "#e9edf4", "sheet": "#f7f9fc", "sunken": "#dde4ee",
            "ink": "#101726", "ink2": "#45516a", "ink3": "#5c6880",
            "rule": "#cbd4e2", "rule2": "#aab6c9", "control": "#74809a",
            "alarm": "#c02249", "alarm_tint": "#fbe8ed",
            "band": "#dde7f2", "band_edge": "#8aa4c4",
            "series": ["#4d70b2", "#04a3aa", "#14764a", "#af7a31", "#9564a4"],
            "void": "#7d8798",
        },
        "chart_note": (
            "Horizontal layers submerged in the ground, each cane a translucent field with one "
            "bright leading edge where the light catches it. The target is a thin line of light "
            "across the layer."
        ),
        "chart": "sommerso",
        "dark_first": True,
    },
    {
        "slug": "c-mosaico",
        "name": "Il Mosaico",
        "subtitle": "Ravenna · tessere · un intero fatto di parti contate",
        "concept": (
            "Byzantine-Italian mosaic. A warm bone ground, tesserae in lapis, malachite, "
            "pavonazzo, sky and gold, and every quantity drawn as discrete counted units "
            "separated by grout. Nothing is a smooth length; everything is a count."
        ),
        "why": (
            "The strongest fit to the domain's actual arithmetic. This product's numbers are "
            "sums of countable things — units apportioned across Buckets, evaluations in a run, "
            "band-widths of drift — and a mosaic bar lets the reader COUNT rather than compare "
            "lengths. It is also the honest picture of a whole composed of parts that must "
            "reconcile, which is what net worth equals buckets plus UNASSIGNED actually means."
        ),
        "elevation": "none — grout gaps and tonal steps carry every separation",
        "faces": {
            "system": ("IBM Plex Sans", "ibm-plex-sans-var.woff2", "100 700", "normal"),
            "value": ("IBM Plex Mono", "ibm-plex-mono-400.woff2", "400", "normal"),
            "declared": ("Faustina", "faustina-400-600.woff2", "400 600", "normal"),
        },
        "light": {
            "ground": "#ece8de", "sheet": "#f8f6f1", "sunken": "#e2ddd0",
            "ink": "#191712", "ink2": "#514c41", "ink3": "#6a6456",
            "rule": "#d4cec0", "rule2": "#b9b2a0", "control": "#7c7564",
            "alarm": "#a83521", "alarm_tint": "#f7e8e3",
            "band": "#dfe6d9", "band_edge": "#94a389",
            "series": ["#596db2", "#5aa26b", "#864a81", "#0096af", "#98741a"],
            "void": "#8a8375",
        },
        "dark": {
            "ground": "#141209", "sheet": "#1d1a12", "sunken": "#26221a",
            "ink": "#efeade", "ink2": "#b3ab99", "ink3": "#8f8877",
            "rule": "#332e22", "rule2": "#474031", "control": "#6f6857",
            "alarm": "#e07158", "alarm_tint": "#2b160f",
            "band": "#232a1e", "band_edge": "#5a6a4d",
            "series": ["#5e73b8", "#60a871", "#8c5087", "#139cb6", "#9e7a23"],
            "void": "#7a7364",
        },
        "chart_note": (
            "Every bar is built from discrete tesserae with visible grout, so allocation is "
            "counted, not measured. The target is a gold tessera set into the row at its "
            "declared position."
        ),
        "chart": "mosaico",
    },
]


# ---------------------------------------------------------------------------
def face_css(faces: dict, static: str) -> str:
    out = []
    for _role, (family, file, weight, style) in faces.items():
        out.append(
            f'@font-face{{font-family:"{family}";font-style:{style};'
            f"font-weight:{weight};font-display:swap;"
            f'src:url("{static}/fonts/{file}") format("woff2");}}'
        )
    return "\n".join(out)


def token_block(selector: str, t: dict, scheme: str) -> str:
    return f"""{selector} {{
  color-scheme: {scheme};
  --ground:{t['ground']}; --sheet:{t['sheet']}; --sunken:{t['sunken']};
  --ink:{t['ink']}; --ink-2:{t['ink2']}; --ink-3:{t['ink3']};
  --rule:{t['rule']}; --rule-2:{t['rule2']}; --control:{t['control']};
  --alarm:{t['alarm']}; --alarm-tint:{t['alarm_tint']};
  --band:{t['band']}; --band-edge:{t['band_edge']};
  --s1:{t['series'][0]}; --s2:{t['series'][1]}; --s3:{t['series'][2]};
  --s4:{t['series'][3]}; --s5:{t['series'][4]}; --void:{t['void']};
}}"""


def chart_option(kind: str) -> dict:
    """Per-world chart language. No colour literals: series colours come from
    the theme, and role colours arrive as token:--name for the helper."""
    base = {
        "grid": {"left": 6, "right": 30, "top": 10, "bottom": 6, "containLabel": True},
        "tooltip": {"trigger": "item"},
        "xAxis": {"type": "value", "max": 45, "axisLabel": {"formatter": "{value}%"}},
        "yAxis": {"type": "category", "inverse": True, "data": CLASSES,
                  "splitLine": {"show": False}},
    }
    target_marks = {
        "symbol": "rect", "silent": True, "label": {"show": False},
        "data": [{"coord": [t, i]} for i, t in enumerate(TARGET)],
    }
    if kind == "poster":
        base["series"] = [{
            "type": "bar", "colorBy": "data", "data": CURRENT, "barWidth": 17,
            # hard-edged poster block; the target is a heavy ink rule
            "markPoint": {**target_marks, "symbolSize": [4, 30],
                          "itemStyle": {"color": "token:--ink"}},
        }]
    elif kind == "sommerso":
        base["series"] = [
            {
                # the cased cane: a translucent body submerged in the ground
                "type": "bar", "colorBy": "data", "data": CURRENT, "barWidth": 22,
                "itemStyle": {"opacity": 0.55, "borderWidth": 0},
                "markPoint": {**target_marks, "symbolSize": [2, 34],
                              "itemStyle": {"color": "token:--ink"}},
            },
            {
                # the leading edge, where the light catches the glass
                "type": "pictorialBar", "colorBy": "data", "data": CURRENT,
                "symbol": "rect", "symbolSize": [3, 22], "symbolPosition": "end",
                "barGap": "-100%", "z": 4, "silent": True,
                "tooltip": {"show": False},
            },
        ]
    else:  # mosaico
        base["series"] = [{
            # literal tesserae: countable units with grout between them
            "type": "pictorialBar", "colorBy": "data", "data": CURRENT,
            "symbol": "rect", "symbolRepeat": True, "symbolClip": True,
            "symbolSize": [9, 18], "symbolMargin": "2",
            "symbolBoundingData": 45,
            "markPoint": {**target_marks, "symbolSize": [3, 26],
                          "itemStyle": {"color": "token:--ink"}},
        }]
    return base


HTML = """<!DOCTYPE html>
<html lang="it" data-world="{slug}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{name} · proposta di mondo visivo · Finance OS</title>
<style>
{faces}

{light_tokens}
{dark_tokens}

*,*::before,*::after{{box-sizing:border-box}}
body{{margin:0;font-family:var(--face-system);font-size:14px;line-height:1.5;
 -webkit-font-smoothing:antialiased}}
:root{{
 --face-system:"{f_system}",system-ui,sans-serif;
 --face-value:"{f_value}",ui-monospace,monospace;
 --face-declared:"{f_declared}",Georgia,serif;
 --sp:4px;
}}
h1,h2,h3,p,dl,dd{{margin:0}}
.value{{font-family:var(--face-value);font-variant-numeric:tabular-nums;
 font-feature-settings:"tnum" 1,"zero" 1;letter-spacing:-.01em}}
.declared{{font-family:var(--face-declared);font-size:16px;line-height:1.6}}
.ident{{font-family:var(--face-value);font-size:11px;color:var(--ink-2);overflow-wrap:anywhere}}
:focus-visible{{outline:2px solid var(--s1);outline-offset:2px}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}

/* ---- proof scaffolding ---- */
.masthead{{background:var(--ground);color:var(--ink);padding:28px 32px 24px;
 border-bottom:1px solid var(--rule-2)}}
.masthead h1{{font-size:26px;font-weight:700;letter-spacing:-.02em}}
.masthead .sub{{font-family:var(--face-value);font-size:11px;color:var(--ink-3);
 letter-spacing:.08em;text-transform:uppercase;margin-top:6px}}
.masthead .lede{{max-width:74ch;margin-top:14px;color:var(--ink-2);font-size:14px}}
.masthead .lede b{{color:var(--ink)}}
.pane{{background:var(--ground);color:var(--ink);padding:24px 32px 40px}}
.pane__tag{{font-family:var(--face-value);font-size:10px;letter-spacing:.14em;
 text-transform:uppercase;color:var(--ink-3);padding-bottom:8px;margin-bottom:20px;
 border-bottom:1px solid var(--rule-2)}}
.block{{margin-bottom:28px}}
.block>h3{{font-family:var(--face-value);font-size:10px;font-weight:500;letter-spacing:.14em;
 text-transform:uppercase;color:var(--ink-3);margin-bottom:10px}}
.cols{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}}
.card{{background:var(--sheet);border:1px solid var(--rule-2);padding:16px}}
.row{{display:flex;flex-wrap:wrap;gap:12px;align-items:center}}
.note{{font-size:12px;color:var(--ink-3);max-width:66ch;margin-top:8px}}
.sw{{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}}
.sw>div{{border:1px solid var(--rule-2)}}
.sw i{{display:block;height:34px}}
.sw span{{display:block;padding:3px 6px;background:var(--sheet);font-family:var(--face-value);
 font-size:10px;color:var(--ink-2)}}

/* ============ CONTRACT: tolerance rail (geometry per world, maths fixed) ==== */
.rail{{min-width:150px}}
.rail__s{{position:relative;height:22px}}
.rail__base{{position:absolute;inset-inline:0;bottom:4px;height:1px;background:var(--rule-2)}}
.rail__band{{position:absolute;inset-inline:33.3333%;bottom:4px;height:12px;
 background:var(--band);border-inline:1px solid var(--band-edge)}}
.rail__t{{position:absolute;left:var(--at);bottom:0;width:1px;height:4px;background:var(--ink-3)}}
.rail__t--b{{bottom:4px;height:12px;background:var(--band-edge)}}
.rail__t--g{{bottom:4px;height:19px;background:var(--ink);width:1px}}
.rail__i{{position:absolute;left:var(--at);bottom:1px;width:3px;height:18px;
 margin-inline-start:-1px;
 background:var(--ink);box-shadow:0 0 0 1px var(--sheet)}}
.rail__i::before{{content:"";position:absolute;left:50%;top:-6px;transform:translateX(-50%);
 border-inline:4px solid transparent;border-top:6px solid var(--ink)}}
.rail--brk .rail__i{{background:var(--alarm)}}
.rail--brk .rail__i::before{{border-top-color:var(--alarm)}}
.rail__c{{position:absolute;bottom:0;width:0;height:0;border-block:4px solid transparent;
 inset-inline-start:0;border-inline-end:5px solid var(--alarm)}}
.rail__k{{display:flex;justify-content:space-between;margin-top:4px;
 font-family:var(--face-value);font-size:10px;color:var(--ink-3)}}
.sev{{font-family:var(--face-value);font-variant-numeric:tabular-nums;font-size:28px;
 font-weight:500;line-height:1.05;letter-spacing:-.02em}}
.sev--brk{{color:var(--alarm)}}
.sev__l{{font-family:var(--face-system);font-size:10px;letter-spacing:.14em;
 text-transform:uppercase;color:var(--ink-3)}}

/* ============ CONTRACT: outcome chips — texture carries the distinction ==== */
.oc{{font-family:var(--face-value);font-size:10px;letter-spacing:.05em;padding:2px 7px;
 border:1px solid;white-space:nowrap}}
.oc--f{{color:var(--sheet);background:var(--alarm);border-color:var(--alarm)}}
.oc--n{{color:var(--ink-2);background:transparent;border-color:var(--control)}}
.oc--s{{color:var(--alarm);background:var(--alarm-tint);border-color:var(--alarm);
 border-style:dashed}}
.oc--e{{color:var(--alarm);border-color:var(--alarm);background:
 repeating-linear-gradient(-45deg,transparent 0 4px,
 color-mix(in srgb,var(--alarm) 24%,transparent) 4px 5px),var(--alarm-tint)}}

/* ============ CONTRACT: trace ladder — ordered data, stored strings ======== */
.lad{{font-family:var(--face-value);font-variant-numeric:tabular-nums;font-size:12.5px;
 line-height:1.7}}
.lad__r{{display:grid;grid-template-columns:24px 96px minmax(0,1fr) 150px;gap:10px;
 padding:3px 0;border-bottom:1px dotted var(--rule)}}
.lad__h{{font-family:var(--face-system);font-size:10px;letter-spacing:.12em;
 text-transform:uppercase;color:var(--ink-3);border-bottom:1px solid var(--rule-2)}}
.lad__i{{color:var(--ink-3);text-align:right}}
.lad__o{{color:var(--s1);font-weight:500}}
.lad__x{{color:var(--ink-2)}}
.lad__v{{text-align:right;font-weight:500}}
.lad__r--held{{background:var(--sunken);border-bottom:0;border-top:1px solid var(--rule-2);
 margin-inline:-8px;padding-inline:8px}}
.lad__r--held .lad__v{{color:var(--alarm)}}

/* ============ chart ======================================================= */
.chart{{width:100%;height:250px}}
.leg{{display:flex;flex-wrap:wrap;gap:8px 16px;padding:0;margin:12px 0 0;list-style:none;
 font-size:12px}}
.leg li{{display:flex;align-items:baseline;gap:6px;color:var(--ink-2)}}
.leg i{{width:10px;height:10px;flex:none;box-shadow:0 0 0 1px var(--sheet)}}
.leg b{{font-family:var(--face-value);font-weight:400;color:var(--ink)}}
.leg .void{{background:var(--void);background-image:repeating-linear-gradient(45deg,
 transparent 0 3px,color-mix(in srgb,var(--ink) 34%,transparent) 3px 4px)}}
table{{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}}
th{{font-family:var(--face-system);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
 color:var(--ink-3);text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule-2)}}
td{{padding:5px 8px;border-bottom:1px solid var(--rule)}}
td.n,th.n{{text-align:right;font-family:var(--face-value);font-variant-numeric:tabular-nums}}
</style>
</head>
<body>

<header class="masthead">
  <h1>{name}</h1>
  <p class="sub">{subtitle}</p>
  <p class="lede">{concept}</p>
  <p class="lede"><b>Perché questo prodotto.</b> {why}</p>
  <p class="lede"><b>Grafici.</b> {chart_note}</p>
  <p class="lede"><b>Elevazione.</b> {elevation}. <b>Allarme riservato:</b>
     <span class="value">{alarm_l}</span> chiaro / <span class="value">{alarm_d}</span> scuro,
     mai usato come colore di serie.</p>
</header>

{panes}

<script src="{static}/vendor/echarts/echarts.min.js"></script>
<script>
/* The reusable pattern, in miniature: the theme is built from the tokens in
   scope on the chart element, so a chart is correct inside any themed pane and
   cannot drift from the interface. Role colours arrive as "token:--name" and
   are resolved here, so the option carries no colour literals at all. */
(function(){{
  if (typeof echarts === "undefined") return;
  var nf = new Intl.NumberFormat("it-IT", {{maximumFractionDigits: 2}});
  function tok(el, n, f){{
    var v = getComputedStyle(el).getPropertyValue(n);
    return (v||"").trim() || f;
  }}
  function resolve(node, el){{
    if (typeof node === "string")
      return node.indexOf("token:")===0 ? tok(el,node.slice(6),"") : node;
    if (Array.isArray(node)) return node.map(function(n){{return resolve(n,el);}});
    if (node && typeof node === "object") {{
      for (var k in node)
        if (Object.prototype.hasOwnProperty.call(node,k))
          node[k]=resolve(node[k],el);
    }}
    return node;
  }}
  function theme(el){{
    var ink=tok(el,"--ink",""), ink2=tok(el,"--ink-2",""), ink3=tok(el,"--ink-3","");
    var grid=tok(el,"--rule",""), axis=tok(el,"--rule-2",""), surf=tok(el,"--sheet","");
    var ax={{axisLine:{{show:true,lineStyle:{{color:axis,width:1}}}},axisTick:{{show:false}},
      splitLine:{{show:true,lineStyle:{{color:grid,width:1}}}},
      axisLabel:{{color:ink3,fontFamily:tok(el,"--face-value","monospace"),fontSize:11}}}};
    return {{
      color:[tok(el,"--s1",""),tok(el,"--s2",""),tok(el,"--s3",""),
             tok(el,"--s4",""),tok(el,"--s5","")],
      backgroundColor:"transparent",
      textStyle:{{fontFamily:tok(el,"--face-system","sans-serif"),fontSize:12,color:ink2}},
      legend:{{show:false}},
      categoryAxis:ax, valueAxis:ax, logAxis:ax, timeAxis:ax,
      tooltip:{{backgroundColor:surf,borderColor:axis,borderWidth:1,
        extraCssText:"border-radius:0",
        textStyle:{{color:ink,fontFamily:tok(el,"--face-value","monospace"),fontSize:12}}}},
      bar:{{itemStyle:{{borderColor:surf,borderWidth:2}}}}
    }};
  }}
  document.querySelectorAll("[data-chart]").forEach(function(el){{
    var raw = document.getElementById(el.getAttribute("data-chart")).textContent;
    var opt = resolve(JSON.parse(raw), el);
    if (opt.tooltip) opt.tooltip.valueFormatter = function(v){{
      return typeof v === "number" ? nf.format(v)+"%" : v;
    }};
    var c = echarts.init(el, theme(el), {{renderer:"canvas"}});
    c.setOption(opt);
    new ResizeObserver(function(){{c.resize();}}).observe(el);
  }});
}})();
</script>
</body>
</html>
"""

PANE = """
<section class="pane" data-scheme="{scheme}">
  <p class="pane__tag">{scheme_label}</p>

  <div class="block">
    <h3>Tavolozza · serie convalidate + allarme riservato</h3>
    <div class="sw">
      {swatches}
    </div>
    <p class="note">Le cinque tinte di serie superano ogni controllo del validatore
    (banda di luminosità, croma, separazione per daltonismo, visione normale, contrasto)
    su <em>entrambe</em> le superfici. L'allarme è escluso dall'insieme delle serie: così
    un colore di stato non può mai impersonare un dato.</p>
  </div>

  <div class="block">
    <h3>Guida di tolleranza · fuori e dentro tolleranza</h3>
    <div class="cols">
      <div class="card">
        <p class="ident" style="margin-bottom:10px">EQ/DEV · Pension · ±2,00pp ABSOLUTE</p>
        <div class="row" style="align-items:flex-end;gap:24px">
          <div style="flex:1;min-width:160px">
            <div class="rail rail--brk" role="img"
                 aria-label="3 ampiezze di banda sotto l'obiettivo: fuori tolleranza">
              <div class="rail__s">
                <span class="rail__base"></span><span class="rail__band"></span>
                {ticks}
                <span class="rail__i" style="--at:3%"></span>
                <span class="rail__c"></span>
              </div>
              <div class="rail__k"><span>−3</span><span>obiettivo 40,00%</span><span>+3</span></div>
            </div>
          </div>
          <div>
            <div class="sev__l">Severità</div>
            <div class="sev sev--brk">3,00</div>
          </div>
        </div>
      </div>
      <div class="card">
        <p class="ident" style="margin-bottom:10px">EQ/EMG · Pension · RELATIVE 0,25</p>
        <div class="row" style="align-items:flex-end;gap:24px">
          <div style="flex:1;min-width:160px">
            <div class="rail" role="img"
                 aria-label="0,42 ampiezze di banda sotto l'obiettivo: entro tolleranza">
              <div class="rail__s">
                <span class="rail__base"></span><span class="rail__band"></span>
                {ticks}
                <span class="rail__i" style="--at:43%"></span>
              </div>
              <div class="rail__k"><span>−3</span><span>obiettivo 10,00%</span><span>+3</span></div>
            </div>
          </div>
          <div>
            <div class="sev__l">Severità</div>
            <div class="sev">0,42</div>
          </div>
        </div>
      </div>
    </div>
    <p class="note">Entro tolleranza è <strong>neutro</strong>, non verde: il sistema riporta,
    non si congratula. Solo lo scostamento prende colore.</p>
  </div>

  <div class="block">
    <h3>Chip di esito · la texture porta la distinzione, non la tinta</h3>
    <div class="row">
      <span class="oc oc--f">RILEVATO</span>
      <span class="oc oc--n">NON RILEVATO</span>
      <span class="oc oc--s">NON VALUTATO</span>
      <span class="ident">zero_portfolio_value</span>
      <span class="oc oc--e">ERRORE</span>
      <span class="ident">currency_mismatch</span>
    </div>
    <p class="note">Pieno · filo · tratteggiato · tratteggio incrociato. Un solo colore
    riservato, quattro texture: restano inconfondibili in scala di grigi e per chi non
    distingue rosso e verde. <em>NON VALUTATO</em> ed <em>ERRORE</em> non sono mai rassicuranti.</p>
  </div>

  <div class="block">
    <h3>Scala di derivazione · dati ordinati, decimali come memorizzati</h3>
    <div class="card">
      <div class="lad">
        <div class="lad__r lad__h"><span class="lad__i">#</span><span>Operazione</span>
          <span>Operandi</span><span class="lad__v">Risultato</span></div>
        {ladder}
      </div>
    </div>
  </div>

  <div class="block">
    <h3>Allocazione contro obiettivo · le cinque classi del fixture</h3>
    <div class="card">
      <script type="application/json" id="opt-{slug}-{scheme}">{option}</script>
      <div class="chart" data-chart="opt-{slug}-{scheme}" role="img"
           aria-label="Allocazione attuale contro obiettivo per cinque classi di attivo"></div>
      <ul class="leg">
        {legend}
        <li><i class="void"></i><span>non targettizzato</span> <b>12,16%</b></li>
      </ul>
      <table>
        <thead><tr><th>Classe</th><th class="n">Attuale</th><th class="n">Obiettivo</th>
          <th class="n">Scostamento</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    <p class="note">{chart_note} Il capitale non targettizzato non ha tinta: è vuoto, e si
    legge con il tratteggio. Patrimonio netto <span class="value">€107.586,33</span>.</p>
  </div>

  <div class="block">
    <h3>Le tre voci</h3>
    <div class="card">
      <p>Equity/Developed è <span class="value" style="color:var(--alarm)">6,00pp</span> sotto
      il tuo obiettivo del <span class="value">40,00%</span> (tolleranza
      <span class="value">±2,00pp</span>). Attuale <span class="value">34,00%</span>,
      <span class="value" style="color:var(--alarm)">−€3.240,00</span>.</p>
      <p class="declared" style="margin-top:12px;padding-inline:20px">«Ho ridotto la quota dei
      mercati emergenti dal 30% al 20% dell'azionario: non è una visione sui mercati, mi sono
      accorto che ribilanciavo per disagio e non per piano.»</p>
      <p class="note">Sistema in {f_system} · valori in {f_value} ·
        le tue parole in {f_declared}.</p>
    </div>
  </div>
</section>
"""


def ticks_html() -> str:
    out = []
    for step in (-3, -2, -1, 0, 1, 2, 3):
        at = 50.0 + (step / 6.0) * 100.0
        cls = ""
        if step == 0:
            cls = " rail__t--g"
        elif step in (-1, 1):
            cls = " rail__t--b"
        out.append(f'<span class="rail__t{cls}" style="--at:{at:.4f}%"></span>')
    return "".join(out)


def build() -> None:
    static = "../../../src/financeos/web/static"
    for w in WORLDS:
        panes = []
        order = ["dark", "light"] if w.get("dark_first") else ["light", "dark"]
        for scheme in order:
            t = w[scheme]
            sw = "".join(
                f'<div><i style="background:{c}"></i><span>{lbl}</span></div>'
                for lbl, c in [
                    ("s1 " + CLASSES[0], t["series"][0]), ("s2 " + CLASSES[1], t["series"][1]),
                    ("s3 " + CLASSES[2], t["series"][2]), ("s4 " + CLASSES[3], t["series"][3]),
                    ("s5 " + CLASSES[4], t["series"][4]),
                    ("allarme", t["alarm"]), ("vuoto", t["void"]),
                    ("inchiostro", t["ink"]), ("foglio", t["sheet"]),
                ]
            )
            ladder = "".join(
                f'<div class="lad__r{" lad__r--held" if held else ""}">'
                f'<span class="lad__i">{i}</span><span class="lad__o">{op}</span>'
                f'<span class="lad__x">{ops}</span><span class="lad__v">{res}</span></div>'
                for i, op, ops, res, held in LADDER_ROWS
            )
            legend = "".join(
                f'<li><i style="background:{t["series"][k]}"></i><span>{CLASSES[k]}</span>'
                f' <b>{CURRENT[k]:.2f}%</b></li>'.replace(".", ",", 1)
                for k in range(5)
            )
            rows = "".join(
                "<tr><td>{c}</td><td class=\"n\">{a}</td><td class=\"n\">{b}</td>"
                "<td class=\"n\">{d}</td></tr>".format(
                    c=CLASSES[k],
                    a=f"{CURRENT[k]:.2f}%".replace(".", ","),
                    b=f"{TARGET[k]:.2f}%".replace(".", ","),
                    d=f"{CURRENT[k]-TARGET[k]:+.2f}pp".replace(".", ","),
                )
                for k in range(5)
            )
            panes.append(PANE.format(
                scheme=scheme,
                scheme_label=("scuro · la sera, una lampada" if scheme == "dark"
                              else "chiaro · la scrivania di giorno"),
                swatches=sw, ticks=ticks_html(), ladder=ladder, legend=legend, rows=rows,
                slug=w["slug"],
                option=json.dumps(chart_option(w["chart"]), ensure_ascii=False),
                chart_note=w["chart_note"],
                f_system=w["faces"]["system"][0], f_value=w["faces"]["value"][0],
                f_declared=w["faces"]["declared"][0],
            ))

        html = HTML.format(
            slug=w["slug"], name=w["name"], subtitle=w["subtitle"],
            concept=w["concept"], why=w["why"], chart_note=w["chart_note"],
            elevation=w["elevation"],
            alarm_l=w["light"]["alarm"], alarm_d=w["dark"]["alarm"],
            faces=face_css(w["faces"], static),
            light_tokens=token_block('[data-scheme="light"]', w["light"], "light"),
            dark_tokens=token_block('[data-scheme="dark"]', w["dark"], "dark"),
            f_system=w["faces"]["system"][0], f_value=w["faces"]["value"][0],
            f_declared=w["faces"]["declared"][0],
            panes="\n".join(panes), static=static,
        )
        # the masthead needs a scheme too: inherit the world's primary one
        primary = "dark" if w.get("dark_first") else "light"
        html = html.replace('<html lang="it" data-world=',
                            f'<html lang="it" data-scheme="{primary}" data-world=')
        p = HERE / f"{w['slug']}.html"
        p.write_text(html, encoding="utf-8")
        print(f"wrote {p.relative_to(HERE.parents[2])}  ({p.stat().st_size:,} B)")


if __name__ == "__main__":
    build()
