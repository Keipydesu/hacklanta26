"""Deterministic UUIDs: the same run and logical item always produce the same ID."""
from uuid import NAMESPACE_URL, UUID, uuid5

ROOT = uuid5(NAMESPACE_URL, 'https://github.com/Keipydesu/hacklanta26/simulator')


def run_namespace(scenario: str, seed: int, now_iso: str) -> UUID:
    """A fresh run (new clock reading) gets a new namespace; a resumed run reuses its own."""
    return uuid5(ROOT, f'{scenario}|{seed}|{now_iso}')


def item_id(run_id: UUID | str, scenario: str, item_key: str) -> str:
    return str(uuid5(UUID(str(run_id)), f'{scenario}/{item_key}'))
