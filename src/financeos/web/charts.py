"""The Bucket-composition chart: `Net Worth = Buckets + unassigned residual` (ADR-0029).

Shared by `/allocation` (screen 3, where the reconciliation is first shown) and `/dashboard`
(task #12, which reuses it exactly rather than re-deriving the same reconciliation a second
time). Living here rather than inside either route's module is what keeps this a shared module
importing a route, not a route importing a route (task #12 review NIT — the first route-to-route
import in the repo).
"""

from __future__ import annotations

from typing import Any

from financeos.adapters.duckdb.queries.allocation import UNASSIGNED, AllocationView
from financeos.adapters.duckdb.queries.it_locale import format_money_it, format_percent_it
from financeos.web.labels import label_short

__all__ = ["bucket_chart", "bucket_label", "bucket_legend", "bucket_rows"]


def bucket_chart(view: AllocationView) -> dict[str, Any] | None:
    """The nested cane: Net Worth *is* its Buckets plus the unassigned residual.

    Segments are euro, not percentages, because this is the reconciliation and a percentage
    would hide a rounding gap. The whole is marked once, in ink, at the total, so a reader can
    *see* that the parts close on it instead of being told they do.

    A negative residual is legal (ADR-0025) and a stacked bar cannot draw it, so the chart is
    suppressed in that case and the ledger below carries the signed row instead. Drawing a
    deficit as if it were a holding would be the one misreading this screen must not permit.
    """
    if not view.buckets or view.net_worth <= 0:
        return None
    if any(b.value < 0 for b in view.buckets):
        return None

    return {
        "caneWidth": 34,
        "grid": {"left": 8, "right": 40, "top": 8, "bottom": 8, "containLabel": True},
        "tooltip": {"trigger": "item"},
        "xAxis": {
            "type": "value",
            "max": float(view.net_worth),
            "splitLine": {"show": True},
            "axisLabel": {"formatter": "{value}"},
        },
        "yAxis": {"type": "category", "data": ["Patrimonio netto"], "splitLine": {"show": False}},
        "series": [
            {
                "mark": "void" if bucket.residual else "segment",
                "name": bucket_label(bucket.name),
                "data": [float(bucket.value)],
                **(
                    {}
                    if bucket.residual
                    else {"itemStyle": {"color": f"token:--series-{(index % 5) + 1}"}}
                ),
                **(
                    {
                        "markLine": {
                            "silent": True,
                            "symbol": "none",
                            "lineStyle": {"color": "token:--ink-2", "width": 1},
                            "label": {
                                "formatter": format_money_it(view.net_worth),
                                "position": "end",
                                "color": "token:--ink-2",
                                "fontSize": 10,
                            },
                            "data": [{"xAxis": float(view.net_worth)}],
                        }
                    }
                    if index == 0
                    else {}
                ),
            }
            for index, bucket in enumerate(view.buckets)
        ],
    }


def bucket_label(name: str) -> str:
    """A Bucket's own name, or the registry's surface form for the residual (P26).

    The branch is explicit rather than a registry lookup with a fallback: a Bucket name is a
    user-authored proper noun (P28's register — opaque, never inflected), and routing it through
    `label()` would send it down the open-taxonomy fallback and transliterate it as if it were an
    `AssetClass` code. `UNASSIGNED` is the one name here that *is* a registry key.
    """
    return label_short(UNASSIGNED) if name == UNASSIGNED else name


def bucket_legend(view: AllocationView) -> list[dict[str, Any]]:
    return [
        {
            "label": bucket_label(bucket.name),
            "swatch": "void" if bucket.residual else str((index % 5) + 1),
            "value": format_money_it(bucket.value),
        }
        for index, bucket in enumerate(view.buckets)
    ]


def bucket_rows(view: AllocationView) -> list[list[str]]:
    return [
        [
            bucket_label(bucket.name),
            format_money_it(bucket.value),
            format_percent_it(bucket.weight),
        ]
        for bucket in view.buckets
    ]
