"""One frozen run time per run; every timestamp in a run derives from it."""
from datetime import datetime, timedelta, timezone


def parse_time(value: str) -> datetime:
    """Parse an ISO 8601 instant. A timezone is required; the result is UTC."""
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError(f'timestamp needs a timezone: {value!r}')
    return parsed.astimezone(timezone.utc)


def freeze(now: str | None = None) -> datetime:
    """The run's single clock reading, to whole seconds so reruns print identical bodies."""
    moment = parse_time(now) if now else datetime.now(timezone.utc)
    return moment.replace(microsecond=0)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def minutes_before(now: datetime, minutes: float) -> datetime:
    return now - timedelta(minutes=minutes)


def rebase_offset_ms(latest_ms: int, run_time: datetime) -> int:
    """Offset that moves a recording so its latest sample lands exactly on the run time.

    One offset for every sample: gaps and order are preserved, and nothing ends up in the future.
    """
    return int(run_time.timestamp() * 1000) - int(latest_ms)
