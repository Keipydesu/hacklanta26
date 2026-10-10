export type LocateResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'denied' | 'unavailable' };
export interface LocationApi {
  requestForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{ coords: { latitude: number; longitude: number } }>;
}
/** One-shot lookup, called only after the user asks or opens a trip (decision 020). Never starts continuous updates. */
export async function locateOnce(api: LocationApi, balancedAccuracy: number, onPermissionGranted?: () => void): Promise<LocateResult> {
  try {
    if (!(await api.requestForegroundPermissionsAsync()).granted) return { ok: false, reason: 'denied' };
    onPermissionGranted?.();
    const { coords } = await api.getCurrentPositionAsync({ accuracy: balancedAccuracy });
    return { ok: true, lat: coords.latitude, lon: coords.longitude };
  } catch { return { ok: false, reason: 'unavailable' }; }
}
