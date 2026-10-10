import { cellBbox, type NearbyFeature } from './nearby';

export type HazardSelection<F extends NearbyFeature> = {
  feature: F;
  available: boolean;
  error?: string;
};

export const selectionAvailable = <F extends NearbyFeature>(selection: HazardSelection<F> | null, now: number) =>
  !!selection && selection.available && selection.feature.properties.status === 'active'
    && Date.parse(selection.feature.properties.expires_at) > now;

/** A selected hazard is independent of the viewport. Keep its snapshot after removal for receipts. */
export function createHazardSelection<F extends NearbyFeature>(deps: {
  load(bbox: string): Promise<{ features: F[] }>;
  onChange(selection: HazardSelection<F> | null): void;
}) {
  let current: HazardSelection<F> | null = null;
  let generation = 0;
  let active = true;
  const set = (next: HazardSelection<F> | null) => { current = next; deps.onChange(next); };

  async function refresh() {
    if (!active || !current) return;
    const selected = current.feature;
    const mine = ++generation;
    // This is public hazard geometry, not the rider's position. Reuse the coarse grid query.
    const [lon, lat] = selected.geometry.coordinates[0][0];
    try {
      const result = await deps.load(cellBbox({ lon, lat }));
      if (mine !== generation || !active || !current) return;
      const found = result.features.find(h => h.properties.id === selected.properties.id);
      set({ feature: found ?? current.feature, available: !!found });
    } catch {
      if (mine !== generation || !active || !current) return;
      set({ ...current, error: 'Could not refresh this hazard. Showing its last known status.' });
    }
  }

  return {
    state: () => current,
    select(feature: F) {
      generation++;
      set({ feature, available: true });
      return refresh();
    },
    clear() { generation++; set(null); },
    refresh,
    setActive(next: boolean) {
      active = next;
      generation++;
      return next ? refresh() : Promise.resolve();
    },
  };
}
