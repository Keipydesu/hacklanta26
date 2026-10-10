/** Only the latest usable foreground fix is kept; no ride history or route endpoint mutation. */
export type LivePosition = { lat: number; lon: number; accuracy: number; timestamp: number };
export const POSITION_MAX_AGE_MS = 20_000;
export function livePosition(fix: {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null };
}, now: number, previous: LivePosition | null): LivePosition | null {
  const { latitude: lat, longitude: lon, accuracy } = fix.coords;
  const { timestamp } = fix;
  if (![lat, lon, accuracy, timestamp].every(v => typeof v === 'number' && Number.isFinite(v)) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy === null || accuracy < 0 || accuracy > 50 ||
      timestamp > now + 1000 || now - timestamp > POSITION_MAX_AGE_MS ||
      (previous && timestamp <= previous.timestamp)) return previous;
  return { lat, lon, accuracy, timestamp };
}
export const freshPosition = (position: LivePosition | null, now: number): LivePosition | null =>
  position && now - position.timestamp <= POSITION_MAX_AGE_MS ? position : null;
