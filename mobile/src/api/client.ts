import type { components } from './schema';
import hazardFixture from '../fixtures/hazards.json';
import routeFixture from '../fixtures/route.json';
export type HazardCollection = components['schemas']['HazardCollection'];
export type Report = components['schemas']['ManualReport'];
export type RouteResponse = components['schemas']['RouteResponse'];
export const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
export const fixtureMode = !apiUrl;
const loadedAt = Date.now();
const referenceTime = Date.parse('2026-10-10T01:23:45Z');
const fixtures = JSON.parse(JSON.stringify(hazardFixture)) as HazardCollection;
for (const feature of fixtures.features) {
  for (const field of ['first_seen', 'last_seen', 'expires_at'] as const) {
    feature.properties[field] = new Date(Date.parse(feature.properties[field]) + loadedAt - referenceTime).toISOString();
  }
}
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterSeconds?: number) { super(message); }
  // 4xx other than timeout/rate limit means resending the same body cannot succeed.
  get permanent() { return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429; }
}
const REQUEST_TIMEOUT_MS = 15000;
async function request<T>(path: string, body?: unknown): Promise<T> {
  // A hung connection must surface as a retryable failure, not leave a report stuck in "sending".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new ApiError(response.status, `API ${response.status}: ${await response.text()}`, Number.isFinite(retryAfter) && response.headers.get('Retry-After') ? retryAfter : undefined);
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}
export const getHazards = (bbox: string) => fixtureMode ? Promise.resolve(fixtures) : request<HazardCollection>(`/v1/hazards?bbox=${encodeURIComponent(bbox)}`);
export const submitReport = (body: Report) => {
  if (fixtureMode) throw new Error('Connect EXPO_PUBLIC_API_URL to submit reports.');
  return request<components['schemas']['ReportReceipt']>('/v1/reports', body);
};
export const getRoutes = () => fixtureMode ? Promise.resolve(routeFixture as RouteResponse) : request<RouteResponse>('/v1/route', {
  origin: { lat: 33.7531, lon: -84.3853 }, destination: { lat: 33.7560, lon: -84.3880 },
});
