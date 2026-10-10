import type { components } from './schema';

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Hazards = components['schemas']['HazardCollection'];

/** Stable across renders; neither a delayed submit nor an old response can restore old bounds. */
export function createHazardRefresh(
  currentRegion: () => Region,
  load: (region: Region) => Promise<Hazards>,
  apply: (result: Hazards) => void,
  fail: (error: unknown) => void,
) {
  let latestRequest = 0;
  return async () => {
    const region = currentRegion();
    const request = ++latestRequest;
    const isCurrent = () => request === latestRequest && region === currentRegion();
    try {
      const result = await load(region);
      if (isCurrent()) apply(result);
    } catch (error) {
      if (isCurrent()) fail(error);
    }
  };
}
