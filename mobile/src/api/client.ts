import type { components } from './schema';
import hazardFixture from '../fixtures/hazards.json';
import routeFixture from '../fixtures/route.json';
import placeFixture from '../fixtures/places.json';
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
async function call<T>(path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
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
    // Keep the deadline alive through body consumption, not just response headers.
    const data = await response.json() as T;
    return { data, headers: response.headers };
  } finally { clearTimeout(timer); }
}
const request = async <T>(path: string, body?: unknown): Promise<T> => (await call<T>(path, body)).data;
export const getHazards = (bbox: string) => fixtureMode ? Promise.resolve(fixtures) : request<HazardCollection>(`/v1/hazards?bbox=${encodeURIComponent(bbox)}`);
export const submitReport = (body: Report) => {
  if (fixtureMode) throw new Error('Connect EXPO_PUBLIC_API_URL to submit reports.');
  return request<components['schemas']['ReportReceipt']>('/v1/reports', body);
};
export type Place = components['schemas']['Place'];
/** Trip endpoint search. The offline preview filters the fixture places instead of calling the API. */
export async function searchPlaces(query: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  if (fixtureMode) {
    const needle = query.trim().toLowerCase();
    return (placeFixture.places as Place[]).filter(p => `${p.name} ${p.address}`.toLowerCase().includes(needle));
  }
  const params = new URLSearchParams({ q: query });
  if (near) params.set('near', `${near.lat.toFixed(3)},${near.lon.toFixed(3)}`);
  return (await request<components['schemas']['PlaceResults']>(`/v1/places?${params}`)).places;
}
export type HazardFeedback = components['schemas']['HazardFeedback'];
export type FeedbackReceipt = components['schemas']['FeedbackReceipt'];
export const submitFeedback = (hazardId: string, body: HazardFeedback) => {
  if (fixtureMode) throw new Error('Connect EXPO_PUBLIC_API_URL to answer hazard checks.');
  return request<FeedbackReceipt>(`/v1/hazards/${encodeURIComponent(hazardId)}/feedback`, body);
};
export type Coordinate = components['schemas']['Coordinate'];
/**
 * Routes for the selected pair. Only the explicitly offline preview may show fixture routes.
 */
export async function getRoutes(origin: Coordinate, destination: Coordinate): Promise<{ response: RouteResponse; illustrative: boolean }> {
  if (fixtureMode) return { response: routeFixture as RouteResponse, illustrative: true };
  const response = await call<RouteResponse>('/v1/route', { origin, destination });
  if (response.headers.get('X-Stage-0-Stub') !== null) {
    throw new ApiError(503, 'Routing is unavailable right now.');
  }
  return { response: response.data, illustrative: false };
}
export type Health = components['schemas']['Health'];
export const getHealth = () => request<Health>('/healthz');
