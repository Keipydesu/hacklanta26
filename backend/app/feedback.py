"""Hazard feedback policy ("Is this hazard still there?"), kept pure so it can change without touching
storage or the HTTP adapter. Decision 012 records the agreed policy."""
from dataclasses import dataclass
from datetime import datetime, timedelta

MANUAL_REFRESH = timedelta(hours=24)
GONE_TO_REMOVE = 2
RECENT_NEEDED = GONE_TO_REMOVE

@dataclass(frozen=True)
class HazardState:
    source: str
    status: str
    last_seen: datetime
    expires_at: datetime

@dataclass(frozen=True)
class Change:
    """New lifecycle values for a manual hazard."""
    status: str
    last_seen: datetime
    expires_at: datetime

@dataclass(frozen=True)
class Hide:
    """Hide an automatic hazard until its publisher sends a newer revision; its publication is untouched."""

def apply_feedback(hazard: HazardState, recent: list[str], now: datetime) -> Change | Hide | None:
    """`recent` holds the hazard's latest answers, newest first (at most RECENT_NEEDED), starting with the
    one just recorded. For automatic hazards it contains only answers given at the current revision.

    Manual: "still_there" extends expiry to now + 24 h; GONE_TO_REMOVE consecutive "gone" answers resolve it.
    Automatic: GONE_TO_REMOVE consecutive "gone" answers hide it; "still_there" changes nothing.
    One answer never removes a hazard, and an unanswered prompt is not an answer.
    """
    if not recent:
        return None
    gone = len(recent) >= GONE_TO_REMOVE and all(answer == 'gone' for answer in recent[:GONE_TO_REMOVE])
    if hazard.source == 'automatic':
        return Hide() if gone else None
    if recent[0] == 'still_there':
        return Change('active', max(hazard.last_seen, now), max(hazard.expires_at, now + MANUAL_REFRESH))
    return Change('resolved', hazard.last_seen, hazard.expires_at) if gone else None
