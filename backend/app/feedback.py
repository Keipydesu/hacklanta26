"""Hazard feedback policy ("Is this hazard still there?"), kept pure so it can change without touching
storage or the HTTP adapter. Decision 012 records the agreed policy."""
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class HazardState:
    source: str
    status: str
    last_seen: datetime
    expires_at: datetime

@dataclass(frozen=True)
class Change:
    status: str
    last_seen: datetime
    expires_at: datetime

def apply_feedback(hazard: HazardState, responses: list[str], now: datetime) -> Change | None:
    """`responses` is this hazard's feedback, oldest first, ending with the one just recorded.
    Returns the hazard's new state, or None to leave it unchanged."""
    return None
