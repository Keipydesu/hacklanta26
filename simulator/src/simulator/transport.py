"""Bounded HTTP with identical-body retries, and the run object that records what was sent."""
from dataclasses import dataclass
import json
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ManifestError, RunManifest

RETRYABLE = {408, 429, 500, 502, 503, 504}


class ScenarioFailed(Exception):
    """An expectation did not hold. Message names the scenario step, item and status, never a credential."""


@dataclass
class Reply:
    status: int
    body: object
    headers: dict


class Transport:
    """Connect/read timeout plus a small retry budget. A retry always resends the same bytes."""

    def __init__(self, timeout: float = 10.0, retries: int = 4, sleep=None, opener=urlopen):
        self.timeout, self.retries, self.sleep, self.opener = timeout, retries, sleep or time.sleep, opener

    def call(self, method: str, url: str, body=None, headers: dict | None = None) -> Reply:
        data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
        request_headers = {'Content-Type': 'application/json', **(headers or {})}
        last_error = None
        for attempt in range(self.retries + 1):
            if attempt:
                self.sleep(min(8.0, 0.5 * 2 ** (attempt - 1)))
            try:
                request = Request(url, data=data, method=method, headers=request_headers)
                with self.opener(request, timeout=self.timeout) as response:
                    return Reply(response.status, _decode(response.read()), {k.lower(): v for k, v in response.headers.items()})
            except HTTPError as error:
                reply = Reply(error.code, _decode(error.read()), {k.lower(): v for k, v in error.headers.items()})
                if error.code not in RETRYABLE or attempt == self.retries:
                    return reply
                last_error = f'HTTP {error.code}'
            except (URLError, socket.timeout, TimeoutError, ConnectionError) as error:
                last_error = str(getattr(error, 'reason', error))
        raise ScenarioFailed(f'{method} {url} did not answer after {self.retries + 1} attempts: {last_error}')


def _decode(raw: bytes):
    text = raw.decode('utf-8', errors='replace')
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


class Run:
    """A manifest plus the means to act on it. The publication key lives here, never in the manifest."""

    def __init__(self, manifest: RunManifest, transport: Transport | None = None, publish_key: str | None = None, log=print):
        self.manifest, self.transport, self.publish_key, self.log = manifest, transport or Transport(), publish_key, log

    def base(self, target: str) -> str:
        url = self.manifest.endpoints.get(target)
        if not url:
            raise ScenarioFailed(f'no {target} URL configured for this run')
        return url.rstrip('/')

    def record(self, key: str, method: str, target: str, path: str, body) -> dict:
        """Persist the exact request before it is sent. Resuming must reproduce it byte for byte."""
        for existing in self.manifest.requests:
            if existing['key'] == key:
                if (existing['method'], existing['target'], existing['path'], existing['body']) != (method, target, path, body):
                    raise ManifestError(f'request {key!r} differs from the one this run already recorded')
                return existing
        entry = {'key': key, 'method': method, 'target': target, 'path': path, 'body': body}
        self.manifest.requests.append(entry)
        self.manifest.save()
        return entry

    def send(self, key: str, method: str, target: str, path: str, body=None, expect=(200,), auth: bool | str = False, step: str | None = None) -> Reply:
        entry = self.record(key, method, target, path, body)
        headers = {}
        if auth:
            token = auth if isinstance(auth, str) else self.publish_key
            if not token:
                raise ScenarioFailed('AUTOMATION_PUBLISH_KEY is not set in this environment (server-side only; never an Expo public variable)')
            headers['Authorization'] = f'Bearer {token}'
        reply = self.transport.call(method, self.base(target) + path, entry['body'], headers)
        ok = reply.status in expect
        self.evidence(step or key, ok, key=key, status=reply.status, expected=list(expect), response=reply.body)
        if not ok:
            raise ScenarioFailed(f'{self.manifest.scenario}: {step or key} ({key}) expected {list(expect)} but received {reply.status}: {_short(reply.body)}')
        return reply

    def get(self, target: str, path: str) -> Reply:
        """Read-only request; not part of the replayable request list."""
        return self.transport.call('GET', self.base(target) + path)

    def evidence(self, step: str, ok: bool, **details) -> None:
        entry = {'step': step, 'ok': ok, **details}
        self.manifest.evidence.append(entry)
        self.manifest.save()
        self.log(json.dumps(entry, sort_keys=True))


def _short(body) -> str:
    text = body if isinstance(body, str) else json.dumps(body)
    return text if len(text) <= 300 else text[:300] + '…'
