"""HTTP boundary only. Durable outbox/retry policy belongs to Lane D milestone 3."""
from functools import cache
import os
from uuid import UUID
import httpx
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from .config import CONTRACTS

@cache
def validator():
    spec = yaml.safe_load((CONTRACTS/'openapi.yaml').read_text())
    return Draft202012Validator({'$ref':'#/components/schemas/AutomaticPublication', 'components':spec['components']}, format_checker=FormatChecker())

async def publish(external_id: UUID, payload: dict, client: httpx.AsyncClient | None = None):
    """Pass a long-lived client when publishing in bulk so connections are reused."""
    validator().validate(payload)
    url = os.environ['PRODUCT_API_URL'].rstrip('/')
    key = os.environ['AUTOMATION_PUBLISH_KEY']
    if client is None:
        async with httpx.AsyncClient(timeout=10) as client:
            return await send(client, url, key, external_id, payload)
    return await send(client, url, key, external_id, payload)

async def send(client, url, key, external_id, payload):
    response = await client.put(f'{url}/v1/automatic/hazards/{external_id}', json=payload,
                                headers={'Authorization':f'Bearer {key}'})
    response.raise_for_status()
    return response.json()
