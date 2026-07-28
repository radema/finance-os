"""`Clock` — the wall-clock port (I-7: engines take a value, never a clock)."""

from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    """Supplies the current instant. `core` never calls this — the application layer reads
    it once per use case and passes the value on (`recorded_at`, `evaluated_at`)."""

    def now(self) -> datetime: ...
