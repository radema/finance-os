"""I-12 as a build failure (RFC-0008 §9).

A prescriptive `Recommendation` must be *unrepresentable*, not merely discouraged. This test
is the only mechanism that stops a well-meaning future commit from adding a convenient
`suggested_instrument` or `quantity` field, and it converts the philosophical commitment —
and the MiFID suitability firewall of ADR-0010 — into a failing build.

It also asserts I-17: a `Recommendation` cannot reference a `Decision`, which is what keeps
the dependency graph of RFC-0004 §4 acyclic.
"""

import re
from typing import Any, get_args, get_origin

from pydantic import BaseModel

from financeos.core.decision import Recommendation
from financeos.core.portfolio import Asset, AssetIdentifier, Operation, OperationType
from financeos.core.shared import AssetId, Quantity

#: Field names that would make a finding prescriptive, or point at an instrument.
FORBIDDEN_NAME = re.compile(
    r"instrument|isin|ticker|symbol|security|action|direction|side|order|trade"
    r"|quantity|amount|units|shares|price|buy|sell|decision",
    re.IGNORECASE,
)

#: Types that could only appear in order to name an instrument or size a trade.
FORBIDDEN_TYPES: tuple[Any, ...] = (
    AssetId,
    Asset,
    AssetIdentifier,
    Quantity,
    Operation,
    OperationType,
)


def _annotations(model: type[BaseModel]) -> list[tuple[str, Any]]:
    """Every (field path, annotation) pair in a model tree, recursively."""
    found: list[tuple[str, Any]] = []
    for name, field in model.model_fields.items():
        annotation = field.annotation
        found.append((name, annotation))
        for nested in (annotation, *get_args(annotation)):
            if isinstance(nested, type) and issubclass(nested, BaseModel):
                found.extend((f"{name}.{path}", inner) for path, inner in _annotations(nested))
    return found


def _flatten(annotation: Any) -> list[Any]:
    """An annotation and every type argument nested inside it."""
    args = get_args(annotation)
    if not args:
        return [annotation]
    flattened: list[Any] = [get_origin(annotation) or annotation]
    for arg in args:
        flattened.extend(_flatten(arg))
    return flattened


def test_recommendation_has_no_prescriptive_field_name() -> None:
    offending = [path for path, _ in _annotations(Recommendation) if FORBIDDEN_NAME.search(path)]
    assert offending == [], (
        f"I-12: Recommendation must expose no prescriptive field; found {offending}"
    )


def test_recommendation_references_no_instrument_type() -> None:
    offending = [
        (path, annotation)
        for path, annotation in _annotations(Recommendation)
        for candidate in _flatten(annotation)
        if candidate in FORBIDDEN_TYPES
    ]
    assert offending == [], f"I-12: Recommendation must name no instrument; found {offending}"


def test_recommendation_carries_only_the_three_expression_layers() -> None:
    """`observation` + `rationale` + `suggestion_class`, and nothing that could prescribe."""
    assert set(Recommendation.model_fields) == {
        "id",
        "alert_id",
        "provenance",
        "finding_key",
        "observation",
        "rationale",
        "suggestion_class",
        "recorded_at",
    }
