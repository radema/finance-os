"""Canonical fixture values for the design-system preview.

These are the numbers from UX-0001 §8, which reconcile from one holdings
ledger, so the preview reads like the real product instead of like lorem ipsum.
The anchor row is preserved exactly as RFC-0005 §8.3 / RFC-0008 §5.1 state it:
Equity/Developed 34.00% against a 40.00% target, +/-2.00pp ABSOLUTE, drift
-6.00pp, severity 3.00, drift value -3,240.00 EUR. Net worth 107,586.33 EUR.

This module exists ONLY to render the design preview. It is not test data, it
is not the demo seed (that lives in ``demo/`` and is owned by the back end),
and nothing in the running application may import it.

Display strings are pre-formatted it-IT (decimal comma, thousands dot,
dd/mm/yyyy) per ADR-L03 section 5.2, because locale formatting is a
presentation concern applied in templates. Trace values are the opposite: they
are the canonical stored strings and must never be reformatted (UX-0001 4.2).
"""

from __future__ import annotations

from typing import Any

from financeos.web.labels import label_short

# --- provenance -------------------------------------------------------------

_PROVENANCE: dict[str, Any] = {
    "portfolio": "Patrimonio",
    "as_of": "24/07/2026",
    "run_id": "run:0f31a9c4",
    "run_url": "#",
    "mode": "ACTUAL",
    "input_digest": "sha256:9f2c…41ab",
    "evaluated_at": "24/07/2026 09:12",
}

_PROVENANCE_HYPOTHETICAL: dict[str, Any] = {
    **_PROVENANCE,
    "run_id": "run:c47e1b90",
    "mode": "HYPOTHETICAL",
    "input_digest": "sha256:1d08…9f31",
}

# --- the tolerance rail, across its whole legible range ---------------------
# Every case a screen can hand the partial: a clamped breach, an ordinary
# breach, inside tolerance, and a legitimately null severity.

_RAIL_CASES: list[dict[str, Any]] = [
    {
        "caption": (
            f"{label_short('EQUITY_DEVELOPED')} · Pensione · ±2,00pp ABSOLUTE (la riga canonica)"
        ),
        "signed_severity": -3.0,
        "target_label": "target 40,00%",
        "severity_display": "3,00",
        "severity_class": "severity__value--breach",
        "aria_label": (
            "Equity/Developed al 34,00% contro un target del 40,00%, "
            "tolleranza più o meno 2,00 punti percentuali. Scostamento di 6,00 "
            "punti percentuali sotto il target, pari a 3 ampiezze di banda: "
            "fuori tolleranza, al fondo della scala."
        ),
    },
    {
        "caption": f"{label_short('BOND_GOV_EUR')} · Emergenza · ±5,00pp ABSOLUTE",
        "signed_severity": 1.79,
        "target_label": "target 30,00%",
        "severity_display": "1,79",
        "severity_class": "severity__value--breach",
        "aria_label": (
            "Bond governativi euro sopra il target del 30,00% di 1,79 ampiezze "
            "di banda: fuori tolleranza."
        ),
    },
    {
        "caption": f"{label_short('EQUITY_EMERGING')} · Pensione · RELATIVE 0,25 → ±2,50pp",
        "signed_severity": -0.42,
        "target_label": "target 10,00%",
        "severity_display": "0,42",
        "severity_class": "",
        "aria_label": (
            "Equity emergenti sotto il target del 10,00% di 0,42 ampiezze di "
            "banda: entro tolleranza."
        ),
    },
    {
        "caption": "bucket_below_target_value · Emergenza, nessuna banda definita",
        "signed_severity": None,
        "target_label": "soglia €24.000,00",
        "severity_display": "—",
        "severity_class": "severity__value--none",
        "aria_label": (
            "Questa condizione non definisce una banda di tolleranza, quindi non "
            "ha una severità: la scala è mostrata annullata e senza indice. "
            "Emergenza detiene 18.014,80 euro contro una soglia di 24.000,00 euro."
        ),
    },
]

# --- the trace ladder -------------------------------------------------------
# Values are the CANONICAL STORED STRINGS. Never reformat these.

_BINDINGS: list[dict[str, Any]] = [
    {
        "name": "effective_target",
        "value": "0.4000",
        "source": "strategy_version sv:1f2c… · targets.EQUITY.DEVELOPED",
        "source_url": "#",
    },
    {
        "name": "tolerance",
        "value": "ABSOLUTE 0.0200",
        "source": "strategy_version sv:1f2c… · targets.EQUITY.DEVELOPED.tolerance",
        "source_url": "#",
    },
    {
        "name": "effective_band",
        "value": "0.0200",
        "source": "derived · engine=strategy",
        "source_url": None,
    },
    {
        "name": "current_value",
        "value": "18360.00",
        "source": "derived · engine=portfolio · inputs op:4a1b…, op:9c2d…, price:7e5f…",
        "source_url": "#",
    },
    {
        "name": "total_value",
        "value": "54000.00",
        "source": "derived · engine=portfolio · scope bucket:8f3a… @ as_of",
        "source_url": None,
    },
    {
        "name": "current_weight",
        "value": "0.3400",
        "source": "derived · engine=portfolio",
        "source_url": None,
    },
]

_STEPS: list[dict[str, Any]] = [
    {
        "ordinal": 1,
        "op": "divide_safe",
        "operands": "current_value ÷ total_value",
        "result": "current_weight = 0.3400",
    },
    {
        "ordinal": 2,
        "op": "multiply",
        "operands": "EQUITY 0.5000 × DEVELOPED 0.8000",
        "result": "effective_target = 0.4000",
    },
    {
        "ordinal": 3,
        "op": "subtract",
        "operands": "current_weight − effective_target",
        "result": "drift = −0.0600",
    },
    {"ordinal": 4, "op": "abs", "operands": "drift", "result": "abs_drift = 0.0600"},
    {
        "ordinal": 5,
        "op": "divide_safe",
        "operands": "abs_drift ÷ effective_band",
        "result": "severity = 3.0000",
    },
    {
        "ordinal": 6,
        "op": "abs_gt",
        "operands": "drift, effective_band",
        "result": "FIRED",
        "held": True,
    },
]

# --- the skip notice --------------------------------------------------------

_SKIP_REASONS: list[dict[str, Any]] = [
    {
        "reason": "zero_portfolio_value",
        "count": 7,
        "explanation": (
            "il Bucket Personale non contiene ancora nulla, quindi le sue sette "
            "regole non avevano nulla da misurare."
        ),
    },
    {
        "reason": "heterogeneous_strategies",
        "count": 1,
        "explanation": (
            "lo scostamento a livello di portafoglio non è calcolabile finché i "
            "Bucket seguono strategie diverse: una media fra strategie "
            "incommensurabili sarebbe un numero inventato."
        ),
    },
    {
        "reason": "currency_mismatch",
        "count": 1,
        "explanation": (
            "un Bucket in euro è stato confrontato con un target in dollari; "
            "il sistema solleva un errore invece di convertire in silenzio."
        ),
    },
]

# --- buckets --------------------------------------------------------------

_BUCKETS: list[dict[str, Any]] = [
    {"name": "Pensione", "value": "€54.000,00", "share": "50,19%", "cls": "", "residual": False},
    {"name": "Figli", "value": "€22.488,98", "share": "20,90%", "cls": "", "residual": False},
    {"name": "Emergenza", "value": "€18.014,80", "share": "16,75%", "cls": "", "residual": False},
    {"name": "Personale", "value": "€0,00", "share": "0,00%", "cls": "", "residual": False},
    {
        "name": "UNASSIGNED · residuo non assegnato",
        "value": "€13.082,55",
        "share": "12,16%",
        "cls": "",
        "residual": True,
    },
]

# --- charts -----------------------------------------------------------------
# Options carry NO colours: the theme supplies them from the token layer, so a
# chart cannot drift from the interface it sits in. Where a mark needs a role
# colour a theme cannot express, the option says "token:--name" and the helper
# resolves it from the computed style — which is why one option renders
# correctly in both schemes.
#
# Marks name their ROLE ("casing", "core", "edge", "void", "segment") and
# static/js/charts.js supplies that role's geometry. A screen that hand-rolls
# opacities and offsets has forked the chart language.

# The allocation scope is the Pensione Bucket, which is where UX-0001 §8's
# canonical row lives: EQUITY_DEVELOPED at 34.00% of 54.000,00 EUR against a
# 40.00% target, +/-2.00pp ABSOLUTE, drift -6.00pp, severity 3.00.
#
# SIX classes, not five. The sixth, EQUITY_GLOBAL, is UNTARGETED: it has no
# declared target and nonetheless stays in the denominator (RFC-0007 §4.1), so
# the currents sum to 100.00 and the targets sum to 100.00 with nothing declared
# for it. In the cased cane that reads without a word: it is the one cane drawn
# with NO CASING around it, because no shape was ever declared for it.
_ALLOC_CLASSES = [
    "EQUITY_DEVELOPED",
    "EQUITY_EMERGING",
    "BOND_GOV_EUR",
    "BOND_CORP_IG",
    "CASH",
    "EQUITY_GLOBAL",
]

# Axis and legend form. ADR-L03 §5.1's label registry (docs/plans/L05) renders
# these as full Italian noun phrases with grammatical gender — "le Azioni dei
# paesi sviluppati" — which is right for prose and wrong for an axis tick, where
# the article is noise. So the registry owes TWO forms and this is the axis one:
# the noun phrase without its article. The layout is sized for the longer of the
# two, which is why the y-axis label wraps at a fixed width and the legend is a
# grid rather than a flex row.
_ALLOC_LABELS = [
    "Azioni dei paesi sviluppati",
    "Azioni dei paesi emergenti",
    "Obbligazioni governative EUR",
    "Obbligazioni corporate investment grade",
    "Liquidità",
    "Azioni globali",
]

# current and target as a percentage of the Bucket. `None` where nothing was
# declared: an untargeted class has no casing, not a zero-width one.
_ALLOC_CURRENT: list[float] = [34.00, 9.50, 27.90, 8.00, 12.00, 8.60]
_ALLOC_TARGET: list[float | None] = [40.00, 10.00, 30.00, 10.00, 10.00, None]

_TARGETED = [t if t is not None else None for t in _ALLOC_TARGET]
_CORE: list[float | None] = [
    c if t is not None else None for c, t in zip(_ALLOC_CURRENT, _ALLOC_TARGET, strict=True)
]
_VOID: list[float | None] = [
    c if t is None else None for c, t in zip(_ALLOC_CURRENT, _ALLOC_TARGET, strict=True)
]

# THE CASED CANE. Four marks, three of them colourless, and the two facts that
# matter are carried by GEOMETRY rather than by hue:
#     a core short of its casing   -> a shortfall (unfilled casing)
#     a core past the target tick  -> an overshoot (a protrusion)
# CASH is deliberately over target in this fixture so the overshoot reading is
# on the page and not just described.
_CHART_ALLOCATION: dict[str, Any] = {
    "caneWidth": 22,
    "grid": {"left": 8, "right": 34, "top": 12, "bottom": 8, "containLabel": True},
    "tooltip": {"trigger": "item"},
    "xAxis": {
        "type": "value",
        "max": 45,
        "axisLabel": {"formatter": "{value}%"},
        "splitLine": {"show": True},
    },
    "yAxis": {
        "type": "category",
        "inverse": True,
        "data": _ALLOC_LABELS,
        "splitLine": {"show": False},
        # direct-labelled on the axis, and wrapped rather than truncated: a
        # truncated class name is not an identity, and identity may never rest
        # on hue alone.
        "axisLabel": {"width": 168, "overflow": "break", "lineHeight": 14},
    },
    "series": [
        {
            # THE CASING — the shape the frozen strategy declared.
            "mark": "casing",
            "name": "target",
            "colorBy": "data",
            "data": _TARGETED,
            # The target also gets its own tick, drawn in ink on the SAME axis:
            # one scale only, never a second. The casing shows the extent; the
            # tick makes the exact declared value readable.
            "markPoint": {
                "symbol": "rect",
                "symbolSize": [2, 30],
                "silent": True,
                "itemStyle": {"color": "token:--ink-2"},
                "label": {"show": False},
                "data": [
                    {"coord": [t, i], "name": f"target {t}%"}
                    for i, t in enumerate(_ALLOC_TARGET)
                    if t is not None
                ],
            },
        },
        {
            # THE CORE — what is actually there. colorBy "data" walks the
            # THEME's categorical array, one hue per class in the declared order
            # of the strategy tree, which is why the option carries no colours.
            "mark": "core",
            "name": "attuale",
            "colorBy": "data",
            "data": _CORE,
        },
        {
            # THE LUMINOUS LEADING EDGE — one light source for the whole world,
            # and the mark that makes the current value readable to a pixel
            # without reading a colour.
            "mark": "edge",
            "name": "attuale",
            "data": _CORE,
        },
        {
            # THE VOID CANE — untargeted capital. No hue, a hatch decal, and no
            # casing, because no shape was declared for it.
            "mark": "void",
            "name": "non targettizzato",
            "barGap": "-100%",
            "data": _VOID,
        },
    ],
}

# THE NESTED CANE — the second level of the same idea, and the one place a whole
# must reconcile: net worth IS its Buckets plus the unassigned residual. The
# segments are euro, not percentages, because this is the reconciliation and a
# percentage would hide a rounding gap. Personale holds nothing, so its segment
# is legitimately zero-width — an empty Bucket is a fact, not a missing one.
_COMPOSITION = [
    ("Pensione", 54000.00, "segment"),
    ("Figli", 22488.98, "segment"),
    ("Emergenza", 18014.80, "segment"),
    ("Personale", 0.00, "segment"),
    ("UNASSIGNED · residuo non assegnato", 13082.55, "void"),
]
_NET_WORTH = 107586.33

_CHART_COMPOSITION: dict[str, Any] = {
    "caneWidth": 34,
    "grid": {"left": 8, "right": 40, "top": 8, "bottom": 8, "containLabel": True},
    "tooltip": {"trigger": "item"},
    "xAxis": {
        "type": "value",
        "max": _NET_WORTH,
        "splitLine": {"show": True},
        "axisLabel": {"formatter": "{value}"},
    },
    "yAxis": {
        "type": "category",
        "data": ["Patrimonio netto"],
        "splitLine": {"show": False},
    },
    "series": [
        {
            "mark": mark,
            "name": name,
            "data": [value],
            **(
                {}
                if mark != "segment"
                else {
                    "itemStyle": {"color": f"token:--series-{i + 1}"},
                }
            ),
            # The whole is marked once, in ink, at the total: the reader can see
            # that the parts close on it rather than being told they do.
            **(
                {
                    "markLine": {
                        "silent": True,
                        "symbol": "none",
                        "lineStyle": {"color": "token:--ink-2", "width": 1},
                        "label": {
                            "formatter": "€107.586,33",
                            "position": "end",
                            "color": "token:--ink-2",
                            "fontSize": 10,
                        },
                        "data": [{"xAxis": _NET_WORTH}],
                    }
                }
                if i == 0
                else {}
            ),
        }
        for i, (name, value, mark) in enumerate(_COMPOSITION)
    ],
}

_SEVERITY_SERIES = [
    ("08/05", "1.10"),
    ("15/05", "1.18"),
    ("22/05", "1.21"),
    ("29/05", "1.34"),
    ("05/06", "1.38"),
    ("12/06", "1.30"),
    ("19/06", "1.44"),
    ("26/06", "1.47"),
    ("03/07", "1.52"),
    ("10/07", "1.55"),
    ("17/07", "1.58"),
    ("24/07", "3.00"),
]

_CHART_SEVERITY: dict[str, Any] = {
    "grid": {"left": 8, "right": 20, "top": 28, "bottom": 8, "containLabel": True},
    "tooltip": {"trigger": "axis"},
    "xAxis": {
        "type": "category",
        "data": [d for d, _ in _SEVERITY_SERIES],
        "boundaryGap": False,
        "splitLine": {"show": False},
    },
    "yAxis": {"type": "value", "max": 4, "splitNumber": 4, "minInterval": 1},
    "series": [
        {
            "type": "line",
            "name": "severità",
            "data": [float(v) for _, v in _SEVERITY_SERIES],
            "smooth": False,
            # The in-tolerance zone, |severity| <= 1: the SAME fact the
            # tolerance rail shades, in the same token, so the two components
            # teach one idea rather than two. Neutral, not green — the band is
            # a casing, and being inside it is not an achievement.
            "markArea": {
                "silent": True,
                "itemStyle": {"color": "token:--band"},
                "label": {
                    "show": True,
                    "position": "insideBottomLeft",
                    "formatter": "entro tolleranza",
                    "color": "token:--ink-3",
                    "fontSize": 10,
                },
                "data": [[{"yAxis": 0}, {"yAxis": 1}]],
            },
            # RFC-0009 §6: annotate the reclassification date. An unexplained
            # jump is a bug; an annotated one is information.
            "markLine": {
                "silent": True,
                "symbol": "none",
                "lineStyle": {"color": "token:--annot", "type": "dashed", "width": 1},
                "label": {
                    "formatter": "riclassificazione 19/07",
                    "position": "end",
                    "rotate": 0,
                    "color": "token:--annot",
                    "fontSize": 10,
                    "align": "right",
                    "offset": [0, -14],
                },
                "data": [{"xAxis": "17/07"}],
            },
        }
    ],
}

# ONE POINT IS NEVER A LINE. A first evaluation has one severity and no trend,
# and a line chart drawn through a single datum draws a slope out of nothing.
# static/js/charts.js forces the honest mark — a labelled dot with no line —
# so no caller has to remember. This fixture exists to prove that it does.
_CHART_SEVERITY_SINGLE: dict[str, Any] = {
    "grid": {"left": 8, "right": 24, "top": 28, "bottom": 8, "containLabel": True},
    "tooltip": {"trigger": "item"},
    "xAxis": {
        "type": "category",
        "data": ["24/07"],
        "boundaryGap": True,
        "splitLine": {"show": False},
    },
    "yAxis": {"type": "value", "max": 4, "splitNumber": 4, "minInterval": 1},
    "series": [
        {
            "type": "line",
            "name": "severità",
            "data": [3.00],
            "markArea": {
                "silent": True,
                "itemStyle": {"color": "token:--band"},
                "label": {
                    "show": True,
                    "position": "insideBottomLeft",
                    "formatter": "entro tolleranza",
                    "color": "token:--ink-3",
                    "fontSize": 10,
                },
                "data": [[{"yAxis": 0}, {"yAxis": 1}]],
            },
        }
    ],
}


def preview_context() -> dict[str, Any]:
    """Everything ``templates/design/preview.html`` needs, in one dict."""
    return {
        "provenance": _PROVENANCE,
        "provenance_hypothetical": _PROVENANCE_HYPOTHETICAL,
        "rail_cases": _RAIL_CASES,
        "bindings": _BINDINGS,
        "steps": _STEPS,
        "skip_reasons": _SKIP_REASONS,
        "buckets": _BUCKETS,
        "chart_allocation": _CHART_ALLOCATION,
        "chart_allocation_caption": (
            "Allocazione del Bucket Pensione contro la strategia congelata, alla "
            "data del 24/07/2026. La cassa translucida è la forma dichiarata "
            "— il target — e il nucleo pieno è quello che c'è davvero: se il "
            "nucleo resta corto la cassa si vede vuota, se sporge oltre la "
            "tacca è oltre il target. Serie come registrata in run:0f31a9c4."
        ),
        # A legend is always present, and every class is ALSO direct-labelled on
        # the axis. Two reasons, both mandatory: the palette's tritan separation
        # is 4.8 in light, and no five-hue set can clear all-pairs CVD — so
        # identity may never rest on hue alone. The first three entries name the
        # three marks of the cased cane, because a reader who has not been told
        # which is the target cannot use the geometry.
        "chart_allocation_legend": [
            {"label": "target dichiarato (la cassa)", "swatch": "casing", "value": None},
            {"label": "attuale (il nucleo)", "swatch": "core", "value": None},
            {"label": "valore letto sul bordo di luce", "swatch": "edge", "value": None},
            {"label": "Azioni dei paesi sviluppati", "swatch": "1", "value": "34,00%"},
            {"label": "Azioni dei paesi emergenti", "swatch": "2", "value": "9,50%"},
            {"label": "Obbligazioni governative EUR", "swatch": "3", "value": "27,90%"},
            {"label": "Obbligazioni corporate IG", "swatch": "4", "value": "8,00%"},
            {"label": "Liquidità", "swatch": "5", "value": "12,00%"},
            {"label": "Azioni globali · non targettizzato", "swatch": "void", "value": "8,60%"},
        ],
        "chart_allocation_head": ["Classe", "Attuale", "Target", "Scostamento"],
        "chart_allocation_rows": [
            [
                label,
                f"{cur:.2f}%".replace(".", ","),
                "—" if tgt is None else f"{tgt:.2f}%".replace(".", ","),
                "nessun target" if tgt is None else f"{cur - tgt:+.2f}pp".replace(".", ","),
            ]
            for label, cur, tgt in zip(
                _ALLOC_LABELS, _ALLOC_CURRENT, _ALLOC_TARGET, strict=True
            )
        ],
        "chart_composition": _CHART_COMPOSITION,
        "chart_composition_caption": (
            "La stessa idea, un livello più su: il patrimonio netto è i suoi "
            "Bucket più il residuo non assegnato, e i segmenti chiudono "
            "esattamente sulla tacca del totale. Personale non contiene ancora "
            "nulla: il suo segmento è larghezza zero, che è un fatto e non un "
            "dato mancante."
        ),
        "chart_composition_legend": [
            {"label": name, "swatch": ("void" if mark == "void" else str(i + 1)),
             "value": f"€{value:,.2f}".replace(",", "·").replace(".", ",").replace("·", ".")}
            for i, (name, value, mark) in enumerate(_COMPOSITION)
        ],
        "chart_composition_head": ["Bucket", "Valore"],
        "chart_composition_rows": [
            [name, f"€{value:,.2f}".replace(",", "·").replace(".", ",").replace("·", ".")]
            for name, value, _ in _COMPOSITION
        ],
        "chart_severity": _CHART_SEVERITY,
        "chart_severity_caption": (
            "Severità dello stesso rilievo su 12 valutazioni. La banda in basso "
            "è la zona entro tolleranza. Il salto del 24/07 non è un movimento "
            "di mercato: è la riclassificazione del 19/07, annotata sulla serie."
        ),
        "chart_severity_head": ["Valutazione", "Severità"],
        "chart_severity_rows": [[d, v.replace(".", ",")] for d, v in _SEVERITY_SERIES],
        "chart_severity_single": _CHART_SEVERITY_SINGLE,
        "chart_severity_single_caption": (
            "Una sola valutazione: un punto, non una linea. Con un solo dato non "
            "esiste una tendenza da mostrare, quindi il grafico non ne disegna "
            "una — il segno resta un punto etichettato."
        ),
        "chart_severity_single_head": ["Valutazione", "Severità"],
        "chart_severity_single_rows": [["24/07", "3,00"]],
        # The empty state is `option = None`: the partial renders a state block
        # instead of a plot frame, because an empty frame reads as a zero.
        "chart_empty_caption": (
            "Severità di questo rilievo nel tempo. Nessuna serie: questo rilievo "
            "è comparso per la prima volta nella valutazione corrente."
        ),
        "chart_empty_lead": "Nessuno storico da mostrare.",
        "chart_empty_body": (
            "Questo rilievo non è mai stato valutato prima del 24/07/2026, quindi "
            "non c'è una serie da leggere. Non è uno zero: è l'assenza di una "
            "misura, e le due cose non si somigliano."
        ),
        "chart_empty_head": ["Valutazione", "Severità"],
        "chart_empty_rows": [],
    }
