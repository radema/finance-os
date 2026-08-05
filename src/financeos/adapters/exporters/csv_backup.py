"""CSV/YAML serializers for the full-backup export — a bundle mirroring the exact `demo/`
fixture-directory shape `financeos seed <dir>` already reads (product-owner decision,
2026-08-05; see `app.export_backup`'s module docstring for the full rationale and the
distinction from `export --authored`, RFC-0009 §7.1).

Every function here is a pure serializer over already-fetched domain objects, no `UnitOfWork`
— matching `adapters.exporters.yaml_authored`'s split (fetching via the repository ports is
`app.export_backup`'s job).

Column contracts are `demo/*.csv`'s headers verbatim:

- `accounts.csv`: id,name,type,currency,cash_asset_id
- `assets.csv`: id,name,asset_class,currency
- `portfolios.csv`: id,name
- `buckets.csv`: id,portfolio_id,strategy_id,name
- `portfolio_accounts.csv`: portfolio_id,account_id
- `apportionment.csv`: bucket_id,asset_id,quantity,effective_from — **current** rows only.
  Superseded supersession-chain history is dropped on purpose: that history has no other
  recovery path than `export --authored` (RFC-0009 §7.1); this backup targets re-seedability,
  not audit history, and `financeos seed` only ever reads one row per (bucket, asset) anyway.
- `prices.csv`: asset_id,valid_date,close,currency,source
- `operations.csv`: account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref —
  primary rows only (`cash_leg_of IS NULL`); `import_operations` re-derives the auto-emitted
  cash leg on reseed exactly as it did on first import. `ref` is reconstructed from the one
  link column each exported type actually carries: `transfer_pair_id` for
  TRANSFER_IN/TRANSFER_OUT, blank for BUY/SELL. CORRECTION-type Operations are excluded by the
  caller (`app.export_backup`) before rows ever reach this module — see that module's
  docstring for why.

One Strategy YAML per distinct Strategy is a separate shape from both of the above: it is
`yaml_strategy.read_yaml`'s import contract, not a CSV. Unlike `yaml_authored`'s
`strategy_version_to_yaml` (authored-export-only, written before ADR-L06's `scope_gate`
existed), `strategy_definition_to_yaml` below includes `scope_gate` — dropping it would
silently change which Buckets a Rule fires for on reseed, corrupting the very round-trip this
backup exists to provide.
"""

from __future__ import annotations

import csv
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

from financeos.adapters.exporters.yaml_authored import (
    _condition_yaml,
    _horizon_yaml,
    _risk_yaml,
    _slugify,
    _target_node_yaml,
)
from financeos.core.portfolio import ApportionmentRecord, Asset, Bucket, Operation, Portfolio
from financeos.core.shared import canonical_decimal
from financeos.core.strategy import Rule, RuleScopeGate, StrategyVersion
from financeos.ports.repositories import AccountRecord, PriceRecord


def _write_csv(path: Path, header: Sequence[str], rows: Sequence[Sequence[str]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)
    return path


def write_accounts_csv(accounts: Sequence[AccountRecord], out_dir: Path) -> Path:
    rows = [(str(a.id), a.name, a.type, a.currency, str(a.cash_asset_id)) for a in accounts]
    return _write_csv(
        out_dir / "accounts.csv", ("id", "name", "type", "currency", "cash_asset_id"), rows
    )


def write_assets_csv(assets: Sequence[Asset], out_dir: Path) -> Path:
    rows = [(str(a.id), a.name, str(a.asset_class), a.currency) for a in assets]
    return _write_csv(out_dir / "assets.csv", ("id", "name", "asset_class", "currency"), rows)


def write_portfolios_csv(portfolios: Sequence[Portfolio], out_dir: Path) -> Path:
    rows = [(str(p.id), p.name) for p in portfolios]
    return _write_csv(out_dir / "portfolios.csv", ("id", "name"), rows)


def write_portfolio_accounts_csv(portfolios: Sequence[Portfolio], out_dir: Path) -> Path:
    rows = [(str(p.id), str(account_id)) for p in portfolios for account_id in p.accounts]
    return _write_csv(
        out_dir / "portfolio_accounts.csv", ("portfolio_id", "account_id"), rows
    )


def write_buckets_csv(buckets: Sequence[Bucket], out_dir: Path) -> Path:
    rows = [(str(b.id), str(b.portfolio_id), str(b.strategy_id), b.name) for b in buckets]
    return _write_csv(
        out_dir / "buckets.csv", ("id", "portfolio_id", "strategy_id", "name"), rows
    )


def write_apportionment_csv(current: Sequence[ApportionmentRecord], out_dir: Path) -> Path:
    rows = [
        (
            str(r.bucket_id),
            str(r.asset_id),
            canonical_decimal(r.quantity.amount),
            r.effective_from.isoformat(),
        )
        for r in current
    ]
    return _write_csv(
        out_dir / "apportionment.csv",
        ("bucket_id", "asset_id", "quantity", "effective_from"),
        rows,
    )


def write_prices_csv(prices: Sequence[PriceRecord], out_dir: Path) -> Path:
    rows = [
        (str(p.asset_id), p.valid_date.isoformat(), p.close, p.currency, p.source)
        for p in prices
    ]
    return _write_csv(
        out_dir / "prices.csv", ("asset_id", "valid_date", "close", "currency", "source"), rows
    )


def write_operations_csv(operations: Sequence[Operation], out_dir: Path) -> Path:
    rows = [_operation_row(op) for op in operations]
    return _write_csv(
        out_dir / "operations.csv",
        (
            "account_id",
            "asset_id",
            "type",
            "trade_date",
            "quantity",
            "price",
            "fees",
            "currency",
            "ref",
        ),
        rows,
    )


def _operation_row(op: Operation) -> tuple[str, ...]:
    ref = str(op.transfer_pair_id) if op.transfer_pair_id is not None else ""
    price = canonical_decimal(op.price) if op.price is not None else ""
    return (
        str(op.account_id),
        str(op.asset_id),
        op.type.value,
        op.trade_date.isoformat(),
        canonical_decimal(op.quantity.amount),
        price,
        canonical_decimal(op.fees),
        op.currency,
        ref,
    )


def _scope_gate_yaml(gate: RuleScopeGate) -> dict[str, Any]:
    doc: dict[str, Any] = {"kind": gate.kind.value}
    if gate.bucket_id is not None:
        doc["bucket_id"] = str(gate.bucket_id)
    return doc


def _rule_yaml(rule: Rule) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "id": str(rule.id),
        "name": rule.name,
        "enabled": rule.enabled,
        "priority": rule.priority.value,
        "suggestion_class": rule.suggestion_class.value,
        "message": rule.message,
        "condition": _condition_yaml(rule.condition),
    }
    if rule.scope_gate is not None:
        doc["scope_gate"] = _scope_gate_yaml(rule.scope_gate)
    return doc


def strategy_definition_to_yaml(version: StrategyVersion) -> dict[str, Any]:
    """The current definition only, in `yaml_strategy.read_yaml`'s exact import shape,
    `scope_gate` included — see module docstring for why this differs from
    `yaml_authored.strategy_version_to_yaml`."""
    definition = version.definition
    doc: dict[str, Any] = {
        "strategy_id": str(version.strategy_id),
        "name": definition.name,
        "objective": definition.objective,
        "horizon": _horizon_yaml(definition.horizon),
        "risk": _risk_yaml(definition.risk),
        "targets": [_target_node_yaml(node) for node in definition.targets.children],
        "rules": [_rule_yaml(rule) for rule in definition.rules],
        "change_note": version.change_note,
    }
    if definition.description is not None:
        doc["description"] = definition.description
    return doc


def write_strategy_yaml(version: StrategyVersion, out_dir: Path) -> Path:
    """One file, current definition only — `strategy-<slug>.yaml`, matching `financeos
    seed`'s ``strategy*.yaml`` glob (`cli.py`'s `seed` command)."""
    slug = _slugify(version.definition.name)
    path = out_dir / f"strategy-{slug}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(strategy_definition_to_yaml(version), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return path
