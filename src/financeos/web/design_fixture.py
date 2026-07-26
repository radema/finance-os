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
        "caption": "EQUITY_DEVELOPED · Pension · ±2,00pp ABSOLUTE (la riga canonica)",
        "signed_severity": -3.0,
        "target_label": "obiettivo 40,00%",
        "severity_display": "3,00",
        "severity_class": "severity__value--breach",
        "aria_label": (
            "Equity/Developed al 34,00% contro un obiettivo del 40,00%, "
            "tolleranza più o meno 2,00 punti percentuali. Scostamento di 6,00 "
            "punti percentuali sotto l'obiettivo, pari a 3 ampiezze di banda: "
            "fuori tolleranza, al fondo della scala."
        ),
    },
    {
        "caption": "BOND_GOV_EUR · Emergency · ±5,00pp ABSOLUTE",
        "signed_severity": 1.79,
        "target_label": "obiettivo 30,00%",
        "severity_display": "1,79",
        "severity_class": "severity__value--breach",
        "aria_label": (
            "Bond governativi euro sopra l'obiettivo del 30,00% di 1,79 ampiezze "
            "di banda: fuori tolleranza."
        ),
    },
    {
        "caption": "EQUITY_EMERGING · Pension · RELATIVE 0,25 → ±2,50pp",
        "signed_severity": -0.42,
        "target_label": "obiettivo 10,00%",
        "severity_display": "0,42",
        "severity_class": "",
        "aria_label": (
            "Equity emergenti sotto l'obiettivo del 10,00% di 0,42 ampiezze di "
            "banda: entro tolleranza."
        ),
    },
    {
        "caption": "bucket_below_target_value · Emergency, nessuna banda definita",
        "signed_severity": None,
        "target_label": "soglia €24.000,00",
        "severity_display": "—",
        "severity_class": "severity__value--none",
        "aria_label": (
            "Questa condizione non definisce una banda di tolleranza, quindi non "
            "ha una severità: la scala è mostrata annullata e senza indice. "
            "Emergency detiene 18.014,80 euro contro una soglia di 24.000,00 euro."
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
            "il Bucket Personal non contiene ancora nulla, quindi le sue sette "
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
            "un Bucket in euro è stato confrontato con un obiettivo in dollari; "
            "il sistema solleva un errore invece di convertire in silenzio."
        ),
    },
]

# --- buckets --------------------------------------------------------------

_BUCKETS: list[dict[str, Any]] = [
    {"name": "Pension", "value": "€54.000,00", "share": "50,19%", "cls": "", "residual": False},
    {"name": "Children", "value": "€22.488,98", "share": "20,90%", "cls": "", "residual": False},
    {"name": "Emergency", "value": "€18.014,80", "share": "16,75%", "cls": "", "residual": False},
    {"name": "Personal", "value": "€0,00", "share": "0,00%", "cls": "", "residual": False},
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
# chart cannot drift from the interface it sits in.

_ALLOC_CLASSES = [
    "EQUITY_DEVELOPED",
    "EQUITY_EMERGING",
    "BOND_GOV_EUR",
    "BOND_CORP_IG",
    "CASH",
]
_ALLOC_CURRENT = [34.00, 9.50, 27.90, 8.00, 12.00]
_ALLOC_TARGET = [40.00, 10.00, 30.00, 10.00, 10.00]

_CHART_ALLOCATION: dict[str, Any] = {
    "grid": {"left": 8, "right": 30, "top": 12, "bottom": 8, "containLabel": True},
    "tooltip": {"trigger": "item", "axisPointer": {"type": "shadow"}},
    "xAxis": {
        "type": "value",
        "max": 45,
        "axisLabel": {"formatter": "{value}%"},
        "splitLine": {"show": True},
    },
    "yAxis": {
        "type": "category",
        "inverse": True,
        "data": ["EQ/DEV", "EQ/EMG", "GOV/EUR", "CORP/IG", "CASH"],
        "splitLine": {"show": False},
    },
    "series": [
        {
            "type": "bar",
            "name": "attuale",
            # colorBy: "data" walks the THEME's categorical array, one hue per
            # asset class, in the declared order of the strategy tree. This is
            # why the option carries no colours: the palette stays in the token
            # layer and the chart cannot drift from the interface.
            "colorBy": "data",
            "data": _ALLOC_CURRENT,
            "barWidth": 13,
            # The target is a REFERENCE, not a series: one axis only, never a
            # second scale. Drawn in ink so it reads as the strategy's mark
            # rather than as another measured quantity.
            "markPoint": {
                "symbol": "rect",
                "symbolSize": [3, 26],
                "silent": True,
                "itemStyle": {"color": "token:--ink-2"},
                "label": {"show": False},
                "data": [
                    {"coord": [t, i], "name": f"obiettivo {t}%"}
                    for i, t in enumerate(_ALLOC_TARGET)
                ],
            },
        }
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
            # The in-tolerance zone, |severity| <= 1. The same fact the
            # tolerance rail shades, in the same ink, so the two components
            # teach one idea rather than two.
            "markArea": {
                "silent": True,
                "itemStyle": {"color": "token:--verdigris-tint"},
                "label": {
                    "show": True,
                    "position": "insideBottomLeft",
                    "formatter": "entro tolleranza",
                    "color": "token:--verdigris",
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
            "Allocazione attuale contro obiettivo, per classe, alla data del "
            "24/07/2026. Le barre sono la serie come registrata nella "
            "valutazione run:0f31a9c4; i traguardi verticali sono gli obiettivi "
            "della strategia congelata."
        ),
        # A legend is always present for >= 2 series and every class is also
        # direct-labelled on the axis: the worst adjacent pair in the validated
        # palette sits in the tritan 6-8 band, so identity may never rest on
        # hue alone.
        "chart_allocation_legend": [
            {"label": "EQ/DEV", "swatch": "1", "value": "34,00%"},
            {"label": "EQ/EMG", "swatch": "2", "value": "9,50%"},
            {"label": "GOV/EUR", "swatch": "3", "value": "27,90%"},
            {"label": "CORP/IG", "swatch": "4", "value": "8,00%"},
            {"label": "CASH", "swatch": "5", "value": "12,00%"},
            {"label": "non targettizzato", "swatch": "void", "value": "12,16%"},
        ],
        "chart_allocation_head": ["Classe", "Attuale", "Obiettivo", "Scostamento"],
        "chart_allocation_rows": [
            [
                c,
                f"{cur:.2f}%".replace(".", ","),
                f"{tgt:.2f}%".replace(".", ","),
                f"{cur - tgt:+.2f}pp".replace(".", ","),
            ]
            for c, cur, tgt in zip(_ALLOC_CLASSES, _ALLOC_CURRENT, _ALLOC_TARGET, strict=True)
        ],
        "chart_severity": _CHART_SEVERITY,
        "chart_severity_caption": (
            "Severità dello stesso rilievo su 12 valutazioni. La banda in basso "
            "è la zona entro tolleranza. Il salto del 24/07 non è un movimento "
            "di mercato: è la riclassificazione del 19/07, annotata sulla serie."
        ),
        "chart_severity_head": ["Valutazione", "Severità"],
        "chart_severity_rows": [[d, v.replace(".", ",")] for d, v in _SEVERITY_SERIES],
    }
