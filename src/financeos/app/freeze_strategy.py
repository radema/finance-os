"""`freeze_strategy` — freeze a new `StrategyVersion` built by the web editor (screen 6, ADR-0027).

The counterpart of `import_strategy` for a caller that already holds a `StrategyDefinition`
rather than a parsed YAML file: the web Strategy editor assembles one from form fields, this
freezes it. Both funnel through `StrategyRepository.freeze_version`, which writes the new
`strategy_version` row and repoints `strategy.current_version_id` in one call — freeze and
pointer move are one transaction, per that repository's own contract.

`change_note` is required by `StrategyVersion`'s own field constraint (`min_length=1`); this
function adds no further validation of it; every other domain invariant (I-13 children sum to
one, ADR-0018 tolerance shape, I-4 at least one Rule) is enforced by constructing the real
`StrategyDefinition`/`TargetAllocation`/`Rule` models before this is ever called.
"""

from __future__ import annotations

from financeos.app.unit_of_work import UnitOfWork
from financeos.core.shared import StrategyId, StrategyVersionId
from financeos.core.strategy import StrategyDefinition, StrategyVersion
from financeos.ports import Clock, IdGen


def freeze_strategy(
    uow: UnitOfWork,
    id_gen: IdGen,
    clock: Clock,
    strategy_id: StrategyId,
    definition: StrategyDefinition,
    change_note: str,
) -> StrategyVersion:
    """Freeze `definition` as a new version of `strategy_id`, chained to its current version."""
    try:
        parent_version_id = uow.strategies.current_version(strategy_id).id
    except KeyError:
        parent_version_id = None

    version = StrategyVersion(
        id=StrategyVersionId(id_gen()),
        strategy_id=strategy_id,
        parent_version_id=parent_version_id,
        definition=definition,
        change_note=change_note,
        frozen_at=clock.now(),
    )
    uow.strategies.freeze_version(version)
    return version
