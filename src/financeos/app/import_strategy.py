"""`import_strategy` — freeze a new `StrategyVersion` from a parsed YAML file (ADR-0027).

Creates the `Strategy` row on first import; every subsequent import versions the same
`Strategy`, chaining `parent_version_id` so the author's history is walkable.
"""

from __future__ import annotations

from financeos.adapters.importers.yaml_strategy import StrategyImport
from financeos.app.unit_of_work import UnitOfWork
from financeos.core.shared import StrategyVersionId
from financeos.core.strategy import StrategyVersion
from financeos.ports import Clock, IdGen


def import_strategy(
    uow: UnitOfWork, id_gen: IdGen, clock: Clock, imported: StrategyImport
) -> StrategyVersion:
    """Freeze `imported.definition` as a new `StrategyVersion` and return it."""
    uow.strategies.ensure_strategy(
        imported.strategy_id,
        name=imported.definition.name,
        description=imported.definition.description,
    )
    try:
        parent_version_id = uow.strategies.current_version(imported.strategy_id).id
    except KeyError:
        parent_version_id = None

    version = StrategyVersion(
        id=StrategyVersionId(id_gen()),
        strategy_id=imported.strategy_id,
        parent_version_id=parent_version_id,
        definition=imported.definition,
        change_note=imported.change_note,
        frozen_at=clock.now(),
    )
    uow.strategies.freeze_version(version)
    return version
