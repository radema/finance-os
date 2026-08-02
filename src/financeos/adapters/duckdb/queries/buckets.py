"""Read-side query: `/buckets` — Bucket composition and apportionment (screen 4).

Only `financeos.web` may import this module (contract C4).

Reuses the same price-resolution and money-rounding discipline as `queries/allocation.py`:
`price` is bitemporal and every read against it goes through `DuckDBPriceRepository.price_latest`
rather than an inline join (RFC-0009 §9), and an unpriced holding contributes nothing and is
reported rather than dropped (ADR-0016 at the presentation layer).

**Over-apportionment warns, never blocks (I-9, ADR-0025).** `bucket_apportionment` carries no
write-time `Σ apportioned <= Holding` check; `over_apportioned` is an evaluation-time finding.
This module reads the same comparison read-side, across every Bucket an asset is apportioned to,
so the warning is visible on the screen that lets a reader change it — but nothing here rejects
a write or hides a row.

**The `UNASSIGNED` residual is signed and stays in the reconciliation (ADR-0025).** It is
Net Worth minus every Bucket's value, and a negative residual is a legitimate deficit: more
capital apportioned than is actually held.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

import duckdb

from financeos.adapters.duckdb.repositories.apportionment import DuckDBApportionmentRepository
from financeos.adapters.duckdb.repositories.price import DuckDBPriceRepository
from financeos.core.shared import AssetId, BucketId
from financeos.core.shared.numbers import MONEY_PRECISION, MONEY_SCALE, quantize


@dataclass(frozen=True)
class ApportionmentLine:
    """One asset's apportioned quantity inside one Bucket."""

    asset_id: str
    asset_name: str
    asset_class: str
    quantity: Decimal
    value: Decimal | None  # None: unpriced at as_of, contributes nothing (ADR-0016)


@dataclass(frozen=True)
class BucketComposition:
    """One Bucket: its Strategy, its apportioned lines, and its value as a share of Net Worth."""

    id: str
    name: str
    strategy_id: str
    strategy_name: str
    lines: tuple[ApportionmentLine, ...]
    value: Decimal
    weight: Decimal


@dataclass(frozen=True)
class OverApportionedLine:
    """One asset apportioned, across every Bucket, beyond what is actually held (I-9)."""

    asset_id: str
    asset_name: str
    apportioned: Decimal
    held: Decimal
    excess: Decimal


@dataclass(frozen=True)
class BucketsView:
    """Everything `/buckets` renders: composition, apportionment, and the signed residual."""

    portfolio_id: str
    portfolio_name: str
    as_of: date
    net_worth: Decimal
    buckets: tuple[BucketComposition, ...]
    unassigned_value: Decimal
    unassigned_weight: Decimal
    over_apportioned: tuple[OverApportionedLine, ...]


def _money(value: Decimal) -> Decimal:
    return quantize(value, precision=MONEY_PRECISION, scale=MONEY_SCALE)


def _share(value: Decimal, total: Decimal) -> Decimal:
    return Decimal(0) if total == 0 else value / total


def buckets_view(
    con: duckdb.DuckDBPyConnection, portfolio_id: str, *, as_of: date
) -> BucketsView | None:
    """Every Bucket of `portfolio_id`, its composition at `as_of`, and the signed residual.

    Returns `None` when `portfolio_id` does not resolve. A portfolio with no Buckets is not
    `None`: it is a legitimate state and renders as one, with the whole of Net Worth reported as
    `UNASSIGNED`.
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
        """,
        [portfolio_id],
    ).fetchall()
    held_qty: dict[str, Decimal] = {str(row[0]): row[3] for row in holdings}
    asset_names: dict[str, str] = {str(row[0]): str(row[1]) for row in holdings}

    prices = DuckDBPriceRepository(con).price_latest(
        [AssetId(UUID(str(row[0]))) for row in holdings], as_of=as_of
    )

    net_worth = Decimal(0)
    for asset_id, _name, _class, quantity in holdings:
        price = prices.get(AssetId(UUID(str(asset_id))))
        if price is not None:
            net_worth += _money(quantity * price.close)

    bucket_rows = con.execute(
        """
        SELECT b.id, b.name, b.strategy_id, s.name
        FROM bucket b
        JOIN strategy s ON s.id = b.strategy_id
        WHERE b.portfolio_id = ?
        ORDER BY b.name
        """,
        [portfolio_id],
    ).fetchall()

    apportionments = DuckDBApportionmentRepository(con)
    total_apportioned: dict[str, Decimal] = {}
    buckets: list[BucketComposition] = []
    assigned = Decimal(0)

    for bucket_id, bucket_name, strategy_id, strategy_name in bucket_rows:
        lines: list[ApportionmentLine] = []
        value = Decimal(0)
        for vh in apportionments.virtual_holdings(BucketId(UUID(str(bucket_id))), as_of=as_of):
            asset_id = str(vh.asset_id)
            total_apportioned[asset_id] = total_apportioned.get(asset_id, Decimal(0)) + (
                vh.quantity.amount
            )
            price = prices.get(vh.asset_id)
            line_value = None if price is None else _money(vh.quantity.amount * price.close)
            if line_value is not None:
                value += line_value
            lines.append(
                ApportionmentLine(
                    asset_id=asset_id,
                    asset_name=asset_names.get(asset_id, asset_id),
                    asset_class=_asset_class_of(con, asset_id),
                    quantity=vh.quantity.amount,
                    value=line_value,
                )
            )
        assigned += value
        buckets.append(
            BucketComposition(
                id=str(bucket_id),
                name=str(bucket_name),
                strategy_id=str(strategy_id),
                strategy_name=str(strategy_name),
                lines=tuple(lines),
                value=value,
                weight=_share(value, net_worth),
            )
        )

    residual = net_worth - assigned

    over_apportioned = tuple(
        OverApportionedLine(
            asset_id=asset_id,
            asset_name=asset_names.get(asset_id, asset_id),
            apportioned=apportioned_qty,
            held=held_qty.get(asset_id, Decimal(0)),
            excess=apportioned_qty - held_qty.get(asset_id, Decimal(0)),
        )
        for asset_id, apportioned_qty in sorted(total_apportioned.items())
        if apportioned_qty > held_qty.get(asset_id, Decimal(0))
    )

    return BucketsView(
        portfolio_id=portfolio_id,
        portfolio_name=str(name_row[0]),
        as_of=as_of,
        net_worth=net_worth,
        buckets=tuple(buckets),
        unassigned_value=residual,
        unassigned_weight=_share(residual, net_worth),
        over_apportioned=over_apportioned,
    )


def _asset_class_of(con: duckdb.DuckDBPyConnection, asset_id: str) -> str:
    """A single asset's class, for a virtual holding not already in the holdings join.

    Apportionment can legitimately exceed the held quantity (I-9), but the asset row itself
    always exists (the apportionment repository's own FK guarantees it), so this never falls
    through to the identifier fallback in practice.
    """
    row = con.execute("SELECT asset_class FROM asset WHERE id = ?", [asset_id]).fetchone()
    return str(row[0]) if row is not None else asset_id
