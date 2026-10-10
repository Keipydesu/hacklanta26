/**
 * First/last 100 m trimming, applied before anything is persisted for upload.
 *
 * Distance travelled is accumulated from quality-controlled fixes. A point is released only when
 * it lies at least `trimM` past the start AND the rider has since travelled another `trimM`
 * beyond it; `finish()` discards whatever is still held, which is exactly the last `trimM`.
 * A ride of 200 m or less therefore uploads nothing.
 *
 * Starting gap/jump policy (to be revisited with device traces, see README):
 * - a fix with unknown accuracy or accuracy worse than `maxAccuracyM` is ignored;
 * - a fix implying more than `maxSpeedMps` from the previous accepted fix is ignored as a jump;
 * - distance only advances when the rider has moved at least `minStepM`, and at least the sum of
 *   both fixes' reported accuracy, from the last fix that advanced it, so GPS jitter while
 *   standing still cannot "walk" the rider out of the private zone. This undercounts winding
 *   paths, which only trims more.
 *
 * Both boundaries are exclusive: a point exactly 100 m from either end is still private.
 */
export type TrimFix = { t_ms: number; lat: number; lon: number; accuracy_m: number | null };
export type Released<P, E> = { points: P[]; events: E[] };
export type TrimOptions = { trimM?: number; maxAccuracyM?: number; maxSpeedMps?: number; minStepM?: number };

const EARTH_RADIUS_M = 6_371_008.8;
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class PrivacyBuffer<P, E> {
  private readonly trimM: number;
  private readonly maxAccuracyM: number;
  private readonly maxSpeedMps: number;
  private readonly minStepM: number;
  /**
   * Accepted fix times with a lower and an upper bound on the distance travelled when each
   * arrived. No coordinates are kept.
   */
  private path: { t: number; lo: number; hi: number }[] = [];
  private last: TrimFix | null = null;
  private anchor: TrimFix | null = null;
  private travelled = 0;
  private heldPoints: { hi: number; payload: P }[] = [];
  /** `hi` is unknown until an accepted fix at or after the event time has been seen. */
  private heldEvents: { t: number; hi: number | null; payload: E }[] = [];
  private dropped = { points: 0, events: 0 };

  constructor(options: TrimOptions = {}) {
    this.trimM = options.trimM ?? 100;
    this.maxAccuracyM = options.maxAccuracyM ?? 20;
    this.maxSpeedMps = options.maxSpeedMps ?? 15;
    this.minStepM = options.minStepM ?? 5;
  }

  /** Lower bound on distance travelled so far. */
  get travelledM(): number { return this.travelled; }
  get held(): { points: number; events: number } { return { points: this.heldPoints.length, events: this.heldEvents.length }; }
  get droppedCounts(): { points: number; events: number } { return { ...this.dropped }; }

  /**
   * Feed one location fix, with the upload payload for it if there is one (a fix with unknown
   * speed still measures distance but cannot become a contract-valid point). Returns whatever
   * became eligible because of the distance this fix added.
   *
   * Because distance advances in steps, each fix gets two bounds: `lo` (the stepped total, used
   * for the start zone) and `hi` (stepped total plus displacement from the last step, used for
   * the end zone). Erring low at the start and high at the end only ever trims more.
   */
  pushFix(fix: TrimFix, point?: P): Released<P, E> {
    const none: Released<P, E> = { points: [], events: [] };
    if (!Number.isFinite(fix.t_ms) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return none;
    if (fix.accuracy_m === null || !Number.isFinite(fix.accuracy_m) || fix.accuracy_m > this.maxAccuracyM) return none;
    if (this.last) {
      const seconds = (fix.t_ms - this.last.t_ms) / 1000;
      if (seconds <= 0) return none;
      if (haversineM(this.last, fix) / seconds > this.maxSpeedMps) return none;
    }
    let beyond = 0;
    if (!this.anchor) {
      this.anchor = fix;
    } else {
      const moved = haversineM(this.anchor, fix);
      if (moved >= Math.max(this.minStepM, fix.accuracy_m + (this.anchor.accuracy_m ?? 0))) { this.travelled += moved; this.anchor = fix; }
      else beyond = moved;
    }
    this.last = fix;
    const lo = this.travelled, hi = this.travelled + beyond;
    this.path.push({ t: fix.t_ms, lo, hi });
    for (const event of this.heldEvents) if (event.hi === null && event.t <= fix.t_ms) event.hi = hi;
    if (point !== undefined) {
      if (lo <= this.trimM) this.dropped.points++;
      else this.heldPoints.push({ hi, payload: point });
    }
    return this.release();
  }

  /**
   * Hold a detected event by where its peak sits on the path, not by when it was delivered. Its
   * position is bracketed by the accepted fixes around `tMs`: the earlier one must already be past
   * the start zone, and the rider must travel `trimM` beyond the later one before release.
   */
  pushEvent(tMs: number, event: E): void {
    let lo: number | null = null, hi: number | null = null;
    for (const entry of this.path) {
      if (entry.t <= tMs) lo = entry.lo;
      if (entry.t >= tMs) { hi = entry.hi; break; }
    }
    if (lo === null || lo <= this.trimM) { this.dropped.events++; return; }
    this.heldEvents.push({ t: tMs, hi, payload: event });
  }

  private release(): Released<P, E> {
    const limit = this.travelled - this.trimM;
    const points: P[] = [], events: E[] = [];
    const keptPoints: typeof this.heldPoints = [];
    for (const point of this.heldPoints) {
      if (point.hi < limit) points.push(point.payload);
      else keptPoints.push(point);
    }
    this.heldPoints = keptPoints;
    const keptEvents: typeof this.heldEvents = [];
    for (const event of this.heldEvents) {
      if (event.hi !== null && event.hi < limit) events.push(event.payload);
      else keptEvents.push(event);
    }
    this.heldEvents = keptEvents;
    return { points, events };
  }

  /**
   * End of ride, or any interruption after which the true end point is unknown: everything
   * still held is inside the trailing zone (or might be) and is discarded.
   */
  finish(): { points: number; events: number } {
    const discarded = { points: this.heldPoints.length, events: this.heldEvents.length };
    this.dropped.points += discarded.points; this.dropped.events += discarded.events;
    this.heldPoints = []; this.heldEvents = []; this.path = [];
    this.last = null; this.anchor = null; this.travelled = 0;
    return discarded;
  }
}
