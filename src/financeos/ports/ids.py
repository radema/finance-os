"""`IdGen` — the identifier-minting port (RFC-0009 §3: UUIDv7 generated in application code).

Engines and `core` never mint an id (I-7); every `next_id()` `core.engines.decision_engine`
calls is supplied as a plain value by the application layer through this port.
"""

from typing import Protocol
from uuid import UUID


class IdGen(Protocol):
    """Mints a fresh identifier.

    Callable, so an instance satisfies `Callable[[], UUID]` directly — the exact shape
    `decision_engine.materialize`'s `next_id` parameter expects.
    """

    def __call__(self) -> UUID: ...
