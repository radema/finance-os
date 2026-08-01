"""`DuckDBEvaluationRepository` — `evaluation_run` + `alert` + `recommendation` + `snapshot`
(E4/E5, RFC-0009 §5.1).

All four tables are append-only facts (C6). `save` writes the whole set of one evaluation's
artifacts in a single transaction, mirroring the sequence RFC-0005 §3 diagrams: run, then
every `Alert` (all four outcomes), then every `Recommendation` (`FIRED` only), then the
`Snapshot` sharing this run's id — written on every evaluate (RFC-0010 V1.0).
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import duckdb

from financeos.core.decision import Alert, EvaluationRun, Recommendation, Snapshot


class DuckDBEvaluationRepository:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def save(
        self,
        run: EvaluationRun,
        alerts: Sequence[Alert],
        recommendations: Sequence[Recommendation],
        snapshot: Snapshot | None = None,
    ) -> None:
        self._con.execute("BEGIN TRANSACTION")
        try:
            self._con.execute(
                "INSERT INTO evaluation_run "
                "(id, portfolio_id, strategy_id, strategy_version_id, scope_kind, scope_id, "
                " as_of, evaluated_at, mode, engine_versions, input_digest) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    str(run.id),
                    str(run.portfolio_id),
                    str(run.strategy_id),
                    str(run.strategy_version_id),
                    run.scope.kind.value,
                    str(run.scope.id),
                    run.as_of,
                    run.evaluated_at,
                    run.mode.value,
                    json.dumps(dict(run.engine_versions)),
                    run.input_digest,
                ],
            )
            for alert in alerts:
                self._con.execute(
                    "INSERT INTO alert "
                    "(id, run_id, rule_id, outcome, priority, severity, trace, recorded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        str(alert.id),
                        str(alert.run_id),
                        str(alert.rule_id),
                        alert.outcome.value,
                        alert.priority.value,
                        alert.severity,
                        alert.trace.model_dump_json(),
                        alert.recorded_at,
                    ],
                )
            for rec in recommendations:
                self._con.execute(
                    "INSERT INTO recommendation "
                    "(id, alert_id, run_id, strategy_version_id, rule_id, finding_key, "
                    " observation, rationale, suggestion_class, input_refs, recorded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        str(rec.id),
                        str(rec.alert_id),
                        str(rec.provenance.run_id),
                        str(rec.provenance.strategy_version_id),
                        str(rec.provenance.rule_id),
                        rec.finding_key,
                        rec.observation,
                        rec.rationale,
                        rec.suggestion_class.value if rec.suggestion_class else None,
                        json.dumps(list(rec.provenance.input_refs)),
                        rec.recorded_at,
                    ],
                )
            if snapshot is not None:
                self._con.execute(
                    "INSERT INTO snapshot "
                    "(id, portfolio_id, as_of, run_id, total_value, currency, allocation, "
                    " by_bucket, recorded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        str(snapshot.id),
                        str(snapshot.portfolio_id),
                        snapshot.as_of,
                        str(snapshot.run_id) if snapshot.run_id else None,
                        snapshot.total_value,
                        snapshot.currency,
                        json.dumps(
                            {
                                asset_class: {"value": str(line.value), "weight": str(line.weight)}
                                for asset_class, line in snapshot.allocation.items()
                            }
                        ),
                        json.dumps(
                            {
                                key: {"value": str(line.value), "weight": str(line.weight)}
                                for key, line in snapshot.by_bucket.items()
                            }
                        ),
                        snapshot.recorded_at,
                    ],
                )
        except Exception:
            self._con.execute("ROLLBACK")
            raise
        else:
            self._con.execute("COMMIT")
