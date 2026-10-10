"""HTTP boundary only. Durable outbox/retry policy belongs to Lane D milestone 3."""
import os
from uuid import UUID
import httpx
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from .main import CONTRACTS

async def publish(external_id: UUID, payload: dict):
    spec = yaml.safe_load((CONTRACTS/'openapi.yaml').read_text())
    Draft202012Validator({'$ref':'#/components/schemas/AutomaticPublication', 'components':spec['components']}, format_checker=FormatChecker()).validate(payload)
    url = os.environ['PRODUCT_API_URL'].rstrip('/')
    key = os.environ['AUTOMATION_PUBLISH_KEY']
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.put(f'{url}/v1/automatic/hazards/{external_id}', json=payload,
                                    headers={'Authorization':f'Bearer {key}'})
        response.raise_for_status()
        return response.json()
