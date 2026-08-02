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
        "run_id": f"run:{run.id[:8]}",
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
    Screen 7 (Run health) joins the design preview under "Verificare" — the group for making a
    configuration legible rather than for deciding or holding anything. The remaining screens
    (4 Buckets, 5 Operations, 6 Strategy) join "Detenere"/"Dichiarare" in the commits that add
    their own routes, so a rail entry never points at a route that does not exist yet.
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
                    "label": "Allocazione e patrimonio",
                    "url": "/allocation",
                    "count": None,
                    "current": current == "allocation",
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


def skip_notice_context(counts: OutcomeCounts) -> dict[str, Any]:
    """`partials/skip_notice.html`'s context from an `OutcomeCounts`.

    Each reason carries an authored Italian explanation, taken from the label registry's gloss
    for that `SkipReason` (P22) rather than derived from the identifier. ADR-0016 and ADR-L03
    §5.3 both require the reason to be said in words: a bare identifier beside a count is the
    "not evaluated, cause unknown" the notice exists to prevent.
    """
    reasons = []
    for reason in counts.reasons:
        entry = ALL_LABELS.get(reason.reason)
        gloss = entry.gloss if entry is not None and entry.gloss else None
        reasons.append(
            {
                "reason": reason.reason,
                "count": reason.count,
                "explanation": gloss
                or (
                    "la valutazione non ha registrato un motivo per questo esito, che è "
                    "esso stesso un difetto da segnalare."
                ),
            }
        )
    return {
        "skipped_count": counts.skipped,
        "error_count": counts.error,
        "total_count": counts.total,
        "reasons": reasons,
        "run_url": None,
    }
