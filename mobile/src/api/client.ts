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
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}
export const getHazards = (bbox: string) => fixtureMode ? Promise.resolve(fixtures) : request<HazardCollection>(`/v1/hazards?bbox=${encodeURIComponent(bbox)}`);
export const submitReport = (body: Report) => {
  if (fixtureMode) throw new Error('Connect EXPO_PUBLIC_API_URL to submit reports.');
  return request<components['schemas']['ReportReceipt']>('/v1/reports', body);
};
export const getRoutes = () => fixtureMode ? Promise.resolve(routeFixture as RouteResponse) : request<RouteResponse>('/v1/route', {
  origin: { lat: 33.7531, lon: -84.3853 }, destination: { lat: 33.7560, lon: -84.3880 },
});
