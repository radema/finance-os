"""`csv_operations.read_csv` — parsing rules for the widened V1.0 importer scope
(TRANSFER_IN/TRANSFER_OUT/CORRECTION, ADR-L01)."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from financeos.adapters.importers.csv_operations import read_csv
from financeos.core.portfolio import OperationType

ACCOUNT_1 = "00000000-0000-0000-0000-000000000001"
ACCOUNT_2 = "00000000-0000-0000-0000-000000000002"
SECURITY = "00000000-0000-0000-0000-0000000000a1"
TARGET_OP = "00000000-0000-0000-0000-000000000f00"


def _write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "operations.csv"
    path.write_text(body, encoding="utf-8")
    return path


def test_buy_sell_still_parses_without_a_ref_or_price_column(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency\n"
        f"{ACCOUNT_1},{SECURITY},BUY,2026-01-01,10,100,0,EUR\n",
    )
    rows = read_csv(path)
    assert len(rows) == 1
    assert rows[0].type is OperationType.BUY
    assert rows[0].price == Decimal("100")
    assert rows[0].ref is None


def test_transfer_row_requires_a_ref(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{ACCOUNT_1},{SECURITY},TRANSFER_OUT,2026-01-01,-10,100,0,EUR,\n",
    )
    with pytest.raises(ValueError, match="TRANSFER_OUT rows require a non-empty ref"):
        read_csv(path)


def test_transfer_row_requires_a_price(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{ACCOUNT_1},{SECURITY},TRANSFER_OUT,2026-01-01,-10,,0,EUR,T1\n",
    )
    with pytest.raises(ValueError, match="TRANSFER_OUT rows require a price"):
        read_csv(path)


def test_transfer_pair_parses_with_a_shared_ref(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{ACCOUNT_1},{SECURITY},TRANSFER_OUT,2026-01-01,-10,100,0,EUR,T1\n"
        f"{ACCOUNT_2},{SECURITY},TRANSFER_IN,2026-01-01,10,100,0,EUR,T1\n",
    )
    rows = read_csv(path)
    assert len(rows) == 2
    assert {r.type for r in rows} == {OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT}
    assert {r.ref for r in rows} == {"T1"}


def test_correction_row_requires_a_ref_and_price_is_optional(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{ACCOUNT_1},{SECURITY},CORRECTION,2026-01-01,-1,,0,EUR,{TARGET_OP}\n",
    )
    rows = read_csv(path)
    assert len(rows) == 1
    assert rows[0].price is None
    assert rows[0].ref == TARGET_OP


def test_correction_row_without_ref_is_rejected(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency,ref\n"
        f"{ACCOUNT_1},{SECURITY},CORRECTION,2026-01-01,-1,,0,EUR,\n",
    )
    with pytest.raises(ValueError, match="CORRECTION rows require a non-empty ref"):
        read_csv(path)


def test_dividend_is_still_unsupported(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "account_id,asset_id,type,trade_date,quantity,price,fees,currency\n"
        f"{ACCOUNT_1},{SECURITY},DIVIDEND,2026-01-01,0,,0,EUR\n",
    )
    with pytest.raises(ValueError, match="does not support"):
        read_csv(path)
