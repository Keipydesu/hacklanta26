import type { components } from './schema';

type Hazards = components['schemas']['HazardCollection'];

/**
 * Stable across renders; neither a delayed submit nor an old response can restore old bounds.
 * The viewport is compared by identity, so the caller must keep one object per settled viewport.
 */
export function createHazardRefresh<Viewport>(
  currentRegion: () => Viewport,
  load: (region: Viewport) => Promise<Hazards>,
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
