"""Canonical serialization and hashing (RFC-0006 §10).

`input_digest` and `finding_key` are only meaningful if serialization is byte-stable, so the
four canonicalization rules are implemented once, here:

1. `Decimal` serializes as a string at the scale declared by its value object.
2. Mapping keys sort lexicographically; sequences keep their order, which is evaluation order.
3. Timestamps are UTC RFC 3339 with an explicit offset.
4. `None` is omitted from mappings, so absence has exactly one representation.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Final
from uuid import UUID

from pydantic import BaseModel

from financeos.core.shared.numbers import canonical_decimal

#: Separator used when concatenating the components of a hash input.
HASH_SEPARATOR: Final = "|"


def canonical_value(value: Any) -> Any:
    """Reduce `value` to JSON-native primitives under the canonicalization rules."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, Decimal):
        return canonical_decimal(value)
    if isinstance(value, Enum):
        return canonical_value(value.value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date | UUID):
        return str(value)
    if isinstance(value, BaseModel):
        return canonical_value(dict(value))
    if isinstance(value, Mapping):
        return {
            str(key): canonical_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            if item is not None
        }
    if isinstance(value, Sequence):
        return [canonical_value(item) for item in value]
    raise TypeError(f"{type(value)!r} has no canonical form")


def canonical_json(value: Any) -> str:
    """Serialize `value` to its canonical JSON string form."""
    return json.dumps(
        canonical_value(value), separators=(",", ":"), ensure_ascii=False, sort_keys=False
    )


def sha256_hex(*parts: str) -> str:
    """SHA-256 over `parts` joined by `HASH_SEPARATOR`, as lowercase hex."""
    return hashlib.sha256(HASH_SEPARATOR.join(parts).encode("utf-8")).hexdigest()
