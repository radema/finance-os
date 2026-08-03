"""PROTOTYPE — the data behind the three dashboard landing-page variations.

    /design/dashboard?variant=A|B|C

THIS MODULE IS THROWAWAY. It exists to answer one design question — *what should
a dashboard landing page look like, and what should it put first* — and it is
expected to be deleted once the product owner names a variation. Nothing in the
running application imports it; the only importer is
``routes/design.py``'s prototype route, which sits behind the same ``/design``
preview surface as the design system itself.

WHY A FIXTURE AND NOT A QUERY
---------------------------------------------------------------------------
Every figure here comes from ``design_fixture.preview_context()`` — the
UX-0001 §8 canonical numbers, which reconcile from one holdings ledger. A
prototype rendered against ``demo/`` would be designed against whatever shape
the seed happens to hold this week, which is the wrong thing to judge a layout
against.

I-6 IS NOT SUSPENDED BY THE FIXTURE
---------------------------------------------------------------------------
Every summary figure a variation shows carries a ``source``: the read-side
query module and function that would produce it in the real app. A figure with
no such origin is a decorative aggregate, and there is not one on any of the
three pages. The variations render those sources in a collapsed "derivazione"
block so the reader can check the claim rather than take it.

I-12 IS NOT SUSPENDED EITHER
---------------------------------------------------------------------------
No string in this module or its templates is an instruction. A dashboard is the
easiest surface in the product on which to break I-12 — a hero number wants a
call to action next to it — so the copy states facts in the impersonal register
(P17) and stops there. `target`, never `obiettivo` (P18).

THE ONE ARITHMETIC THIS MODULE ADDS
---------------------------------------------------------------------------
``design_fixture`` carries four rail cases and three skip reasons but no run
total, and a coverage-first variation cannot be judged without one. The total
is therefore stated as its addends rather than asserted:

    FIRED 3 + NOT_FIRED 12 + SKIPPED 8 + ERROR 1 = 24

and it is fixture arithmetic, not a corpus number. Nothing else here is new.
"""

from __future__ import annotations

from typing import Any

from financeos.web.design_fixture import preview_context

# --- the run's outcome census ----------------------------------------------
# ADR-0016: SKIPPED != NOT_FIRED, and neither is compliance. The three
# non-firing outcomes are counted separately and never summed into a single
# "everything else", because that sum is exactly the silent false reassurance
# the four-outcome model exists to prevent.

_FIRED = 3
_NOT_FIRED = 12
_SKIPPED = 8
_ERROR = 1
_TOTAL = _FIRED + _NOT_FIRED + _SKIPPED + _ERROR

# The census, outcome by outcome. SKIPPED and ERROR carry their reasons here
# rather than in a footnote, because `partials/outcome_chip.html` treats a
# SKIPPED chip with no reason as a bug: "not evaluated, cause unknown" is the
# false reassurance ADR-0016 forbids.
_CENSUS: list[dict[str, Any]] = [
    {"outcome": "FIRED", "count": _FIRED, "reasons": []},
    {"outcome": "NOT_FIRED", "count": _NOT_FIRED, "reasons": []},
    {
        "outcome": "SKIPPED",
        "count": _SKIPPED,
        "reasons": ["zero_portfolio_value", "heterogeneous_strategies"],
    },
    {"outcome": "ERROR", "count": _ERROR, "reasons": ["currency_mismatch"]},
]

_COVERAGE: dict[str, Any] = {
    "census": _CENSUS,
    "fired": _FIRED,
    "not_fired": _NOT_FIRED,
    "skipped": _SKIPPED,
    "error": _ERROR,
    "total": _TOTAL,
    # The fraction that was actually measured. Deliberately NOT phrased as a
    # score: 15 of 24 rules reached a verdict, and the other 9 are the reason
    # the number is on the page at all.
    "measured": _FIRED + _NOT_FIRED,
    "source": "queries/runs.py::outcome_counts(run_id) — alert GROUP BY outcome",
}

# --- the findings ----------------------------------------------------------
# Derived one-to-one from design_fixture's rail cases, which already span the
# whole legible range of the tolerance rail: a clamped breach, an ordinary
# breach, a reading inside tolerance, and a legitimately null severity.
#
# Correlated findings are NOT collapsed (RFC-0008 §4.1) and the small
# in-tolerance reading is NOT hidden: both would be the system deciding which
# half of an imbalance the reader should think about.

_FINDINGS: list[dict[str, Any]] = [
    {
        "designation": "Azioni dei paesi sviluppati",
        "scope": "Pensione",
        "rule": "drift_outside_tolerance",
        "outcome": "FIRED",
        "priority": "alta",
        "observation_it": (
            "Le Azioni dei paesi sviluppati sono al 34,00% del Bucket Pensione "
            "contro un target del 40,00%, con tolleranza ±2,00pp ABSOLUTE: uno "
            "scostamento di 6,00pp sotto il target, pari a 3,00 ampiezze di "
            "banda, ovvero −€3.240,00."
        ),
        "delta_it": "−€3.240,00",
    },
    {
        "designation": "Obbligazioni governative EUR",
        "scope": "Emergenza",
        "rule": "drift_outside_tolerance",
        "outcome": "FIRED",
        "priority": "media",
        "observation_it": (
            "Le Obbligazioni governative EUR sono sopra il target del 30,00% del "
            "Bucket Emergenza di 1,79 ampiezze di banda, con tolleranza "
            "±5,00pp ABSOLUTE."
        ),
        "delta_it": "+1,79 ampiezze",
    },
    {
        "designation": "Emergenza sotto la soglia dichiarata",
        "scope": "Emergenza",
        "rule": "bucket_below_target_value",
        "outcome": "FIRED",
        "priority": "alta",
        "observation_it": (
            "Il Bucket Emergenza detiene €18.014,80 contro una soglia "
            "dichiarata di €24.000,00. Questa condizione non definisce una "
            "banda di tolleranza, quindi non ha una severità: l'assenza è una "
            "semantica, non un dato mancante."
        ),
        "delta_it": "−€5.985,20",
    },
    {
        "designation": "Azioni dei paesi emergenti",
        "scope": "Pensione",
        "rule": "drift_outside_tolerance",
        "outcome": "NOT_FIRED",
        "priority": "media",
        "observation_it": (
            "Le Azioni dei paesi emergenti sono sotto il target del 10,00% del "
            "Bucket Pensione di 0,42 ampiezze di banda, con tolleranza RELATIVE "
            "0,25 → ±2,50pp: entro tolleranza."
        ),
        "delta_it": "−0,42 ampiezze",
    },
]

_FINDINGS_SOURCE = (
    "queries/findings.py::open_findings(run_id) — mv_finding, "
    "ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC"
)

# --- the Buckets, annotated with what was and was not measured in each -----
# Personale is the point of this table and the reason variation C exists in the
# form it does: it holds nothing, so it has zero findings AND seven unevaluated
# rules. A dashboard that showed only the zero would re-introduce ADR-0016's
# false reassurance at the presentation layer, after the domain went to trouble
# to prevent it.

_BUCKET_STATE: dict[str, dict[str, Any]] = {
    "Pensione": {"open": 1, "measured": 6, "unevaluated": 0, "worst_severity": "3,00"},
    "Figli": {"open": 0, "measured": 4, "unevaluated": 0, "worst_severity": None},
    "Emergenza": {"open": 2, "measured": 5, "unevaluated": 1, "worst_severity": "1,79"},
    "Personale": {"open": 0, "measured": 0, "unevaluated": 7, "worst_severity": None},
}

_BUCKETS_SOURCE = (
    "queries/buckets.py::bucket_values(as_of) joined to "
    "queries/runs.py::outcome_counts_by_scope(run_id)"
)

# --- what each variation is, in the owner's own reading order ---------------
# Rendered into the switcher and into the page head, so a variation can never
# be judged without its own claim about what it puts first visible beside it.

VARIANTS: list[dict[str, str]] = [
    {
        "key": "A",
        "name": "Il verbale della valutazione",
        "kicker": "Copertura prima di tutto",
        "question": "Di questa valutazione posso fidarmi, e cosa non ha misurato?",
        "tradeoff": (
            "Mette la copertura sopra i rilievi: chi apre la pagina per sapere "
            "quanto vale il patrimonio deve ancora andare su /allocation."
        ),
    },
    {
        "key": "B",
        "name": "Il quadro degli scostamenti",
        "kicker": "Una sola scala, tutte le classi",
        "question": "Quanto dista ogni cosa dalla forma che ho dichiarato?",
        "tradeoff": (
            "La colonna calibrata invita a leggere la barra più lunga come la "
            "cosa più importante, mentre l'ordine dichiarato dalla priorità "
            "(RFC-0008 §3) dice altro."
        ),
    },
    {
        "key": "C",
        "name": "Il patrimonio annotato",
        "kicker": "Aggregato prima, rilievi come annotazione",
        "question": "Cosa detengo, e in quale parte di esso stanno gli scostamenti?",
        "tradeoff": (
            "È esattamente la pagina contro cui UX-0001 §5.3 argomenta: il "
            "numero grande arriva primo e P1 dice che il prodotto sono le "
            "decisioni. Il costo è visibile, non nascosto."
        ),
    },
]

DEFAULT_VARIANT = "A"


def variant_of(requested: str | None) -> str:
    """The variant key to render. Anything unrecognised falls back to the default."""
    key = (requested or DEFAULT_VARIANT).strip().upper()
    return key if any(v["key"] == key for v in VARIANTS) else DEFAULT_VARIANT


def dashboard_context(variant: str) -> dict[str, Any]:
    """Everything the three variation templates read, in one dict."""
    fixture = preview_context()
    current = next(v for v in VARIANTS if v["key"] == variant)

    buckets = [
        {**row, "state": _BUCKET_STATE.get(row["name"], {})} for row in fixture["buckets"]
    ]

    return {
        "fixture": fixture,
        "variant": variant,
        "variants": VARIANTS,
        "current_variant": current,
        "coverage": _COVERAGE,
        "findings": _FINDINGS,
        "findings_source": _FINDINGS_SOURCE,
        "rail_cases": fixture["rail_cases"],
        "buckets": buckets,
        "buckets_source": _BUCKETS_SOURCE,
        "net_worth_it": "€107.586,33",
        "net_worth_source": (
            "queries/snapshots.py::latest_snapshot(run_id) — snapshot.net_worth, "
            "as recorded by the run, never recomputed at read time"
        ),
        "skip": {
            "skipped_count": _SKIPPED,
            "error_count": _ERROR,
            "total_count": _TOTAL,
            "reasons": fixture["skip_reasons"],
            "run_url": None,
        },
    }
