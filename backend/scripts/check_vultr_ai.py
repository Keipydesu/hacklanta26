"""Check current model capabilities, then optionally run a real paid inference smoke check."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ai import DEFAULT_MODEL, VultrAI, validate_image
from app.schemas import RouteExplanationRequest

async def smoke(photo):
    provider = VultrAI.from_env()
    if not provider:
        raise ValueError('Set VULTR_INFERENCE_API_KEY to a Vultr Serverless Inference key first.')
    try:
        if photo:
            encoded = validate_image(base64.b64encode(Path(photo).read_bytes()).decode())
            print((await provider.analyze(encoded)).model_dump_json())
        else:
            body = RouteExplanationRequest.model_validate({'routes': [
                {'kind': 'shortest', 'duration_s': 180, 'distance_m': 1000, 'hazard_count': 3},
                {'kind': 'safest', 'duration_s': 240, 'distance_m': 1200, 'hazard_count': 1}], 'safest_available': True})
            print(await provider.explain(body))
    finally:
        await provider.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog-only', action='store_true', help='No key or paid inference required')
    parser.add_argument('--photo', help='JPEG at current location for a paid vision smoke check')
    args = parser.parse_args()
    model_id = os.getenv('VULTR_INFERENCE_MODEL', DEFAULT_MODEL).strip()
    with urllib.request.urlopen('https://api.vultrinference.com/v1/models', timeout=20) as response:
        catalog = json.load(response)
    model = next((m for m in catalog['data'] if m['id'] == model_id), None)
    if not model:
        raise ValueError('Configured model is absent from Vultr catalog. Choose a current vision chat model.')
    image = next((x for x in model['input_modalities'] if x['type'] == 'image'), None)
    text = next((x for x in model['output_modalities'] if x['type'] == 'text'), None)
    if not image or not text:
        raise ValueError('Configured model must accept images and generate text.')
    formats = text.get('supported_parameters', {}).get('response_format', {}).get('properties', {}).get('type', {}).get('values', [])
    if 'json_schema' not in formats:
        raise ValueError('Configured model must support json_schema structured output.')
    print(f'Catalog OK: {model_id} supports vision, text and JSON schema.')
    if not args.catalog_only:
        asyncio.run(smoke(args.photo))

if __name__ == '__main__':
    try:
        main()
    except ValueError as exc:
        sys.exit(str(exc))
    except Exception:
        sys.exit('Vultr check failed. Verify the model, inference key and network; credentials and provider bodies are not logged.')
