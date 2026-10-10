/** GPS quality control and the speed/position lookups the brake and bump detectors need. */
export type LocationFix = { t_ms: number; lat: number; lon: number; speed_mps: number | null; accuracy_m: number | null };
/** A fix that passed quality control: finite coordinates and a known accuracy within the limit. */
export type GoodFix = { t_ms: number; lat: number; lon: number; speed_mps: number | null; accuracy_m: number };
export type SpeedFix = GoodFix & { speed_mps: number };

/** How long accepted fixes are retained behind the newest one. */
export const LOCATION_HORIZON_MS = 8000;
/** A fix further than this from the moment of interest says nothing about it. */
export const MAX_FIX_DISTANCE_MS = 3000;

const hasSpeed = (fix: GoodFix): fix is SpeedFix => fix.speed_mps !== null;

export class LocationTrack {
  private fixes: GoodFix[] = [];
  private newest: number | null = null;
  constructor(private readonly maxAccuracyM: number) {}

  /**
   * Returns false for a duplicate/out-of-order timestamp. A poor or malformed fix still advances
   * the location clock (so pending detections can expire) but is never stored: unknown accuracy
   * is not good accuracy, and a negative or nonfinite speed is unknown, not zero.
   */
  push(fix: LocationFix): boolean {
    if (!fix || !Number.isFinite(fix.t_ms)) return false;
    if (this.newest !== null && fix.t_ms <= this.newest) return false;
    this.newest = fix.t_ms;
    const cutoff = fix.t_ms - LOCATION_HORIZON_MS;
    let drop = 0;
    while (drop < this.fixes.length && this.fixes[drop].t_ms < cutoff) drop++;
    if (drop) this.fixes.splice(0, drop);
    const { lat, lon, accuracy_m: accuracy } = fix;
    const located = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!located || accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > this.maxAccuracyM) return true;
    const speed = fix.speed_mps !== null && Number.isFinite(fix.speed_mps) && fix.speed_mps >= 0 ? fix.speed_mps : null;
    this.fixes.push({ t_ms: fix.t_ms, lat, lon, speed_mps: speed, accuracy_m: accuracy });
    return true;
  }

  /** Newest location timestamp seen, including rejected fixes. */
  get latestMs(): number | null { return this.newest; }

  /** Latest fix with known speed at or before `t`, no older than `maxAgeMs`. */
  speedAtOrBefore(t: number, maxAgeMs = MAX_FIX_DISTANCE_MS): SpeedFix | null {
    for (let i = this.fixes.length - 1; i >= 0; i--) {
      const fix = this.fixes[i];
      if (fix.t_ms > t) continue;
      if (t - fix.t_ms > maxAgeMs) return null;
      if (hasSpeed(fix)) return fix;
    }
    return null;
  }

  /** Earliest fix with known speed in (t, t + maxAgeMs]. */
  speedAfter(t: number, maxAgeMs = MAX_FIX_DISTANCE_MS): SpeedFix | null {
    for (const fix of this.fixes) {
      if (fix.t_ms <= t) continue;
      if (fix.t_ms - t > maxAgeMs) return null;
      if (hasSpeed(fix)) return fix;
    }
    return null;
  }

  /** Slowest known-speed fix in (from, to]; the earliest one wins a tie. */
  slowestIn(from: number, to: number): SpeedFix | null {
    let slowest: SpeedFix | null = null;
    for (const fix of this.fixes) {
      if (fix.t_ms <= from || fix.t_ms > to || !hasSpeed(fix)) continue;
      if (!slowest || fix.speed_mps < slowest.speed_mps) slowest = fix;
    }
    return slowest;
  }

  /**
   * Fix nearest in time to `t`, within `maxDistanceMs`. Equal distances resolve to the earlier
   * fix. Returns null rather than inventing a position.
   */
  locatePeak(t: number, maxDistanceMs = MAX_FIX_DISTANCE_MS): GoodFix | null {
    let best: GoodFix | null = null, bestDistance = Infinity;
    for (const fix of this.fixes) {
      const distance = Math.abs(fix.t_ms - t);
      if (distance <= maxDistanceMs && distance < bestDistance) { best = fix; bestDistance = distance; }
    }
    return best;
  }

  clear(): void { this.fixes = []; this.newest = null; }
}
