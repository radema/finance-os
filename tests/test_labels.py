"""The label registry's completeness guards (L05 §6.3).

Enums are imported here and nowhere in `core.shared.labels` itself (§2.3): tests sit outside
contract C3, so this is the one place the registry's closed keyspaces get checked against the
real enum members.

`RiskLevel` is deliberately excluded from every check here. The 5-member set in
`core.strategy.strategy.RiskLevel` is being replaced by a 7-member ordinal scale (product owner
ruling, W2-open) — labelling, or even completeness-checking, an enum about to be deleted is
rework its replacement would have to redo.
"""

from __future__ import annotations

import csv
import inspect
from enum import StrEnum
from pathlib import Path
from typing import Final

import pytest
import yaml  # type: ignore[import-untyped]

from financeos.core.engines.decision_engine import assemble_rationale
from financeos.core.engines.rule_engine import REGISTRY
from financeos.core.portfolio.operation import OperationType
from financeos.core.shared import (
    DOMAIN_LABELS,
    ArticleForm,
    LabelEntry,
    Outcome,
    Priority,
    RegistryError,
    Role,
    RunMode,
    ScopeKind,
    SkipReason,
    SuggestionClass,
    TermEntry,
    label,
)
from financeos.core.shared.labels import ARTICLE_TABLE
from financeos.core.strategy.targets import ToleranceKind
from financeos.web.labels import CHROME_LABELS

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Every closed enum the registry must cover completely. `RiskLevel` is excluded (see module
#: docstring).
CLOSED_ENUMS: Final = (
    Outcome,
    Priority,
    SkipReason,
    SuggestionClass,
    ToleranceKind,
    ScopeKind,
    RunMode,
    OperationType,
)

ALL_LABELS: Final = {**DOMAIN_LABELS, **CHROME_LABELS}


# --------------------------------------------------------------------------------------
# 1. Closed-enum completeness. No fallback path exists; no exemption list (§6.1, §6.3 test 1).
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("enum_cls", CLOSED_ENUMS, ids=lambda cls: cls.__name__)
def test_every_member_of_every_closed_enum_is_a_registered_key(enum_cls: type[StrEnum]) -> None:
    missing = [member.value for member in enum_cls if member.value not in ALL_LABELS]
    assert not missing, f"{enum_cls.__name__} member(s) with no label entry: {missing}"


# --------------------------------------------------------------------------------------
# 2. Keyspace disjointness (§6.3 test 2).
# --------------------------------------------------------------------------------------


def test_domain_and_chrome_labels_share_no_key() -> None:
    overlap = set(DOMAIN_LABELS) & set(CHROME_LABELS)
    assert not overlap


def test_no_noun_frame_key_collides_with_an_enum_value() -> None:
    enum_values = {member.value for enum_cls in CLOSED_ENUMS for member in enum_cls}
    noun_keys = {key for key in ALL_LABELS if key.startswith("noun.")}
    assert not (noun_keys & enum_values)


# --------------------------------------------------------------------------------------
# 3. Article-series consistency (§6.3 test 3).
# --------------------------------------------------------------------------------------

#: §3.2's table, transcribed independently of `ARTICLE_TABLE` so a transcription slip in the
#: production constant is caught rather than confirmed by comparing a table to itself.
_EXPECTED_ARTICLE_TABLE: Final = {
    ArticleForm.MS_IL: ("M", "SG", "il", "un", "del", "al", "dal", "nel", "sul"),
    ArticleForm.MS_LO: ("M", "SG", "lo", "uno", "dello", "allo", "dallo", "nello", "sullo"),
    ArticleForm.MS_ELIDED: (
        "M",
        "SG",
        "l’",
        "un",
        "dell’",
        "all’",
        "dall’",
        "nell’",
        "sull’",
    ),
    ArticleForm.MP_I: ("M", "PL", "i", None, "dei", "ai", "dai", "nei", "sui"),
    ArticleForm.MP_GLI: ("M", "PL", "gli", None, "degli", "agli", "dagli", "negli", "sugli"),
    ArticleForm.FS_LA: ("F", "SG", "la", "una", "della", "alla", "dalla", "nella", "sulla"),
    ArticleForm.FS_ELIDED: (
        "F",
        "SG",
        "l’",
        "un’",
        "dell’",
        "all’",
        "dall’",
        "nell’",
        "sull’",
    ),
    ArticleForm.FP_LE: ("F", "PL", "le", None, "delle", "alle", "dalle", "nelle", "sulle"),
}


@pytest.mark.parametrize("form", list(ArticleForm), ids=lambda f: f.value)
def test_the_article_table_matches_l05_section_3_2(form: ArticleForm) -> None:
    row = ARTICLE_TABLE[form]
    assert (
        row.gender.value,
        row.number.value,
        row.definite,
        row.indefinite,
        row.prep_di,
        row.prep_a,
        row.prep_da,
        row.prep_in,
        row.prep_su,
    ) == _EXPECTED_ARTICLE_TABLE[form]


@pytest.mark.parametrize("form", list(ArticleForm), ids=lambda f: f.value)
def test_elided_forms_join_without_a_space_others_with_one(form: ArticleForm) -> None:
    """L05 §3.4's join rule: a resolved prefix ending in U+2019 joins with no space."""
    row = ARTICLE_TABLE[form]
    is_elided = "ELIDED" in form.value
    for prefix in (row.definite, row.prep_di, row.prep_a, row.prep_da, row.prep_in, row.prep_su):
        assert prefix.endswith("’") is is_elided, f"{form}: {prefix!r}"


def test_no_ascii_apostrophe_anywhere_in_the_registry() -> None:
    for row in ARTICLE_TABLE.values():
        for value in row:
            if isinstance(value, str):
                assert "'" not in value, f"ASCII apostrophe in article table: {value!r}"
    for key, entry in ALL_LABELS.items():
        texts = [entry.short, entry.gloss]
        texts.append(entry.noun if isinstance(entry, LabelEntry) else entry.text)
        for text in texts:
            if text:
                assert "'" not in text, f"{key}: ASCII apostrophe in {text!r}"


# --------------------------------------------------------------------------------------
# 4. Fixture coverage (§6.3, guard 4): every AssetClass and ToleranceKind in demo/ is labelled.
# --------------------------------------------------------------------------------------


def test_every_demo_asset_class_has_a_domain_label() -> None:
    with (REPO_ROOT / "demo" / "assets.csv").open(newline="", encoding="utf-8") as handle:
        classes = {row["asset_class"] for row in csv.DictReader(handle)}
    assert classes, "the demo fixture should declare at least one asset"
    missing = classes - set(DOMAIN_LABELS)
    assert not missing, f"demo asset class(es) with no label: {missing}"


def test_every_demo_tolerance_kind_has_a_domain_label() -> None:
    strategy = yaml.safe_load((REPO_ROOT / "demo" / "strategy.yaml").read_text(encoding="utf-8"))
    kinds = {target["tolerance"]["kind"] for target in strategy["targets"]}
    assert kinds, "the demo fixture should declare at least one target"
    missing = kinds - set(DOMAIN_LABELS)
    assert not missing, f"demo tolerance kind(s) with no label: {missing}"


# --------------------------------------------------------------------------------------
# 5. Tier discipline (§6.3, guard 5): no CHROME_LABELS key in a registered explanation_template
#    or in assemble_rationale — the mechanical form of §2.1's freeze-boundary criterion.
# --------------------------------------------------------------------------------------


def test_no_chrome_label_key_appears_in_a_registered_explanation_template() -> None:
    for spec in REGISTRY.all_kinds():
        for key in CHROME_LABELS:
            assert key not in spec.explanation_template, (
                f"{spec.kind}: chrome-tier key {key!r} leaked into a core explanation_template"
            )


def test_no_chrome_label_key_appears_in_assemble_rationale() -> None:
    source = inspect.getsource(assemble_rationale)
    for key in CHROME_LABELS:
        assert key not in source, f"chrome-tier key {key!r} leaked into assemble_rationale"


# --------------------------------------------------------------------------------------
# Sanity: `label()` refuses an ungrammatical request rather than guessing (L05 §3.1).
# --------------------------------------------------------------------------------------


def test_label_raises_for_any_role_but_bare_against_a_term_entry() -> None:
    assert isinstance(CHROME_LABELS["FIRED"], TermEntry)
    with pytest.raises(RegistryError):
        label("FIRED", role=Role.THE, registry=ALL_LABELS)
