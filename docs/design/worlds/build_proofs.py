"""Build the World B statement page — the decided visual world, offline.

    uv run python docs/design/worlds/build_proofs.py

WHAT THIS IS NOW, AND WHAT IT WAS
--------------------------------
It used to build three competing worlds as offline proofs, because a world had
to be chosen. One was: **B, Vetro Sommerso** (P15). So this builds one page, and
the two rejected proofs are deleted rather than left to rot — they referenced
six woff2 faces the winner does not ship, so keeping them would have meant
either keeping dead fonts in the repo or publishing pages with broken
references. The decision itself is recorded in the handoff's §5.0 table, which is
where a decision belongs; an HTML mock is a decision AID, not the record of one.

This page is the world's own statement: the thesis, the solved palette with its
measured numbers, the cased cane, the tolerance rail in and out of tolerance,
the four outcome chips and the trace ladder — in both schemes, on one page,
opening straight from the filesystem with the network off.

It is NOT the component reference. That is docs/design/preview.html, which
renders the real partials through the real templates; if a component looks wrong
there it is wrong everywhere. This page answers a different question: "is this
the world we chose, and did the palette actually get pushed?"

THE ONE RULE THIS FILE ENFORCES
-------------------------------
Every colour comes from docs/design/palette.json, and this script FAILS if a
value in that file is absent from the shipped tokens.css. The candidate proofs
each carried their own hardcoded token block, which is exactly how a proof and a
product drift apart — and §3.7 records that an incomplete design record is the
root cause of the design-system-color false-drift reports. A generated page that
cannot drift is cheaper than a page somebody has to check by eye.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
STATIC_REL = "../../../src/financeos/web/static"
PALETTE = ROOT / "docs" / "design" / "palette.json"
TOKENS_CSS = ROOT / "src" / "financeos" / "web" / "static" / "css" / "tokens.css"

# --- the fixture (UX-0001 §8, Pension bucket scope) -------------------------
# SIX classes. The sixth is UNTARGETED and still in the denominator
# (RFC-0007 §4.1), so the currents sum to 100.00 and the targets sum to 100.00
# with nothing declared for it. Labels are the axis form of the label registry:
# the noun phrase without its article (ADR-L03 §5.1 / L05).
CLASSES = [
    "Azioni dei paesi sviluppati",
    "Azioni dei paesi emergenti",
    "Obbligazioni governative EUR",
    "Obbligazioni corporate investment grade",
    "Liquidità",
    "Azioni globali",
]
CURRENT = [34.00, 9.50, 27.90, 8.00, 12.00, 8.60]
TARGET: list[float | None] = [40.00, 10.00, 30.00, 10.00, 10.00, None]

LADDER_ROWS = [
    ("3", "subtract", "current_weight − effective_target", "drift = −0.0600", False),
    ("4", "abs", "drift", "abs_drift = 0.0600", False),
    ("5", "divide_safe", "abs_drift ÷ effective_band", "severity = 3.0000", False),
    ("6", "abs_gt", "drift, effective_band", "FIRED", True),
]

FACES = [
    ("Archivo", "archivo-var-400-700.woff2", "100 700", "normal"),
    ("IBM Plex Mono", "ibm-plex-mono-400.woff2", "400", "normal"),
    ("Faustina", "faustina-400-600.woff2", "400 600", "normal"),
]

TOKEN_NAMES = [
    "ground", "sheet", "sheet-sunken", "ink", "ink-2", "ink-3",
    "rule", "rule-strong", "rule-control", "alarm", "alarm-tint",
    "caution", "caution-tint", "annot", "annot-tint", "edge", "band",
    "band-edge", "series-1", "series-2", "series-3", "series-4", "series-5",
    "series-void", "projection", "projection-tint",
]


def load_palette() -> tuple[dict[str, dict[str, str]], dict[str, object]]:
    data = json.loads(PALETTE.read_text(encoding="utf-8"))
    palette: dict[str, dict[str, str]] = data["palette"]
    css = TOKENS_CSS.read_text(encoding="utf-8")
    drift = [
        f"--{name}: {palette[scheme][name]} ({scheme})"
        for scheme in ("light", "dark")
        for name in TOKEN_NAMES
        if palette[scheme][name] not in css
    ]
    if drift:
        raise SystemExit(
            "PALETTE DRIFT — these solved values are absent from tokens.css:\n  "
            + "\n  ".join(drift)
            + "\n\nRe-run docs/design/palette_search.py and apply its output to "
            "tokens.css, or fix tokens.css. A proof that can disagree with the "
            "product is worse than no proof."
        )
    return palette, data["report"]


def face_css() -> str:
    out = []
    for family, file, weight, style in FACES:
        fmt = "woff2-variations" if " " in weight else "woff2"
        out.append(
            f'@font-face{{font-family:"{family}";font-style:{style};'
            f"font-weight:{weight};font-display:swap;"
            f'src:url("{STATIC_REL}/fonts/{file}") format("{fmt}"),'
            f'url("{STATIC_REL}/fonts/{file}") format("woff2");}}'
        )
    return "\n".join(out)


def token_block(selector: str, t: dict[str, str], scheme: str) -> str:
    body = "\n  ".join(f"--{n}: {t[n]};" for n in TOKEN_NAMES)
    return f"{selector} {{\n  color-scheme: {scheme};\n  {body}\n}}"


def chart_option() -> dict[str, object]:
    """THE CASED CANE. Series name their ROLE and static/js/charts.js supplies
    the geometry; role colours arrive as token:--name. The option carries no hex
    at all, which is what lets one option be correct in both schemes."""
    core = [c if t is not None else None for c, t in zip(CURRENT, TARGET, strict=True)]
    void = [c if t is None else None for c, t in zip(CURRENT, TARGET, strict=True)]
    return {
        "caneWidth": 22,
        "grid": {"left": 6, "right": 34, "top": 10, "bottom": 6, "containLabel": True},
        "tooltip": {"trigger": "item"},
        "xAxis": {"type": "value", "max": 45, "axisLabel": {"formatter": "{value}%"}},
        "yAxis": {
            "type": "category", "inverse": True, "data": CLASSES,
            "splitLine": {"show": False},
            "axisLabel": {"width": 150, "overflow": "break", "lineHeight": 13},
        },
        "series": [
            {
                "mark": "casing", "name": "target", "colorBy": "data", "data": TARGET,
                "markPoint": {
                    "symbol": "rect", "symbolSize": [2, 30], "silent": True,
                    "itemStyle": {"color": "token:--ink-2"}, "label": {"show": False},
                    "data": [
                        {"coord": [t, i]} for i, t in enumerate(TARGET) if t is not None
                    ],
                },
            },
            {"mark": "core", "name": "attuale", "colorBy": "data", "data": core},
            {"mark": "edge", "name": "attuale", "data": core},
            {"mark": "void", "name": "non targettizzato", "barGap": "-100%", "data": void},
        ],
    }


HTML = """<!DOCTYPE html>
<html lang="it" data-scheme="dark" data-world="b-vetro-sommerso">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vetro Sommerso · il mondo visivo deciso · Finance OS</title>
<style>
{faces}

{dark_tokens}
{light_tokens}

*,*::before,*::after{{box-sizing:border-box}}
:root{{
 --face-system:"Archivo",system-ui,sans-serif;
 --face-value:"IBM Plex Mono",ui-monospace,monospace;
 --face-declared:"Faustina",Georgia,serif;
}}
body{{margin:0;font-family:var(--face-system);font-size:14px;line-height:1.5;
 -webkit-font-smoothing:antialiased}}
h1,h2,h3,p,dl,dd{{margin:0}}
.value{{font-family:var(--face-value);font-variant-numeric:tabular-nums;
 font-feature-settings:"tnum" 1,"zero" 1;letter-spacing:-.01em}}
.declared{{font-family:var(--face-declared);font-size:16px;line-height:1.6}}
.ident{{font-family:var(--face-value);font-size:11px;color:var(--ink-2);overflow-wrap:anywhere}}
:focus-visible{{outline:2px solid var(--annot);outline-offset:2px}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}

.masthead{{background:var(--ground);color:var(--ink);padding:30px 32px 26px;
 border-bottom:1px solid var(--rule-strong)}}
.masthead h1{{font-size:27px;font-weight:700;letter-spacing:-.02em}}
.masthead .sub{{font-family:var(--face-value);font-size:11px;color:var(--ink-3);
 letter-spacing:.08em;text-transform:uppercase;margin-top:6px}}
.masthead .lede{{max-width:76ch;margin-top:14px;color:var(--ink-2);font-size:14px}}
.masthead .lede b{{color:var(--ink)}}
.pane{{background:var(--ground);color:var(--ink);padding:24px 32px 40px}}
.pane__tag{{font-family:var(--face-value);font-size:10px;letter-spacing:.14em;
 text-transform:uppercase;color:var(--ink-3);padding-bottom:8px;margin-bottom:20px;
 border-bottom:1px solid var(--rule-strong)}}
.block{{margin-bottom:28px}}
.block>h3{{font-family:var(--face-value);font-size:10px;font-weight:500;letter-spacing:.14em;
 text-transform:uppercase;color:var(--ink-3);margin-bottom:10px}}
.cols{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}}
.card{{background:var(--sheet);border:1px solid var(--rule-strong);padding:16px}}
.row{{display:flex;flex-wrap:wrap;gap:12px;align-items:center}}
.note{{font-size:12px;color:var(--ink-3);max-width:68ch;margin-top:8px}}
.sw{{display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:6px}}
.sw>div{{border:1px solid var(--rule-strong)}}
.sw i{{display:block;height:36px}}
.sw span{{display:block;padding:3px 6px;background:var(--sheet);font-family:var(--face-value);
 font-size:10px;color:var(--ink-2)}}

/* the tolerance rail — geometry identical to the shipped partial */
.rail{{min-width:150px}}
.rail__s{{position:relative;height:22px}}
.rail__base{{position:absolute;inset-inline:0;bottom:4px;height:1px;background:var(--rule-strong)}}
.rail__band{{position:absolute;inset-inline:33.3333%;bottom:4px;height:12px;
 background:var(--band);border-inline:1px solid var(--band-edge)}}
.rail__t{{position:absolute;left:var(--at);bottom:0;width:1px;height:4px;background:var(--ink-3)}}
.rail__t--b{{bottom:4px;height:12px;background:var(--band-edge)}}
.rail__t--g{{bottom:4px;height:19px;background:var(--ink);width:1px}}
.rail__i{{position:absolute;left:var(--at);bottom:1px;width:3px;height:18px;
 margin-inline-start:-1px;background:var(--edge);box-shadow:0 0 0 1px var(--sheet)}}
.rail__i::before{{content:"";position:absolute;left:50%;top:-6px;transform:translateX(-50%);
 border-inline:4px solid transparent;border-top:6px solid var(--edge)}}
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

/* outcome chips — texture carries the distinction, not hue */
.oc{{font-family:var(--face-value);font-size:10px;letter-spacing:.05em;padding:2px 7px;
 border:1px solid;white-space:nowrap}}
.oc--f{{color:var(--sheet);background:var(--alarm);border-color:var(--alarm)}}
.oc--n{{color:var(--ink-2);background:transparent;border-color:var(--rule-control)}}
.oc--s{{color:var(--caution);background:var(--caution-tint);border-color:var(--caution);
 border-style:dashed}}
.oc--e{{color:var(--alarm);border-color:var(--alarm);background:
 repeating-linear-gradient(-45deg,transparent 0 4px,
 color-mix(in srgb,var(--alarm) 24%,transparent) 4px 5px),var(--alarm-tint)}}

/* trace ladder */
.lad{{font-family:var(--face-value);font-variant-numeric:tabular-nums;font-size:12.5px;
 line-height:1.7}}
.lad__r{{display:grid;grid-template-columns:24px 96px minmax(0,1fr) 150px;gap:10px;
 padding:3px 0;border-bottom:1px dotted var(--rule)}}
.lad__h{{font-family:var(--face-system);font-size:10px;letter-spacing:.12em;
 text-transform:uppercase;color:var(--ink-3);border-bottom:1px solid var(--rule-strong)}}
.lad__i{{color:var(--ink-3);text-align:right}}
.lad__o{{color:var(--annot);font-weight:500}}
.lad__x{{color:var(--ink-2)}}
.lad__v{{text-align:right;font-weight:500}}
.lad__r--held{{background:var(--sheet-sunken);border-bottom:0;
 border-top:1px solid var(--rule-strong);margin-inline:-8px;padding-inline:8px}}
.lad__r--held .lad__v{{color:var(--alarm)}}

.chart{{width:100%;height:300px}}
.leg{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));
 gap:8px 16px;padding:0;margin:12px 0 0;list-style:none;font-size:12px}}
.leg li{{display:flex;align-items:baseline;gap:6px;min-width:0;color:var(--ink-2)}}
.leg i{{width:10px;height:10px;flex:none;transform:translateY(1px);
 box-shadow:0 0 0 1px var(--sheet)}}
.leg b{{margin-inline-start:auto;padding-inline-start:8px;font-family:var(--face-value);
 font-weight:400;color:var(--ink)}}
.leg .void{{background:var(--series-void);background-image:repeating-linear-gradient(45deg,
 transparent 0 3px,color-mix(in srgb,var(--ink) 34%,transparent) 3px 4px)}}
.leg .casing{{background:color-mix(in srgb,var(--ink-3) 30%,transparent);
 box-shadow:inset 0 0 0 1px var(--rule-control)}}
.leg .core{{background:var(--ink-3)}}
.leg .edge{{background:transparent;box-shadow:inset -3px 0 0 0 var(--edge),
 0 0 0 1px var(--rule-control)}}
table{{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}}
th{{font-family:var(--face-system);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
 color:var(--ink-3);text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule-strong)}}
td{{padding:5px 8px;border-bottom:1px solid var(--rule)}}
td.n,th.n{{text-align:right;font-family:var(--face-value);font-variant-numeric:tabular-nums}}
</style>
</head>
<body>

<header class="masthead">
  <h1>Vetro Sommerso</h1>
  <p class="sub">Murano · canne di vetro · sommerso a strati · il mondo deciso</p>
  <p class="lede">Vetro veneziano, prima di tutto scuro. Un fondo blu inchiostro
  profondo con canne luminose lette in trasparenza, e ogni segno costruito come
  strati sommersi sotto una sola sorgente di luce. <b>Sommerso</b> è la tecnica
  di incassare un colore dentro un altro: ed è esattamente ciò che è una
  ripartizione con obiettivi — una forma dichiarata con dentro una quantità
  reale. Per questo qui la forma del grafico e la tavolozza sono la stessa
  decisione, e non due.</p>
  <p class="lede"><b>La tavolozza è stata spinta, e non a mano.</b> Ogni valore è
  risolto per ricerca contro le soglie del validatore su entrambe le superfici
  ({search}). Il croma medio delle serie è <span class="value">{chroma}</span>
  contro il minimo di <span class="value">0,10</span> su cui stava la proposta
  precedente; la separazione adiacente peggiore per daltonismo è
  <span class="value">{cvd}</span> contro un obiettivo di
  <span class="value">8,0</span> — l'avviso protan 7,6 non c'è più; e il fondo,
  che deve contrasto solo al testo e mai a una serie, porta
  <span class="value">{ground_chroma}</span> di croma contro
  <span class="value">0,028</span>.</p>
  <p class="lede"><b>La regola su cui poggia tutto:</b> la metà calda della ruota
  è riservata allo stato, i dati vivono nella metà fredda. Un segno caldo, qui,
  non è mai una misura.</p>
</header>

{panes}

<script src="{static}/vendor/echarts/echarts.min.js"></script>
<script src="{static}/js/charts.js"></script>
</body>
</html>
"""

PANE = """
<section class="pane" data-scheme="{scheme}">
  <p class="pane__tag">{scheme_label}</p>

  <div class="block">
    <h3>Tavolozza · risolta, non scelta</h3>
    <div class="sw">{swatches}</div>
    <p class="note">Le cinque tinte di serie superano ogni controllo del
    validatore (banda di luminosità, croma, separazione per daltonismo, visione
    normale, contrasto) su <em>entrambe</em> le superfici. Allarme e cautela sono
    esclusi dall'insieme delle serie <em>per finestra di tinta</em>, non solo per
    distanza misurata: una passata precedente della ricerca aveva parcheggiato
    una serie a un passo di luminosità dall'allarme superando ogni controllo.</p>
  </div>

  <div class="block">
    <h3>La canna incassata · allocazione contro la strategia congelata</h3>
    <div class="card">
      <script type="application/json" id="opt-{scheme}">{option}</script>
      <div class="chart" data-chart="opt-{scheme}" role="img"
           aria-label="Allocazione attuale contro il target dichiarato, sei classi di attivo"></div>
      <ul class="leg">
        <li><i class="casing"></i><span>target dichiarato (la cassa)</span></li>
        <li><i class="core"></i><span>attuale (il nucleo)</span></li>
        <li><i class="edge"></i><span>valore sul bordo di luce</span></li>
        {legend}
      </ul>
      <table>
        <thead><tr><th>Classe</th><th class="n">Attuale</th><th class="n">Target</th>
          <th class="n">Scostamento</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    <p class="note">Due fatti sono portati dalla <strong>geometria</strong>, non
    dalla tinta: se il nucleo resta corto la cassa si vede vuota, se sporge oltre
    la tacca è oltre il target. La Liquidità è sopra il suo target, e si legge
    senza guardare un colore. Le Azioni globali non hanno cassa perché per loro
    non è mai stata dichiarata una forma — capitale non targettizzato, che resta
    comunque nel denominatore. Il colore porta <em>solo</em> l'identità: è questo
    che permette di spingere la tavolozza senza renderla portante.</p>
  </div>

  <div class="block">
    <h3>Guida di tolleranza · fuori e dentro tolleranza</h3>
    <div class="cols">
      <div class="card">
        <p class="ident" style="margin-bottom:10px">Azioni dei paesi sviluppati ·
        Pension · ±2,00pp ABSOLUTE</p>
        <div class="row" style="align-items:flex-end;gap:24px">
          <div style="flex:1;min-width:160px">
            <div class="rail rail--brk" role="img"
                 aria-label="3 ampiezze di banda sotto il target: fuori tolleranza">
              <div class="rail__s">
                <span class="rail__base"></span><span class="rail__band"></span>
                {ticks}
                <span class="rail__i" style="--at:3%"></span>
                <span class="rail__c"></span>
              </div>
              <div class="rail__k"><span>−3</span><span>target 40,00%</span><span>+3</span></div>
            </div>
          </div>
          <div><div class="sev__l">Severità</div><div class="sev sev--brk">3,00</div></div>
        </div>
      </div>
      <div class="card">
        <p class="ident" style="margin-bottom:10px">Azioni dei paesi emergenti ·
        Pension · RELATIVE 0,25</p>
        <div class="row" style="align-items:flex-end;gap:24px">
          <div style="flex:1;min-width:160px">
            <div class="rail" role="img"
                 aria-label="0,42 ampiezze di banda sotto il target: entro tolleranza">
              <div class="rail__s">
                <span class="rail__base"></span><span class="rail__band"></span>
                {ticks}
                <span class="rail__i" style="--at:43%"></span>
              </div>
              <div class="rail__k"><span>−3</span><span>target 10,00%</span><span>+3</span></div>
            </div>
          </div>
          <div><div class="sev__l">Severità</div><div class="sev">0,42</div></div>
        </div>
      </div>
    </div>
    <p class="note">Entro tolleranza è <strong>neutro</strong>, non verde: la
    banda è la <em>cassa</em>, la stessa idea della canna, e l'indice è disegnato
    nella sorgente di luce — lo stesso token del bordo luminoso. Il sistema
    riporta, non si congratula. Solo lo scostamento prende colore.</p>
  </div>

  <div class="block">
    <h3>Chip di esito · la texture porta la distinzione, non la tinta</h3>
    <div class="row">
      <span class="oc oc--f">Scattata</span>
      <span class="oc oc--n">NON Scattata</span>
      <span class="oc oc--s">NON VALUTATO</span>
      <span class="ident">zero_portfolio_value</span>
      <span class="oc oc--e">ERRORE</span>
      <span class="ident">currency_mismatch</span>
    </div>
    <p class="note">Pieno · filo · tratteggiato · tratteggio incrociato. Due soli
    inchiostri riservati e quattro texture: restano inconfondibili in scala di
    grigi e per chi non distingue rosso e verde. <em>NON VALUTATO</em> ed
    <em>ERRORE</em> non sono mai rassicuranti.</p>
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
    <h3>Le tre voci</h3>
    <div class="card">
      <p>Le Azioni dei paesi sviluppati <strong>sono</strong>
      <span class="value" style="color:var(--alarm)">6,00pp</span> sotto il
      target del <span class="value">40,00%</span> (tolleranza
      <span class="value">±2,00pp</span>). Attuale
      <span class="value">34,00%</span>,
      <span class="value" style="color:var(--alarm)">−€3.240,00</span>.</p>
      <p class="declared" style="margin-top:12px;padding-inline:20px">«Ho ridotto
      la quota dei mercati emergenti dal 30% al 20% dell'azionario: non è una
      visione sui mercati, mi sono accorto che ribilanciavo per disagio e non per
      piano.»</p>
      <p class="note">Sistema in Archivo · valori in IBM Plex Mono · le parole
      dell'utente in Faustina. L'accordo grammaticale qui è deliberato:
      «Azioni» è femminile plurale e vuole <em>sono</em>, non <em>è</em>.</p>
    </div>
  </div>
</section>
"""


def ticks_html() -> str:
    out = []
    for step in (-3, -2, -1, 0, 1, 2, 3):
        at = 50.0 + (step / 6.0) * 100.0
        cls = " rail__t--g" if step == 0 else (" rail__t--b" if step in (-1, 1) else "")
        out.append(f'<span class="rail__t{cls}" style="--at:{at:.4f}%"></span>')
    return "".join(out)


def it(value: float, unit: str = "%", signed: bool = False) -> str:
    text = f"{value:+.2f}" if signed else f"{value:.2f}"
    return text.replace(".", ",") + unit


def legend_html(t: dict[str, str]) -> str:
    out = []
    for k in range(len(CLASSES)):
        if TARGET[k] is None:
            swatch = '<i class="void"></i>'
            label = f"{CLASSES[k]} · non targettizzato"
        else:
            swatch = f'<i style="background:{t[f"series-{k + 1}"]}"></i>'
            label = CLASSES[k]
        out.append(f"<li>{swatch}<span>{label}</span> <b>{it(CURRENT[k])}</b></li>")
    return "".join(out)


def rows_html() -> str:
    out = []
    for k in range(len(CLASSES)):
        tgt = TARGET[k]
        out.append(
            f"<tr><td>{CLASSES[k]}</td>"
            f'<td class="n">{it(CURRENT[k])}</td>'
            f'<td class="n">{"—" if tgt is None else it(tgt)}</td>'
            f'<td class="n">'
            f'{"nessun target" if tgt is None else it(CURRENT[k] - tgt, "pp", signed=True)}'
            f"</td></tr>"
        )
    return "".join(out)


def build() -> None:
    palette, report = load_palette()
    dark_report: dict[str, object] = report["dark"]  # type: ignore[assignment,index]

    panes = []
    for scheme in ("dark", "light"):
        t = palette[scheme]
        swatch_rows = [(f"serie {i}", t[f"series-{i}"]) for i in range(1, 6)]
        swatch_rows += [
            ("vuoto", t["series-void"]),
            ("allarme", t["alarm"]),
            ("cautela", t["caution"]),
            ("riferimento", t["annot"]),
            ("bordo di luce", t["edge"]),
            ("fondo", t["ground"]),
            ("foglio", t["sheet"]),
            ("inchiostro", t["ink"]),
        ]
        swatches = "".join(
            f'<div><i style="background:{c}"></i><span>{label}<br>{c}</span></div>'
            for label, c in swatch_rows
        )
        ladder = "".join(
            f'<div class="lad__r{" lad__r--held" if held else ""}">'
            f'<span class="lad__i">{i}</span><span class="lad__o">{op}</span>'
            f'<span class="lad__x">{ops}</span><span class="lad__v">{res}</span></div>'
            for i, op, ops, res, held in LADDER_ROWS
        )
        panes.append(PANE.format(
            scheme=scheme,
            scheme_label=("scuro · la sera, una lampada · il mondo come è pensato"
                          if scheme == "dark" else "chiaro · la scrivania di giorno"),
            swatches=swatches, ticks=ticks_html(), ladder=ladder,
            legend=legend_html(t), rows=rows_html(),
            option=json.dumps(chart_option(), ensure_ascii=False),
        ))

    chroma_list: list[float] = dark_report["series_chroma"]  # type: ignore[assignment,index]
    cvd: float = dark_report["series_min_adjacent_cvd"]  # type: ignore[assignment,index]
    ground_chroma: float = dark_report["ground_chroma"]["ground"]  # type: ignore[index]
    sep: float = report["hue_min_separation_deg"]  # type: ignore[assignment,index]

    html = HTML.format(
        faces=face_css(),
        dark_tokens=token_block('[data-scheme="dark"]', palette["dark"], "dark"),
        light_tokens=token_block('[data-scheme="light"]', palette["light"], "light"),
        panes="\n".join(panes), static=STATIC_REL,
        search=f"separazione minima di tinta {sep:.0f}°",
        chroma=f"{sum(chroma_list) / len(chroma_list):.3f}".replace(".", ","),
        cvd=f"{cvd:.1f}".replace(".", ","),
        ground_chroma=f"{ground_chroma:.3f}".replace(".", ","),
    )
    out = HERE / "b-vetro-sommerso.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}  ({out.stat().st_size:,} B)")
    print("palette.json and tokens.css agree on every solved value")


if __name__ == "__main__":
    build()
