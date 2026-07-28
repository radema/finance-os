"""Concrete `IdGen`/`Clock` adapters (RFC-0009 §3: UUIDv7, generated in application code).

Python 3.12 has no stdlib `uuid.uuid7`. `uuid7` below is a minimal RFC 9562 §5.7
implementation: 48-bit millisecond Unix timestamp, version/variant bits, 74 random bits. It
is time-sortable, which is the property append-only logs actually need — cryptographic
unguessability is not a requirement here.
"""

import os
from datetime import UTC, datetime
from uuid import UUID


def uuid7() -> UUID:
    """A time-sortable UUIDv7."""
    millis = int(datetime.now(UTC).timestamp() * 1000)
    rand = os.urandom(10)
    time_bytes = millis.to_bytes(6, "big")
    rand_a = ((rand[0] << 8 | rand[1]) & 0x0FFF) | 0x7000
    rand_b = int.from_bytes(rand[2:10], "big") & 0x3FFFFFFFFFFFFFFF | 0x8000000000000000
    value = (
        int.from_bytes(time_bytes, "big") << 80
        | rand_a << 64
        | rand_b
    )
    return UUID(int=value)


class UUIDv7IdGen:
    """`IdGen` adapter: mints a fresh UUIDv7 on every call."""

    def __call__(self) -> UUID:
        return uuid7()


class SystemClock:
    """`Clock` adapter: the real wall clock, UTC."""

    def now(self) -> datetime:
        return datetime.now(UTC)
