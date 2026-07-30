"""The Italian label registry, with grammatical agreement (L05).

Closes the gap `asset_class_label` (`core/shared/ids.py`) always was: a mechanical
transliteration of a taxonomy key, never a real Italian noun phrase. This module is the
"real label table" that function's own docstring called a later concern.

Two grammatical situations, two entry kinds (L05 §3.1):

* `LabelEntry` — a nominal that composes with an article and a preposition ("le Azioni",
  "delle Azioni dei paesi sviluppati"). `form` is one of eight `ArticleForm` values, each row
  of `ARTICLE_TABLE` fixing gender, number and every contracted preposition together, so an
  entry cannot declare a gender its own articles disagree with.
* `TermEntry` — atomic text that never takes an article ("Non valutata"). `label()` raises for
  any role but `BARE` against one.

`label()`, `copula()` and `agree()` are the composition machinery (§4). The registry keys on
plain `str` and imports no enum (C3): every enum involved is already a `StrEnum`, so a member
indexes a `str`-keyed mapping directly, and the registry itself has zero import edges into any
bounded context. Enums are imported only by the completeness test (`tests/test_labels.py`),
which is outside the contracts.

`DOMAIN_LABELS` holds exactly the core-tier entries (§5.2, §5.3): the open `AssetClass`
taxonomy, the two `ToleranceKind` values, and the one frame noun (`noun.asset_class`) the
`AssetClass` fallback (§6.2) composes with. Everything else — closed chrome enums, frame nouns
for web-only concepts — lives in `financeos.web.labels.CHROME_LABELS`, which imports these
entries rather than restating them (§2.4).

`AssetClass` is open (RFC-0033 / E12): a build-time completeness test over it is impossible, so
`label()` degrades gracefully on a key not in its registry, per §6.2 — the *role* degrades, not
the grammar, so the output stays legal Italian for every possible key. The frame noun that makes
this true, `noun.asset_class` ("classe", `FS_LA`), is why the fallback needs no additional
data: every closed enum this document knows of is registered directly by `DOMAIN_LABELS` or
`CHROME_LABELS`, which the completeness test (§6.3 test 1) makes a build failure to violate —
so in a shipped build, `label()`'s missing-key path is only ever reached by an unlabelled
`AssetClass` code.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Final, NamedTuple

from pydantic import model_validator

from financeos.core.shared.base import DomainModel
from financeos.core.shared.errors import InvariantViolationError, RegistryError
from financeos.core.shared.ids import asset_class_label

#: The elision mark used throughout the registry (L05 §3.4). Never an ASCII apostrophe.
_ELISION: Final = "’"


class Gender(StrEnum):
    """Grammatical gender, derived from an entry's `ArticleForm` — never declared directly."""

    M = "M"
    F = "F"


class GrammaticalNumber(StrEnum):
    """Grammatical number, derived from an entry's `ArticleForm` — never declared directly."""

    SG = "SG"
    PL = "PL"


class ArticleForm(StrEnum):
    """One of the eight gender/number/elision combinations Italian articles take (L05 §3.2).

    Every article, preposition contraction and elision behaviour an entry can need is fixed by
    picking one member here; `ARTICLE_TABLE` carries the eight rows this closes over, so gender
    and number cannot be declared inconsistently with the articles that accompany them.
    """

    MS_IL = "MS_IL"
    MS_LO = "MS_LO"
    MS_ELIDED = "MS_ELIDED"
    MP_I = "MP_I"
    MP_GLI = "MP_GLI"
    FS_LA = "FS_LA"
    FS_ELIDED = "FS_ELIDED"
    FP_LE = "FP_LE"


class _ArticleRow(NamedTuple):
    """One row of §3.2's table: gender, number, the two articles, and the five obligatory
    preposition contractions (`di`, `a`, `da`, `in`, `su` — the whole closed set, L05 §3.3).

    `indefinite` is `None` for every plural form: Italian has no plural indefinite article
    (`Role.A` raises rather than inventing one).
    """

    gender: Gender
    number: GrammaticalNumber
    definite: str
    indefinite: str | None
    prep_di: str
    prep_a: str
    prep_da: str
    prep_in: str
    prep_su: str


#: The eight rows of L05 §3.2, verbatim. The one and only source of every article, every
#: contraction and every elision behaviour in the registry.
ARTICLE_TABLE: Final[Mapping[ArticleForm, _ArticleRow]] = {
    ArticleForm.MS_IL: _ArticleRow(
        Gender.M, GrammaticalNumber.SG, "il", "un", "del", "al", "dal", "nel", "sul"
    ),
    ArticleForm.MS_LO: _ArticleRow(
        Gender.M, GrammaticalNumber.SG, "lo", "uno", "dello", "allo", "dallo", "nello", "sullo"
    ),
    ArticleForm.MS_ELIDED: _ArticleRow(
        Gender.M,
        GrammaticalNumber.SG,
        f"l{_ELISION}",
        "un",
        f"dell{_ELISION}",
        f"all{_ELISION}",
        f"dall{_ELISION}",
        f"nell{_ELISION}",
        f"sull{_ELISION}",
    ),
    ArticleForm.MP_I: _ArticleRow(
        Gender.M, GrammaticalNumber.PL, "i", None, "dei", "ai", "dai", "nei", "sui"
    ),
    ArticleForm.MP_GLI: _ArticleRow(
        Gender.M, GrammaticalNumber.PL, "gli", None, "degli", "agli", "dagli", "negli", "sugli"
    ),
    ArticleForm.FS_LA: _ArticleRow(
        Gender.F, GrammaticalNumber.SG, "la", "una", "della", "alla", "dalla", "nella", "sulla"
    ),
    ArticleForm.FS_ELIDED: _ArticleRow(
        Gender.F,
        GrammaticalNumber.SG,
        f"l{_ELISION}",
        f"un{_ELISION}",
        f"dell{_ELISION}",
        f"all{_ELISION}",
        f"dall{_ELISION}",
        f"nell{_ELISION}",
        f"sull{_ELISION}",
    ),
    ArticleForm.FP_LE: _ArticleRow(
        Gender.F, GrammaticalNumber.PL, "le", None, "delle", "alle", "dalle", "nelle", "sulle"
    ),
}


def _reject_ascii_apostrophe(*values: str | None) -> None:
    for value in values:
        if value and "'" in value:
            raise InvariantViolationError(
                f"{value!r}: use U+2019 ({_ELISION}), never an ASCII apostrophe (L05 §3.4)"
            )


class LabelEntry(DomainModel):
    """A nominal label: composes with an article and a preposition (L05 §3.1).

    `noun` is the bare noun phrase, capitalised on its head per §5.1's convention and never
    carrying its own article. `gender` and `number` are *derived* from `form`, never declared —
    the property that makes an inconsistent entry unrepresentable.
    """

    noun: str
    form: ArticleForm
    short: str | None = None
    gloss: str | None = None

    @model_validator(mode="after")
    def _no_ascii_apostrophe(self) -> LabelEntry:
        _reject_ascii_apostrophe(self.noun, self.short, self.gloss)
        return self

    @property
    def gender(self) -> Gender:
        """Derived from `form` — carried, never independently declared (L05 §3.2)."""
        return ARTICLE_TABLE[self.form].gender

    @property
    def number(self) -> GrammaticalNumber:
        """Derived from `form` — carried, never independently declared (L05 §3.2)."""
        return ARTICLE_TABLE[self.form].number


class TermEntry(DomainModel):
    """Atomic text: never takes an article, a preposition, or a verb (L05 §3.1).

    `label(key, role=…)` raises for any role but `BARE` against one of these — the registry
    refusing an ungrammatical request is most of its value (L05 §3.1).
    """

    text: str
    short: str | None = None
    gloss: str | None = None

    @model_validator(mode="after")
    def _no_ascii_apostrophe(self) -> TermEntry:
        _reject_ascii_apostrophe(self.text, self.short, self.gloss)
        return self


class Role(StrEnum):
    """The grammatical role a template asks `label()` to render (L05 §4.1)."""

    BARE = "bare"
    THE = "the"
    A = "a"
    OF = "of"
    TO = "to"
    FROM = "from"
    IN = "in"
    ON = "on"


#: One frame noun lives in the core tier because §6.2's `AssetClass` fallback requires it
#: (L05 §5.3): every role degrades to a grammatical sentence built around "la classe «…»".
_ASSET_CLASS_FRAME_KEY: Final = "noun.asset_class"

#: Core-tier entries (L05 §5.2, §5.3): the `AssetClass` taxonomy the skeleton fixture ships —
#: six classes, not five (D-L05-1: `EQUITY_GLOBAL` is the untargeted sixth) — the two
#: `ToleranceKind` values, and the one frame noun the open-taxonomy fallback composes with.
DOMAIN_LABELS: Final[Mapping[str, LabelEntry]] = {
    "EQUITY": LabelEntry(noun="Azioni", form=ArticleForm.FP_LE, short="Azioni"),
    "EQUITY_DEVELOPED": LabelEntry(
        noun="Azioni dei paesi sviluppati", form=ArticleForm.FP_LE, short="Sviluppati"
    ),
    "EQUITY_GLOBAL": LabelEntry(
        noun="Azioni globali", form=ArticleForm.FP_LE, short="Globali"
    ),
    "EQUITY_EMERGING": LabelEntry(
        noun="Azioni dei paesi emergenti", form=ArticleForm.FP_LE, short="Emergenti"
    ),
    "BONDS": LabelEntry(noun="Obbligazioni", form=ArticleForm.FP_LE, short="Obbligazioni"),
    "BOND_GOV_EUR": LabelEntry(
        noun="Obbligazioni governative in euro", form=ArticleForm.FP_LE, short="Gov. euro"
    ),
    "BOND_CORP_IG": LabelEntry(
        noun="Obbligazioni societarie investment grade",
        form=ArticleForm.FP_LE,
        short="Societarie IG",
    ),
    "CASH": LabelEntry(noun="Liquidità", form=ArticleForm.FS_LA, short="Liquidità"),
    "UNASSIGNED": LabelEntry(
        noun="Capitale non assegnato",
        form=ArticleForm.MS_IL,
        short="Non assegnato",
        gloss=(
            f"Capitale che non è stato assegnato ad alcun Bucket. Non è un Bucket: è il "
            f"residuo, resta nel denominatore di ogni peso, e può essere negativo {_ELISION} "
            f"un residuo negativo è un disavanzo, cioè capitale assegnato in eccesso rispetto "
            f"a quanto è effettivamente detenuto."
        ),
    ),
    "ABSOLUTE": LabelEntry(
        noun="tolleranza assoluta",
        form=ArticleForm.FS_LA,
        short="assoluta",
        gloss=(
            "Punti percentuali: la banda è ±X pp attorno al target, indipendentemente da "
            "quanto il target sia grande."
        ),
    ),
    "RELATIVE": LabelEntry(
        noun="tolleranza relativa",
        form=ArticleForm.FS_LA,
        short="relativa",
        gloss=(
            "Proporzione del target: la banda è una frazione del target, quindi si restringe "
            "sui target piccoli e si allarga su quelli grandi."
        ),
    ),
    _ASSET_CLASS_FRAME_KEY: LabelEntry(noun="classe", form=ArticleForm.FS_LA, short="Classe"),
}

#: Column of `ARTICLE_TABLE` each `Role` reads, other than `BARE` (handled separately).
_PREFIX_COLUMN: Final[Mapping[Role, str]] = {
    Role.THE: "definite",
    Role.A: "indefinite",
    Role.OF: "prep_di",
    Role.TO: "prep_a",
    Role.FROM: "prep_da",
    Role.IN: "prep_in",
    Role.ON: "prep_su",
}


def _apply_sentence_initial(text: str, sentence_initial: bool) -> str:
    """Uppercase the first character only (L05 §4.1 note 1) — never `str.capitalize()`,
    which would lowercase "le Azioni" into "Le azioni"."""
    if not sentence_initial or not text:
        return text
    return text[0].upper() + text[1:]


def _join(prefix: str, noun: str) -> str:
    """The elision join rule (L05 §3.4): no space after `’`, one space otherwise."""
    return f"{prefix}{noun}" if prefix.endswith(_ELISION) else f"{prefix} {noun}"


def _prefix_for(role: Role, row: _ArticleRow) -> str | None:
    if role is Role.BARE:
        return ""
    column = _PREFIX_COLUMN[role]
    prefix: str | None = getattr(row, column)
    return prefix


def _compose(noun: str, form: ArticleForm, *, role: Role, sentence_initial: bool) -> str:
    if role is Role.BARE:
        return _apply_sentence_initial(noun, sentence_initial)
    row = ARTICLE_TABLE[form]
    prefix = _prefix_for(role, row)
    if prefix is None:
        raise RegistryError(
            f"{form}: Italian has no plural indefinite article (role={role.value})"
        )
    return _apply_sentence_initial(_join(prefix, noun), sentence_initial)


def _fallback(key: str, *, role: Role, sentence_initial: bool) -> str:
    """`AssetClass` is open (§6.2): degrade the *role*, never the grammar.

    Renders the mechanical `asset_class_label` for `BARE`, unchanged from today's behaviour;
    every other role wraps it in the `noun.asset_class` frame ("la classe «…»"), which is
    grammatical for every possible key because the frame noun, not the unlabelled key, carries
    the agreement.
    """
    mechanical = asset_class_label(key)
    if role is Role.BARE:
        return _apply_sentence_initial(mechanical, sentence_initial)
    frame = DOMAIN_LABELS[_ASSET_CLASS_FRAME_KEY]
    row = ARTICLE_TABLE[frame.form]
    prefix = _prefix_for(role, row)
    if prefix is None:
        raise RegistryError(
            f"{frame.form}: Italian has no plural indefinite article (role={role.value})"
        )
    phrase = _join(prefix, frame.noun)
    return _apply_sentence_initial(f"{phrase} «{mechanical}»", sentence_initial)


def label(
    key: str,
    *,
    role: Role = Role.BARE,
    sentence_initial: bool = False,
    registry: Mapping[str, LabelEntry | TermEntry] = DOMAIN_LABELS,
) -> str:
    """Render `key` in the requested grammatical `role` (L05 §4.1).

    Args:
        key: A registry key — an `AssetClass` code, a `ToleranceKind` value, or (from the web
            tier) a closed chrome enum's member.
        role: The grammatical role the surrounding template needs.
        sentence_initial: Uppercase the first character only (never `str.capitalize()`).
        registry: Looked up before falling back to the mechanical `AssetClass` rendering.
            Defaults to the core-tier `DOMAIN_LABELS`; the web tier passes its own merged
            mapping of `DOMAIN_LABELS` and `CHROME_LABELS`.

    Raises:
        RegistryError: `role` is not `BARE` against a `TermEntry` (L05 §3.1), or `role` is `A`
            against a plural entry, for which Italian has no indefinite article (L05 §4.1).
    """
    entry = registry.get(key)
    if entry is None:
        return _fallback(key, role=role, sentence_initial=sentence_initial)
    if isinstance(entry, TermEntry):
        if role is not Role.BARE:
            raise RegistryError(
                f"{key}: a TermEntry never takes an article or a preposition (role={role.value})"
            )
        return _apply_sentence_initial(entry.text, sentence_initial)
    return _compose(entry.noun, entry.form, role=role, sentence_initial=sentence_initial)


def copula(
    key: str, *, registry: Mapping[str, LabelEntry | TermEntry] = DOMAIN_LABELS
) -> str:
    """"è" or "sono", agreeing with `key`'s grammatical number (L05 §4.1).

    An unlabelled `AssetClass` degrades to "è" (L05 §6.2's fallback table).
    """
    entry = registry.get(key)
    if entry is None:
        return "è"
    if isinstance(entry, TermEntry):
        raise RegistryError(f"{key}: a TermEntry has no grammatical number for a copula")
    return "sono" if entry.number is GrammaticalNumber.PL else "è"


def agree(
    key: str,
    masculine_singular: str,
    *,
    registry: Mapping[str, LabelEntry | TermEntry] = DOMAIN_LABELS,
) -> str:
    """Inflect a regular adjective to agree with `key`'s gender and number (L05 §4.1 note 2).

    Handles only regular adjectives, keyed on the final vowel of `masculine_singular`: `-o` →
    `-o/-a/-i/-e`, `-e` → `-e/-e/-i/-i`. An irregular adjective must not be routed through here
    — rewrite the sentence instead.
    """
    entry = registry.get(key)
    if entry is None or isinstance(entry, TermEntry):
        raise RegistryError(f"{key}: agree() requires a registered LabelEntry")
    if masculine_singular.endswith("o"):
        stem = masculine_singular[:-1]
        forms = {
            (Gender.M, GrammaticalNumber.SG): f"{stem}o",
            (Gender.F, GrammaticalNumber.SG): f"{stem}a",
            (Gender.M, GrammaticalNumber.PL): f"{stem}i",
            (Gender.F, GrammaticalNumber.PL): f"{stem}e",
        }
    elif masculine_singular.endswith("e"):
        stem = masculine_singular[:-1]
        forms = {
            (Gender.M, GrammaticalNumber.SG): f"{stem}e",
            (Gender.F, GrammaticalNumber.SG): f"{stem}e",
            (Gender.M, GrammaticalNumber.PL): f"{stem}i",
            (Gender.F, GrammaticalNumber.PL): f"{stem}i",
        }
    else:
        raise RegistryError(
            f"{masculine_singular!r}: not a regular adjective agree() can inflect; "
            "rewrite the sentence instead (L05 §4.1 note 2)"
        )
    return forms[(entry.gender, entry.number)]
