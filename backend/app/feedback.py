"""Hazard feedback policy ("Is this hazard still there?"), kept pure so it can change without touching
storage or the HTTP adapter. Decision 012 records the agreed policy."""
from dataclasses import dataclass
from datetime import datetime, timedelta

MANUAL_REFRESH = timedelta(hours=24)
GONE_TO_RESOLVE = 2
RECENT_NEEDED = GONE_TO_RESOLVE

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

def apply_feedback(hazard: HazardState, recent: list[str], now: datetime) -> Change | None:
    """`recent` holds this hazard's latest answers, newest first (at most RECENT_NEEDED), starting
    with the one just recorded. Returns the hazard's new state, or None to leave it unchanged.

    Manual hazards: "still_there" extends expiry to now + 24 h. GONE_TO_RESOLVE consecutive "gone"
    answers (none of them followed by "still_there") resolve it; one answer never removes a hazard.
    """
    if hazard.source != 'manual' or not recent:
        return None
    if recent[0] == 'still_there':
        return Change('active', max(hazard.last_seen, now), max(hazard.expires_at, now + MANUAL_REFRESH))
    if len(recent) >= GONE_TO_RESOLVE and all(answer == 'gone' for answer in recent[:GONE_TO_RESOLVE]):
        return Change('resolved', hazard.last_seen, hazard.expires_at)
    return None
