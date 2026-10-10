/** Time-indexed buffers. Everything is driven by pushed timestamps; nothing reads a wall clock. */

/**
 * Time-weighted moving average over the trailing `windowMs`.
 *
 * Each sample is held back to the previous sample (capped at `maxHoldMs`), so irregular spacing
 * weights samples by the time they represent rather than by how many callbacks fired. `mean()`
 * returns null until at least `minCoverage` of the window is actually covered by samples: missing
 * sensor time never counts as sustained acceleration.
 */
export class TimeWeightedWindow {
  private items: { t: number; hold: number; value: number }[] = [];
  constructor(
    private readonly windowMs: number,
    private readonly maxHoldMs: number,
    private readonly minCoverage = 0.75,
  ) {}

  push(t: number, value: number): void {
    const last = this.items[this.items.length - 1];
    if (last && t <= last.t) return;
    const hold = last ? Math.min(t - last.t, this.maxHoldMs) : 0;
    this.items.push({ t, hold, value });
    const cutoff = t - this.windowMs;
    let drop = 0;
    while (drop < this.items.length && this.items[drop].t <= cutoff) drop++;
    if (drop) this.items.splice(0, drop);
  }

  /** Mean over (now - windowMs, now], where now is the newest pushed timestamp. */
  mean(): number | null {
    const last = this.items[this.items.length - 1];
    if (!last) return null;
    const from = last.t - this.windowMs;
    let covered = 0, integral = 0;
    for (const item of this.items) {
      const overlap = item.t - Math.max(item.t - item.hold, from);
      if (overlap > 0) { covered += overlap; integral += overlap * item.value; }
    }
    if (covered < this.windowMs * this.minCoverage) return null;
    return integral / covered;
  }

  clear(): void { this.items = []; }
}
