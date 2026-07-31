"""`DuckDBAssetRepository` — `asset` (definition, mutable in place; ADR-0012)."""

from __future__ import annotations

import json
from collections.abc import Collection, Mapping
from uuid import UUID

import duckdb

from financeos.core.portfolio import Asset, AssetIdentifier, IdentifierScheme
from financeos.core.shared import AssetId


class DuckDBAssetRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def add(self, asset: Asset) -> None:
        self._con.execute(
            "INSERT INTO asset (id, name, asset_class, currency, identifiers) "
            "VALUES (?, ?, ?, ?, ?)",
            [
                str(asset.id),
                asset.name,
                asset.asset_class,
                asset.currency,
                json.dumps(
                    [{"scheme": i.scheme.value, "value": i.value} for i in asset.identifiers]
                ),
            ],
        )

    def get(self, asset_id: AssetId) -> Asset:
        found = self.get_many([asset_id])
        if asset_id not in found:
            raise KeyError(f"no asset {asset_id}")
        return found[asset_id]

    def all(self) -> tuple[Asset, ...]:
        ids = self._con.execute("SELECT id FROM asset ORDER BY id").fetchall()
        found = self.get_many([AssetId(UUID(row[0])) for row in ids])
        return tuple(found[AssetId(UUID(row[0]))] for row in ids)

    def get_many(self, asset_ids: Collection[AssetId]) -> Mapping[AssetId, Asset]:
        if not asset_ids:
            return {}
        ids = [str(a) for a in asset_ids]
        placeholders = ",".join("?" for _ in ids)
        rows = self._con.execute(
            f"SELECT id, name, asset_class, currency, identifiers FROM asset "
            f"WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        result: dict[AssetId, Asset] = {}
        for row_id, name, asset_class, currency, identifiers in rows:
            parsed = json.loads(identifiers)
            asset_id = AssetId(UUID(row_id))
            result[asset_id] = Asset(
                id=asset_id,
                name=name,
                asset_class=asset_class,
                currency=currency,
                identifiers=tuple(
                    AssetIdentifier(scheme=IdentifierScheme(i["scheme"]), value=i["value"])
                    for i in parsed
                ),
            )
        return result
