"""Chrome-tier Italian labels and the Jinja filters that render them (L05 §2, §5.4-§5.8).

`CHROME_LABELS` never enters a frozen row (L05 §2.1's own freeze-boundary criterion), so it
lives here rather than in `core.shared.labels`: frame nouns for web-only concepts, the four
`Outcome` chips, `SkipReason`, `SuggestionClass`, `Priority`, `ScopeKind`, `RunMode` and
`OperationType`. It imports the domain entries from `core.shared.labels` rather than restating
them (§2.4) — one taxonomy table, not two drifting apart.

`RiskLevel` is deliberately absent. The 5-member set in `core.strategy.strategy.RiskLevel`
today is being replaced by a 7-member ordinal scale (product owner ruling, W2-open, out of L05's
scope) — labelling the set about to be deleted is rework for whoever lands that change.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from jinja2 import Environment

from financeos.core.shared import (
    DOMAIN_LABELS,
    ArticleForm,
    LabelEntry,
    Role,
    TermEntry,
    agree,
    copula,
    label,
)
from financeos.core.shared.ids import asset_class_label

#: Web-tier frame nouns (L05 §5.4), keyed `noun.<english_name>` — disjoint from every enum
#: value, including the lowercase `SkipReason` values, by construction (the dotted prefix).
_FRAME_NOUNS: Final[Mapping[str, LabelEntry]] = {
    "noun.position": LabelEntry(noun="posizione", form=ArticleForm.FS_LA),
    "noun.asset": LabelEntry(noun="asset", form=ArticleForm.MS_ELIDED),
    "noun.bucket": LabelEntry(noun="Bucket", form=ArticleForm.MS_IL),
    "noun.portfolio": LabelEntry(noun="portafoglio", form=ArticleForm.MS_IL),
    "noun.net_worth": LabelEntry(noun="patrimonio netto", form=ArticleForm.MS_IL),
    "noun.strategy": LabelEntry(noun="strategia", form=ArticleForm.FS_LA),
    "noun.rule": LabelEntry(noun="regola", form=ArticleForm.FS_LA),
    "noun.finding": LabelEntry(noun="rilievo", form=ArticleForm.MS_IL),
    "noun.evaluation": LabelEntry(noun="valutazione", form=ArticleForm.FS_LA),
    "noun.target": LabelEntry(noun="target", form=ArticleForm.MS_IL),
    "noun.threshold": LabelEntry(noun="soglia", form=ArticleForm.FS_LA),
    "noun.band": LabelEntry(noun="banda", form=ArticleForm.FS_LA),
    "noun.drift": LabelEntry(noun="scostamento", form=ArticleForm.MS_IL),
    "noun.allocation": LabelEntry(noun="allocazione", form=ArticleForm.FS_ELIDED),
    "noun.severity": LabelEntry(noun="severità", form=ArticleForm.FS_LA),
    "noun.horizon": LabelEntry(noun="orizzonte", form=ArticleForm.MS_ELIDED),
    "noun.principle": LabelEntry(noun="principio", form=ArticleForm.MS_IL),
}

#: The four `Outcome` chips (L05 §5.5), agreeing with an elided feminine-singular "regola".
#: ADR-L03 §5.3: SKIPPED and ERROR must keep their bite.
_OUTCOME: Final[Mapping[str, TermEntry]] = {
    "FIRED": TermEntry(text="Scattata", gloss="La condizione è risultata vera: esiste un rilievo."),
    "NOT_FIRED": TermEntry(
        text="Non scattata", gloss="La condizione è stata valutata ed è risultata falsa."
    ),
    "SKIPPED": TermEntry(
        text="Non valutata",
        gloss="La regola non è stata valutata. Non valutato non significa conforme.",
    ),
    "ERROR": TermEntry(
        text="Errore",
        gloss="La valutazione si è interrotta: il risultato non è né vero né falso.",
    ),
}

#: `SkipReason` (L05 §5.6). Keys are the lowercase enum *values*, unlike every other closed
#: enum here.
_SKIP_REASON: Final[Mapping[str, TermEntry]] = {
    "disabled": TermEntry(
        text="Regola disattivata",
        gloss=(
            "La regola è disattivata nella versione congelata della strategia, quindi non è "
            "stata valutata."
        ),
    ),
    "missing_fact": TermEntry(
        text="Dato mancante",
        gloss="Un dato richiesto dalla condizione non era disponibile alla data di valutazione.",
    ),
    "stale_fact": TermEntry(
        text="Dato non aggiornato",
        gloss=(
            "Il dato esisteva ma era più vecchio della soglia di aggiornamento ammessa dalla "
            "regola."
        ),
    ),
    "zero_denominator": TermEntry(
        text="Denominatore nullo",
        gloss=(
            "Il calcolo avrebbe richiesto una divisione per zero: la banda di tolleranza è nulla."
        ),
    ),
    "zero_portfolio_value": TermEntry(
        text="Valore di portafoglio nullo",
        gloss=(
            "Lo scopo di valutazione non detiene ancora nulla, quindi ogni peso sarebbe una "
            "divisione per zero. È uno stato iniziale legittimo, non un errore."
        ),
    ),
    "heterogeneous_strategies": TermEntry(
        text="Strategie non omogenee",
        gloss=(
            "I Bucket seguono strategie diverse, quindi lo scostamento a livello di "
            "portafoglio non ha un unico albero di target. Farne una media produrrebbe un "
            "numero privo di significato."
        ),
    ),
}

#: `SuggestionClass` (L05 §5.7), the closed E7 enum. Impersonal infinitives (P8); none names
#: an instrument, a direction or a size (I-12, E7).
_SUGGESTION_CLASS: Final[Mapping[str, TermEntry]] = {
    "REVIEW_ALLOCATION": TermEntry(text="Rivedere l’allocazione"),
    "CONSIDER_REBALANCE": TermEntry(text="Valutare un ribilanciamento"),
    "REVIEW_BUCKET_ASSIGNMENT": TermEntry(text="Rivedere l’assegnazione ai Bucket"),
    "REVIEW_STRATEGY": TermEntry(text="Rivedere la strategia"),
    "REVIEW_LIQUIDITY": TermEntry(text="Rivedere la liquidità"),
    "NO_ACTION": TermEntry(text="Nessuna azione"),
}

#: `Priority` (L05 §5.8), agreeing with "priorità" (F SG).
_PRIORITY: Final[Mapping[str, TermEntry]] = {
    "CRITICAL": TermEntry(text="Critica"),
    "HIGH": TermEntry(text="Alta"),
    "MEDIUM": TermEntry(text="Media"),
    "LOW": TermEntry(text="Bassa"),
    "INFO": TermEntry(text="Informativa", short="Info"),
}

#: `ScopeKind` (L05 §5.8).
_SCOPE_KIND: Final[Mapping[str, TermEntry]] = {
    "PORTFOLIO": TermEntry(text="Portafoglio"),
    "BUCKET": TermEntry(text="Bucket"),
}

#: `RunMode` (L05 §5.8), agreeing with "valutazione" (F SG).
_RUN_MODE: Final[Mapping[str, TermEntry]] = {
    "ACTUAL": TermEntry(text="Effettiva"),
    "HYPOTHETICAL": TermEntry(text="Ipotetica"),
}

#: `OperationType` (L05 §5.8; `core/portfolio/operation.py`, seven values per E10 / ADR-0028).
_OPERATION_TYPE: Final[Mapping[str, TermEntry]] = {
    "BUY": TermEntry(text="Acquisto"),
    "SELL": TermEntry(text="Vendita"),
    "DIVIDEND": TermEntry(text="Dividendo"),
    "COUPON": TermEntry(text="Cedola"),
    "TRANSFER_IN": TermEntry(text="Trasferimento in entrata"),
    "TRANSFER_OUT": TermEntry(text="Trasferimento in uscita"),
    "CORRECTION": TermEntry(text="Rettifica"),
}

#: Every chrome-tier entry, keyed disjointly from `DOMAIN_LABELS` (asserted by
#: `tests/test_labels.py`'s keyspace-disjointness check).
CHROME_LABELS: Final[Mapping[str, LabelEntry | TermEntry]] = {
    **_FRAME_NOUNS,
    **_OUTCOME,
    **_SKIP_REASON,
    **_SUGGESTION_CLASS,
    **_PRIORITY,
    **_SCOPE_KIND,
    **_RUN_MODE,
    **_OPERATION_TYPE,
}

#: The one merged registry every Jinja filter reads — `DOMAIN_LABELS` imported, never restated
#: (L05 §2.4).
ALL_LABELS: Final[Mapping[str, LabelEntry | TermEntry]] = {**DOMAIN_LABELS, **CHROME_LABELS}


def _label(key: str, role: str = "bare") -> str:
    return label(key, role=Role(role), registry=ALL_LABELS)


def _label_cap(key: str, role: str = "bare") -> str:
    return label(key, role=Role(role), sentence_initial=True, registry=ALL_LABELS)


def label_short(key: str) -> str:
    """The non-syntactic compact form (axis, legend, cell, rail) — never composed with an
    article, a preposition or a verb (L05 §3.5).

    Public because a route assembling a chart option needs the same axis form a template does
    (P24: Italian short forms on chart axes). A second implementation in a view is how an axis
    ends up reading differently from the table beneath it.
    """
    entry = ALL_LABELS.get(key)
    if entry is None:
        return asset_class_label(key)
    if entry.short is not None:
        return entry.short
    return entry.noun if isinstance(entry, LabelEntry) else entry.text


def _label_gloss(key: str) -> str:
    """The one teaching sentence a shipped interface asked for, or `""` where none exists."""
    entry = ALL_LABELS.get(key)
    return (entry.gloss or "") if entry is not None else ""


def _copula(key: str) -> str:
    """"è" or "sono", agreeing with `key`'s grammatical number (L05 §4.1)."""
    return copula(key, registry=ALL_LABELS)


def _agree(masculine_singular: str, key: str) -> str:
    """Inflect a regular adjective to agree with `key` (L05 §4.1 note 2).

    Argument order is the adjective first so the filter reads as the agreement it performs:
    `{{ "assegnato" | agree(line.asset_class) }}`.
    """
    return agree(key, masculine_singular, registry=ALL_LABELS)


def register_label_filters(env: Environment) -> None:
    """Register `label`, `label_cap`, `label_short`, `label_gloss`, `copula`, `agree`.

    `copula` and `agree` (L05 §4.1) are exposed as filters for the same reason `label` is: a
    template that hardcodes "è" is wrong for every feminine-plural taxonomy head, which is the
    defect D10 recorded. The agreement has to be reachable from a template, or a template will
    guess.
    """
    env.filters["label"] = _label
    env.filters["label_cap"] = _label_cap
    env.filters["label_short"] = label_short
    env.filters["label_gloss"] = _label_gloss
    env.filters["copula"] = _copula
    env.filters["agree"] = _agree
