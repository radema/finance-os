"""Read-side query: `/allocation` — allocation, targets and Net Worth (UX-0001 §2 screen 3).

Only `financeos.web` may import this module (contract C4).

Three decisions here are worth reading before changing anything.

**No `price` join is inlined.** RFC-0009 §9 makes that a rule, not a preference: `price` is
bitemporal, every query against it has to choose between latest-known and as-known-then, and
getting it wrong is a silent wrong number. So prices arrive from
`DuckDBPriceRepository.price_latest` — one of the two named accessors, whose own docstring
cites that consequence — and the window function that resolves them exists in exactly one
place.
`bucket_apportionment`'s supersession is resolved the same way, through
`DuckDBApportionmentRepository.virtual_holdings`, for the same reason.

**An unpriced holding contributes nothing and is reported.** This mirrors
`portfolio_engine.compute_allocation`'s documented contract exactly: a held `Asset` with no
price is recorded rather than valued, which makes the breakdown *incomplete*. Dropping it
silently would understate Net Worth by an unknown amount and read as a complete answer, which
is the ADR-0016 failure at the presentation layer. The demo fixture exercises this: its CASH
position has no price row.

**Targets are read flat, and never computed.** UX-0001 §2 scopes screen 3 as "S (flat) → V1.0".
A leaf's effective target is the product of the weights along its path (ADR-0017, I-13), so for
a one-level tree the weight *is* the effective target and no arithmetic is needed. This module
therefore reads depth-1 leaves only and, for anything deeper, reports targets as unavailable
rather than reimplementing the Strategy Engine's path product on the read side. Under mixed
governance it reports `heterogeneous_strategies` and shows no targets at all: RFC-0007 §5 and
UX-0001 §5.1 both forbid averaging incommensurable strategies into one number.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import duckdb

from financeos.adapters.duckdb.repositories.apportionment import DuckDBApportionmentRepository
from financeos.adapters.duckdb.repositories.price import DuckDBPriceRepository
from financeos.core.shared import AssetId, BucketId
from financeos.core.shared.numbers import MONEY_PRECISION, MONEY_SCALE, quantize

#: The pseudo-row for capital assigned to no Bucket (ADR-0025, P26). Not a Bucket: it is the
#: residual, it stays in every denominator, and it may be negative — a negative residual is a
#: deficit, i.e. more capital apportioned than is actually held.
UNASSIGNED = "UNASSIGNED"

#: Why targets could not be shown, when they could not. Both values are `SkipReason`-shaped
#: strings that `CHROME_LABELS` already labels and glosses.
TARGETS_HETEROGENEOUS = "heterogeneous_strategies"
TARGETS_NESTED = "nested_targets"


@dataclass(frozen=True)
class TargetSpec:
    """One class's declared shape: its effective target weight and its effective band."""

    weight: Decimal
    band: Decimal | None
    tolerance_kind: str | None


@dataclass(frozen=True)
class ClassLine:
    """One `AssetClass` row of the allocation, with its declared shape where one exists."""

    asset_class: str
    value: Decimal
    weight: Decimal
    target: Decimal | None
    band: Decimal | None
    tolerance_kind: str | None

    @property
    def targeted(self) -> bool:
        """Whether the frozen strategy declared a target for this class.

        An untargeted class is not a zero-target one: it has no declared shape, and it stays in
        the denominator regardless (RFC-0007 §4.1, ADR-0029).
        """
        return self.target is not None

    @property
    def drift(self) -> Decimal | None:
        """`current weight − effective target`, or `None` where nothing was declared."""
        return None if self.target is None else self.weight - self.target

    @property
    def signed_severity(self) -> Decimal | None:
        """`drift / effective band` — dimensionless, so one rail reads across every class.

        `None` where there is no target, or where the band is zero: dividing by a zero band is
        the `zero_denominator` skip the domain declares rather than an infinite severity.
        """
        drift = self.drift
        if drift is None or self.band is None or self.band == 0:
            return None
        return drift / self.band


@dataclass(frozen=True)
class BucketLine:
    """One Bucket's value, or the `UNASSIGNED` residual, as a share of Net Worth."""

    id: str
    name: str
    value: Decimal
    weight: Decimal
    residual: bool


@dataclass(frozen=True)
class UnpricedHolding:
    """A held position that carries no price at `as_of`, and so contributes nothing."""

    asset_id: str
    asset_name: str
    asset_class: str
    quantity: Decimal


@dataclass(frozen=True)
class AllocationView:
    """Everything `/allocation` renders, flat, with its own completeness stated."""

    portfolio_id: str
    portfolio_name: str
    as_of: date
    currency: str
    net_worth: Decimal
    lines: tuple[ClassLine, ...]
    buckets: tuple[BucketLine, ...]
    unpriced: tuple[UnpricedHolding, ...]
    targets_unavailable: str | None

    @property
    def complete(self) -> bool:
        """Whether every held position could be valued.

        `False` means Net Worth is a lower bound, not a total, and the page must say so.
        """
        return not self.unpriced


def portfolio_allocation(
    con: duckdb.DuckDBPyConnection,
    portfolio_id: str,
    *,
    as_of: date,
    strategy_version_id: str,
    currency: str = "EUR",
) -> AllocationView | None:
    """Value one Portfolio's holdings at `as_of` and group them by `AssetClass` and by Bucket.

    Returns `None` when `portfolio_id` does not resolve. A Portfolio that holds nothing is not
    `None`: it is a legitimate zero, and the view renders it as one.

    `strategy_version_id` must be the frozen version the caller's `EvaluationRun` measured
    against (ADR-0012): what a run found is audited against what was declared *at that time*,
    not against whatever the Strategy has since been edited to say.
    """
    name_row = con.execute("SELECT name FROM portfolio WHERE id = ?", [portfolio_id]).fetchone()
    if name_row is None:
        return None

    holdings = con.execute(
        """
        SELECT h.asset_id, a.name, a.asset_class, h.quantity
        FROM mv_holding h
        JOIN asset a ON a.id = h.asset_id
        WHERE h.portfolio_id = ?
        ORDER BY a.asset_class, a.name
        """,
        [portfolio_id],
    ).fetchall()

    prices = DuckDBPriceRepository(con).price_latest(
        [AssetId(UUID(str(row[0]))) for row in holdings], as_of=as_of
    )

    values: dict[str, Decimal] = {}
    unpriced: list[UnpricedHolding] = []
    net_worth = Decimal(0)
    for asset_id, asset_name, asset_class, quantity in holdings:
        price = prices.get(AssetId(UUID(str(asset_id))))
        if price is None:
            unpriced.append(
                UnpricedHolding(
                    asset_id=str(asset_id),
                    asset_name=str(asset_name),
                    asset_class=str(asset_class),
                    quantity=quantity,
                )
            )
            continue
        value = _money(quantity * price.close)
        values[str(asset_class)] = values.get(str(asset_class), Decimal(0)) + value
        net_worth += value

    targets, targets_unavailable = _targets_for(con, portfolio_id, strategy_version_id)

    lines = tuple(
        _class_line(asset_class, value, net_worth, targets.get(asset_class))
        for asset_class, value in sorted(values.items())
    )

    return AllocationView(
        portfolio_id=portfolio_id,
        portfolio_name=str(name_row[0]),
        as_of=as_of,
        currency=currency,
        net_worth=net_worth,
        lines=lines,
        buckets=_buckets(con, portfolio_id, as_of=as_of, prices=prices, net_worth=net_worth),
        unpriced=tuple(unpriced),
        targets_unavailable=targets_unavailable,
    )


def _class_line(
    asset_class: str, value: Decimal, net_worth: Decimal, target: TargetSpec | None
) -> ClassLine:
    return ClassLine(
        asset_class=asset_class,
        value=value,
        weight=_share(value, net_worth),
        target=target.weight if target else None,
        band=target.band if target else None,
        tolerance_kind=target.tolerance_kind if target else None,
    )


def _money(value: Decimal) -> Decimal:
    """Quantize to the money scale the schema stores (DECIMAL(19,4), RFC-0009 §3)."""
    return quantize(value, precision=MONEY_PRECISION, scale=MONEY_SCALE)


def _share(value: Decimal, total: Decimal) -> Decimal:
    """`value / total`, or zero when the scope has no value — `_share`'s engine counterpart."""
    if total == 0:
        return Decimal(0)
    return value / total


def _buckets(
    con: duckdb.DuckDBPyConnection,
    portfolio_id: str,
    *,
    as_of: date,
    prices: Mapping[AssetId, Any],
    net_worth: Decimal,
) -> tuple[BucketLine, ...]:
    """Each Bucket's value at `as_of`, plus the `UNASSIGNED` residual (ADR-0025).

    The residual closes the reconciliation: Net Worth *is* its Buckets plus what is assigned to
    none of them. It is appended even at zero, because "nothing unassigned" is a fact the reader
    should be able to read rather than infer from an absence — and it may legitimately be
    negative, which is a deficit and not a bug.
    """
    rows = con.execute(
        "SELECT id, name FROM bucket WHERE portfolio_id = ? ORDER BY name", [portfolio_id]
    ).fetchall()

    apportionments = DuckDBApportionmentRepository(con)
    lines: list[BucketLine] = []
    assigned = Decimal(0)
    for bucket_id, bucket_name in rows:
        value = Decimal(0)
        for vh in apportionments.virtual_holdings(BucketId(UUID(str(bucket_id))), as_of=as_of):
            price = prices.get(vh.asset_id)
            if price is None:
                continue
            value += _money(vh.quantity.amount * price.close)
        assigned += value
        lines.append(
            BucketLine(
                id=str(bucket_id),
                name=str(bucket_name),
                value=value,
                weight=_share(value, net_worth),
                residual=False,
            )
        )

    residual = net_worth - assigned
    lines.append(
        BucketLine(
            id=UNASSIGNED,
            name=UNASSIGNED,
            value=residual,
            weight=_share(residual, net_worth),
            residual=True,
        )
    )
    return tuple(lines)


def _targets_for(
    con: duckdb.DuckDBPyConnection, portfolio_id: str, strategy_version_id: str
) -> tuple[dict[str, TargetSpec], str | None]:
    """The flat declared targets governing `portfolio_id`, or a reason there are none.

    One Strategy must govern every Bucket for a portfolio-level target comparison to mean
    anything. Where several do, this returns `TARGETS_HETEROGENEOUS` and no targets: RFC-0007 §5
    requires a skip, never an average, and averaging two incommensurable target trees would
    produce a number nobody declared.

    Reads `strategy_version_id` — the caller's frozen version, per ADR-0012 — never
    `strategy.current_version_id`: the targets shown here must be what the evaluation run
    actually measured against, not whatever the Strategy has since been re-frozen to say.
    """
    strategy_id_rows = con.execute(
        "SELECT DISTINCT strategy_id FROM bucket WHERE portfolio_id = ?", [portfolio_id]
    ).fetchall()

    if not strategy_id_rows:
        return {}, TARGETS_HETEROGENEOUS if _has_buckets(con, portfolio_id) else None
    if len(strategy_id_rows) > 1:
        return {}, TARGETS_HETEROGENEOUS

    version_row = con.execute(
        "SELECT definition FROM strategy_version WHERE id = ?", [strategy_version_id]
    ).fetchone()
    if version_row is None:  # pragma: no cover - the run's own FK guarantees the version exists
        return {}, TARGETS_HETEROGENEOUS

    definition: dict[str, Any] = json.loads(str(version_row[0]))
    children: Sequence[Mapping[str, Any]] = (definition.get("targets") or {}).get("children") or ()
    if any(child.get("children") for child in children):
        return {}, TARGETS_NESTED

    targets: dict[str, TargetSpec] = {}
    for child in children:
        key = str(child.get("key"))
        weight = (child.get("weight") or {}).get("value")
        if weight is None:
            continue
        target = Decimal(str(weight))
        tolerance = child.get("tolerance") or {}
        band = tolerance.get("band")
        kind = str(tolerance["kind"]) if tolerance.get("kind") else None
        targets[key] = TargetSpec(
            weight=target,
            band=None if band is None else _effective_band(Decimal(str(band)), kind, target),
            tolerance_kind=kind,
        )
    return targets, None


def _effective_band(band: Decimal, kind: str | None, target: Decimal) -> Decimal:
    """The band in weight terms: `ABSOLUTE` is already pp, `RELATIVE` is a share of the target.

    ADR-0018 fixes both readings, and the distinction is the reason `severity` is dimensionless:
    a 6.00pp breach on a 40% ABSOLUTE target and a 0.5pp breach on a 2% RELATIVE target become
    comparable only once the band is effective rather than declared.
    """
    return band * target if kind == "RELATIVE" else band


def _has_buckets(con: duckdb.DuckDBPyConnection, portfolio_id: str) -> bool:
    row = con.execute(
        "SELECT count(*) FROM bucket WHERE portfolio_id = ?", [portfolio_id]
    ).fetchone()
    return bool(row and int(row[0]) > 0)
