export type LocateResult =
  | { ok: true; lat: number; lon: number; timestamp?: number }
  | { ok: false; reason: 'denied' | 'unavailable' };
export interface LocationApi {
  requestForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{ timestamp?: number; coords: { latitude: number; longitude: number } }>;
}
export async function requestForegroundPermission(api: Pick<LocationApi, 'requestForegroundPermissionsAsync'>, onPermissionGranted?: () => void): Promise<boolean> {
  const { granted } = await api.requestForegroundPermissionsAsync();
  if (granted) onPermissionGranted?.();
  return granted;
}

/** One-shot lookup, called only after the user asks or opens a trip (decision 020). Never starts continuous updates. */
export async function locateOnce(api: LocationApi, balancedAccuracy: number, onPermissionGranted?: () => void): Promise<LocateResult> {
  try {
    if (!(await requestForegroundPermission(api, onPermissionGranted))) return { ok: false, reason: 'denied' };
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
