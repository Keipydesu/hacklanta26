from datetime import datetime, timedelta, timezone

from app.feedback import Change, HazardState, Hide, apply_feedback

NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
MANUAL = HazardState('manual', 'active', NOW - timedelta(hours=2), NOW + timedelta(hours=3))

def test_still_there_extends_manual_expiry_to_a_day_from_now():
    assert apply_feedback(MANUAL, ['still_there'], NOW) == Change('active', NOW, NOW + timedelta(hours=24))

def test_still_there_never_shortens_expiry_or_moves_last_seen_backwards():
    future = HazardState('manual', 'active', NOW + timedelta(minutes=4), NOW + timedelta(hours=30))
    assert apply_feedback(future, ['still_there'], NOW) == Change('active', future.last_seen, future.expires_at)

def test_one_gone_answer_never_removes_a_hazard():
    assert apply_feedback(MANUAL, ['gone'], NOW) is None
    assert apply_feedback(MANUAL, ['gone', 'still_there'], NOW) is None

def test_two_consecutive_gone_answers_resolve_a_manual_hazard():
    assert apply_feedback(MANUAL, ['gone', 'gone'], NOW) == Change('resolved', MANUAL.last_seen, MANUAL.expires_at)

def test_automatic_hazards_hide_after_two_gone_and_ignore_still_there():
    automatic = HazardState('automatic', 'active', MANUAL.last_seen, MANUAL.expires_at)
    assert apply_feedback(automatic, ['gone', 'gone'], NOW) == Hide()
    for recent in (['still_there'], ['gone'], ['gone', 'still_there'], ['still_there', 'gone']):
        assert apply_feedback(automatic, recent, NOW) is None
