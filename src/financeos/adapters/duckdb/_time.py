"""`TIMESTAMPTZ` read workaround.

DuckDB's Python client needs `pytz` to convert a native `TIMESTAMPTZ` value to a `datetime`
on fetch — a transitive dependency this project does not carry. Every repository instead
selects such columns as ``CAST(col AS VARCHAR)`` (with the session `TimeZone` fixed to UTC in
`connection.connect`) and parses the string here. Writing a `datetime` as a bound parameter
needs no such workaround; only the read direction is affected.
"""

from __future__ import annotations

from datetime import datetime


def parse_instant(value: str) -> datetime:
    """Parse a UTC-session `CAST(TIMESTAMPTZ AS VARCHAR)` string back into a `datetime`."""
    return datetime.fromisoformat(value)
