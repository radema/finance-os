"""Read-side query: the drift-over-time series derived from `Snapshot` (RFC-0009 §5.1/§6,
RFC-0010:130).

Only `financeos.web` may import this module (contract C4).

RFC-0009 §6: historical series render **as-recorded**, never recomputed under today's taxonomy
or today's Strategy. Each point therefore reads the `Snapshot`'s own stored weight for one
`AssetClass` against the target its own governing `StrategyVersion` (pinned by its `run_id`)
declared at that time — not against whatever the Strategy has since been re-frozen to say.
Restricted to `ACTUAL` runs (RFC-0009 requires the predicate in every read-side query).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import duckdb


@dataclass(frozen=True)
class DriftPoint:
    """One as-recorded `(weight, target, drift)` reading for one `AssetClass`.

    `weight` is `None` when the class was not held at that `Snapshot`; `target` is `None`
    when that run's governing `StrategyVersion` declared no target for it, or declared a
    nested tree this flat reading cannot resolve (mirrors `allocation.py`'s own limit).
    `drift` is `None` whenever either operand is.
    """

    as_of: date
    weight: Decimal | None
    target: Decimal | None
    drift: Decimal | None


def drift_history(
    con: duckdb.DuckDBPyConnection, portfolio_id: str, asset_class: str
) -> tuple[DriftPoint, ...]:
    """The as-recorded weight/target/drift series for one `AssetClass`, oldest first.

    A `Snapshot` with no `run_id` (an on-demand checkpoint, not one written by `evaluate`) has
    no governing `StrategyVersion` to compare against and is excluded, along with any
    `HYPOTHETICAL` run.

    One point per `as_of` (ADR-L06 §5.3): `evaluate_strategy` writes a Portfolio-wide Snapshot
    on **every** call, so an N-Bucket Portfolio's `financeos evaluate` (one call per Bucket,
    ADR-0020, plus one Portfolio-scope call, RFC-0007 §5) writes N+1 Snapshots at the same
    `as_of`. This was already true before the Portfolio-scope call existed — an N-Bucket
    Portfolio already wrote N identical Snapshots per `as_of` — a pre-existing read-side defect
    that a single-Bucket demo never exercised. Collapsed here to the row with the latest
    `recorded_at` per `(portfolio_id, as_of)`, deterministically tie-broken on `id`.
    """
    rows = con.execute(
        """
        SELECT as_of, allocation, definition
        FROM (
            SELECT snap.as_of, snap.allocation, sv.definition,
                   row_number() OVER (
                       PARTITION BY snap.as_of
                       ORDER BY snap.recorded_at DESC, snap.id DESC
                   ) AS rn
            FROM snapshot snap
            JOIN evaluation_run run  ON run.id = snap.run_id
            JOIN strategy_version sv ON sv.id  = run.strategy_version_id
            WHERE snap.portfolio_id = ? AND run.mode = 'ACTUAL'
        )
        WHERE rn = 1
        ORDER BY as_of ASC
        """,
        [portfolio_id],
    ).fetchall()

    points: list[DriftPoint] = []
    for as_of, allocation_json, definition_json in rows:
        allocation: dict[str, Any] = json.loads(str(allocation_json))
        line = allocation.get(asset_class)
        weight = Decimal(str(line["weight"])) if line else None
        target = _target_weight(json.loads(str(definition_json)), asset_class)
        drift = weight - target if weight is not None and target is not None else None
        points.append(DriftPoint(as_of=as_of, weight=weight, target=target, drift=drift))
    return tuple(points)


def _target_weight(definition: dict[str, Any], asset_class: str) -> Decimal | None:
    """The flat effective target `asset_class` was declared at, or `None`.

    Mirrors `allocation.py`'s `_targets_for`: a nested target tree cannot be resolved here
    without re-implementing the Strategy Engine's path product on the read side, so it
    reports no target rather than a wrong one.
    """
    children = (definition.get("targets") or {}).get("children") or ()
    if any(child.get("children") for child in children):
        return None
    for child in children:
        if child.get("key") == asset_class:
            weight = (child.get("weight") or {}).get("value")
            return Decimal(str(weight)) if weight is not None else None
    return None
