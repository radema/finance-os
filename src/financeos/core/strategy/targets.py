"""`TargetAllocation` — a tree of relative weights, plus `Tolerance` (ADR-0017, ADR-0018).

Each node's weight is relative to its parent, so restructuring a subtree is a local edit and
the exported YAML keeps a readable diff (ADR-0009). The effective target of a leaf is the
product of the weights along the root→leaf path.

**I-13 (revised, ERR-5):** the children of every node sum to 1 within an explicit `Decimal`
epsilon, enforced in the constructor. Effective leaf targets therefore sum to 1 by
construction, with no separate global check.

The walking skeleton authors a depth-1 tree, which is exactly a flat allocation and a strict
special case of this model — so nothing is retrofitted when hierarchy arrives.
"""

from collections.abc import Sequence
from decimal import Decimal
from enum import StrEnum
from typing import Final

from pydantic import model_validator

from financeos.core.shared import (
    AssetClass,
    DomainModel,
    Weight,
    WeightAmount,
    canonical_decimal,
)
from financeos.core.shared.errors import InvariantViolationError
from financeos.core.shared.numbers import WEIGHT_PRECISION, WEIGHT_SCALE, quantize

#: The epsilon I-13 is checked within: one unit at weight scale.
WEIGHT_SUM_EPSILON: Final = Decimal(1).scaleb(-WEIGHT_SCALE)


def _as_weight_amount(value: Decimal) -> Decimal:
    return quantize(value, precision=WEIGHT_PRECISION, scale=WEIGHT_SCALE)


class ToleranceKind(StrEnum):
    """How a tolerance band is read against a target (ADR-0018)."""

    ABSOLUTE = "ABSOLUTE"
    RELATIVE = "RELATIVE"


class Tolerance(DomainModel):
    """A permitted deviation from a target.

    `ABSOLUTE(band)` is ±band in percentage points of scope weight. `RELATIVE(band)` is
    ±(band × effective_target) — the proportional form, without which a ±5pp band on a 4%
    target would permit the position to vanish without registering a breach.
    """

    kind: ToleranceKind
    band: WeightAmount

    @model_validator(mode="after")
    def _band_is_positive(self) -> "Tolerance":
        if self.band <= 0:
            raise InvariantViolationError(f"tolerance band must be > 0; got {self.band}")
        return self

    def effective_band(self, effective_target: Decimal) -> Decimal:
        """The band this tolerance implies at `effective_target` (RFC-0007 §3.1).

        Returns:
            `band` for `ABSOLUTE`, `band × effective_target` for `RELATIVE`. A `RELATIVE`
            band on a zero target is legitimately zero, which is why `severity` is nullable.
        """
        if self.kind is ToleranceKind.ABSOLUTE:
            return self.band
        return _as_weight_amount(self.band * effective_target)

    def as_binding(self) -> dict[str, str]:
        """The tolerance's canonical trace-binding form (RFC-0009 §4.1)."""
        return {"kind": self.kind.value, "band": canonical_decimal(self.band)}


class TargetNode(DomainModel):
    """One node of the target tree: a key, a weight relative to its parent, and children.

    A leaf's `key` is the `AssetClass` it targets (I-14 — never an `AssetId`). A leaf must
    declare a `Tolerance`, because a target with no band cannot yield the `effective_band`
    every drift finding is measured against. An interior node may declare one; interior
    breaches are a distinct finding, reported by their own rule (RFC-0007 §2.1), and are not
    inherited by leaves.
    """

    key: AssetClass
    weight: Weight
    tolerance: Tolerance | None = None
    children: tuple["TargetNode", ...] = ()

    @property
    def is_leaf(self) -> bool:
        """Whether this node targets an `AssetClass` directly."""
        return not self.children

    @model_validator(mode="after")
    def _children_are_well_formed(self) -> "TargetNode":
        if self.is_leaf:
            if self.tolerance is None:
                raise InvariantViolationError(
                    f"leaf target {self.key} must declare a Tolerance (ADR-0018)"
                )
            return self
        _check_sum_to_one(self.children, context=self.key)
        _check_distinct_keys(self.children, context=self.key)
        return self


def _check_sum_to_one(children: Sequence[TargetNode], *, context: str) -> None:
    total = sum((child.weight.value for child in children), start=Decimal(0))
    if abs(total - Decimal(1)) > WEIGHT_SUM_EPSILON:
        raise InvariantViolationError(
            f"I-13: children of {context} must sum to 1 within {WEIGHT_SUM_EPSILON}; got {total}"
        )


def _check_distinct_keys(children: Sequence[TargetNode], *, context: str) -> None:
    keys = [child.key for child in children]
    if len(set(keys)) != len(keys):
        raise InvariantViolationError(f"children of {context} carry a duplicate key")


class LeafTarget(DomainModel):
    """A resolved leaf: its effective target, its tolerance, and the path that produced it."""

    asset_class: AssetClass
    path: tuple[str, ...]
    effective_target: WeightAmount
    tolerance: Tolerance

    @property
    def target_path(self) -> str:
        """The dotted path of this target inside the version document, for `SourceRef.path`."""
        return "targets." + ".".join(self.path)


class TargetAllocation(DomainModel):
    """The root of the target tree. Its own weight is 1 by definition, so it is not stored."""

    children: tuple[TargetNode, ...]

    @model_validator(mode="after")
    def _root_is_well_formed(self) -> "TargetAllocation":
        if not self.children:
            raise InvariantViolationError("a TargetAllocation must target at least one class")
        _check_sum_to_one(self.children, context="root")
        _check_distinct_keys(self.children, context="root")
        seen: set[str] = set()
        for leaf in self._walk(self.children, ()):
            if leaf.asset_class in seen:
                raise InvariantViolationError(
                    f"AssetClass {leaf.asset_class} is targeted by more than one leaf"
                )
            seen.add(leaf.asset_class)
        return self

    def leaves(self) -> dict[AssetClass, LeafTarget]:
        """Resolve every leaf to its effective target (product of weights along its path).

        Returns:
            A mapping from `AssetClass` to its resolved `LeafTarget`, in tree order.
        """
        return {leaf.asset_class: leaf for leaf in self._walk(self.children, ())}

    @classmethod
    def _walk(
        cls, nodes: Sequence[TargetNode], path: tuple[str, ...], factor: Decimal = Decimal(1)
    ) -> list[LeafTarget]:
        resolved: list[LeafTarget] = []
        for node in nodes:
            here = (*path, node.key)
            weight = factor * node.weight.value
            if node.is_leaf:
                if node.tolerance is None:  # pragma: no cover - guaranteed by TargetNode
                    raise InvariantViolationError(f"leaf target {node.key} has no Tolerance")
                resolved.append(
                    LeafTarget(
                        asset_class=node.key,
                        path=here,
                        effective_target=_as_weight_amount(weight),
                        tolerance=node.tolerance,
                    )
                )
            else:
                resolved.extend(cls._walk(node.children, here, weight))
        return resolved
