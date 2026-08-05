"""The chrome every screen shares: the index rail and the provenance bar.

Built once here so the three screens cannot drift apart. Two interfaces are being satisfied,
both documented in the partials themselves:

* `partials/nav.html` — ordered groups of `{label, url, count, current}`.
* `partials/provenance_bar.html` — a dict whose `as_of` / `evaluated_at` are **already**
  formatted it-IT, or `None` for a page with no run behind it. That partial predates this
  module and its interface is left exactly as it was; the formatting is done by
  `format_date_it`, the single function that decides what a date looks like, so nothing here
  invents a second convention.

Every screen of UX-0001 §2 that has a route is listed in the rail; a rail entry pointing at a
404 is worse than an absent one, so a screen is added here in the same commit that ships its
route.
"""

from __future__ import annotations

from typing import Any

from financeos.adapters.duckdb.queries.it_locale import format_date_it
from financeos.adapters.duckdb.queries.runs import OutcomeCounts, RunRow
from financeos.web.labels import ALL_LABELS


def provenance_of(run: RunRow | None) -> dict[str, Any] | None:
    """The provenance bar's dict for `run`, or `None` when nothing has been evaluated.

    `run_url` points at `/runs/{id}` (screen 7): the run id is now a real, resolvable link, so a
    reader can walk from any page's provenance bar straight to that run's own outcome breakdown.
    """
    if run is None:
        return None
    return {
        "portfolio": run.portfolio_name,
        "as_of": format_date_it(run.as_of),
        # [:13] — the two leading UUIDv7 groups (the full 48-bit millisecond timestamp), not
        # `[:8]` (its high 32 bits alone): the demo fixture's 5 runs from one `evaluate`
        # invocation all fall in the same ~49-day window `[:8]` covers and showed identically
        # as `run:019fd0c9` on every page's provenance bar (task #12/#dashboard review
        # SHOULD-FIX 3). The low 16 bits tick every millisecond, which sequential run writes
        # always cross.
        "run_id": f"run:{run.id[:13]}",
        "run_url": f"/runs/{run.id}",
        "mode": run.mode,
        "input_digest": f"sha256:{run.input_digest[:4]}…{run.input_digest[-4:]}",
        "evaluated_at": format_date_it(run.evaluated_at.date()),
    }


def nav_of(current: str, *, findings_count: int | None = None) -> list[dict[str, Any]]:
    """The index rail, with `current` marking the active route.

    `findings_count` annotates the findings entry. It is the number of *open findings*, and it
    is deliberately not rendered anywhere as reassurance on its own: a count of zero over a run
    that skipped rules is the ADR-0016 failure, which is why the findings page carries the skip
    notice beside this number rather than the number alone.

    Grouping follows UX-0001 §5.2's own invented Decide/Hold/Declare/Verify split, which is
    explicitly free to change but is kept because it separates what the V1.0 screens are *for*.
    Buckets joins Allocation under "Detenere" (both are about what is held). Operations and
    Strategy sit under "Dichiarare" — the ledger and the frozen declaration are both authored
    records.
    """
    count = None if findings_count is None else _findings_count_label(findings_count)
    return [
        {
            "label": "Decidere",
            "items": [
                {"label": "Rilievi", "url": "/", "count": count, "current": current == "findings"},
            ],
        },
        {
            "label": "Detenere",
            "items": [
                {
                    "label": "Patrimonio",
                    "url": "/dashboard",
                    "count": None,
                    "current": current == "dashboard",
                },
                {
                    "label": "Allocazione e patrimonio",
                    "url": "/allocation",
                    "count": None,
                    "current": current == "allocation",
                },
                {
                    "label": "Bucket e apportionment",
                    "url": "/buckets",
                    "count": None,
                    "current": current == "buckets",
                },
            ],
        },
        {
            "label": "Dichiarare",
            "items": [
                {
                    "label": "Operazioni",
                    "url": "/operations",
                    "count": None,
                    "current": current == "operations",
                },
                {
                    "label": "Strategie",
                    "url": "/strategies",
                    "count": None,
                    "current": current == "strategies",
                },
            ],
        },
        {
            "label": "Verificare",
            "items": [
                {
                    "label": "Stato delle valutazioni",
                    "url": "/runs",
                    "count": None,
                    "current": current == "runs",
                },
                {
                    "label": "Sistema di progettazione",
                    "url": "/design",
                    "count": None,
                    "current": current == "design",
                },
            ],
        },
    ]


def _findings_count_label(count: int) -> str:
    """"1 aperto" / "n aperti" — agreeing in number, which `agree()` cannot do for a noun."""
    return "1 aperto" if count == 1 else f"{count} aperti"


def skip_notice_context(counts: OutcomeCounts, run: RunRow | None = None) -> dict[str, Any]:
    """`partials/skip_notice.html`'s context from an `OutcomeCounts`.

    Each reason carries an authored Italian explanation, taken from the label registry's gloss
    for that `SkipReason` (P22) rather than derived from the identifier. ADR-0016 and ADR-L03
    §5.3 both require the reason to be said in words: a bare identifier beside a count is the
    "not evaluated, cause unknown" the notice exists to prevent.

    An `ERROR` outcome's cause is not a catalogued `SkipReason` (it is the exception raised
    during evaluation, RFC-0006 §5) so it carries no `ALL_LABELS` gloss; its own recorded text
    is the explanation rather than the "no motive recorded" disclaimer, which is reserved for
    the genuinely-unknown `'unknown'` sentinel `run_outcome_counts` emits when even that is
    missing (task #12/#dashboard review SHOULD-FIX 2).

    `run_url` is set to `/runs/{run.id}` when a single run is available, or `None` when the
    notice aggregates counts across multiple runs (e.g., dashboard's per-bucket evaluations).
    """
    reasons = []
    for reason in counts.reasons:
        entry = ALL_LABELS.get(reason.reason)
        gloss = entry.gloss if entry is not None and entry.gloss else None
        if gloss is not None:
            explanation = gloss
        elif reason.reason == "unknown":
            explanation = (
                "la valutazione non ha registrato un motivo per questo esito, che è "
                "esso stesso un difetto da segnalare."
            )
        else:
            explanation = reason.reason
        reasons.append(
            {
                "reason": reason.reason,
                "count": reason.count,
                "explanation": explanation,
            }
        )
    return {
        "skipped_count": counts.skipped,
        "error_count": counts.error,
        "total_count": counts.total,
        "reasons": reasons,
        "run_url": f"/runs/{run.id}" if run is not None else None,
    }
