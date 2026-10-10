export type LocateResult =
  | { ok: true; lat: number; lon: number; timestamp?: number }
  | { ok: false; reason: 'denied' | 'unavailable' };
export interface LocationApi {
  requestForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{ timestamp?: number; coords: { latitude: number; longitude: number } }>;
}
/** One-shot lookup, called only after the user asks. Never starts continuous updates. */
export async function locateOnce(api: LocationApi, balancedAccuracy: number): Promise<LocateResult> {
  try {
    if (!(await api.requestForegroundPermissionsAsync()).granted) return { ok: false, reason: 'denied' };
    return await locatePosition(api, balancedAccuracy);
  } catch { return { ok: false, reason: 'unavailable' }; }
}

/** Position-only phase so report lookup deadlines exclude the permission dialog. */
export async function locatePosition(api: LocationApi, balancedAccuracy: number): Promise<LocateResult> {
  try {
    const { coords, timestamp } = await api.getCurrentPositionAsync({ accuracy: balancedAccuracy });
    return { ok: true, lat: coords.latitude, lon: coords.longitude, ...(timestamp === undefined ? {} : { timestamp }) };
  } catch { return { ok: false, reason: 'unavailable' }; }
}
