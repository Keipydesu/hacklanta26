/** Zero-based retry index; cap applies before the shared 50–100% jitter. */
export function jitteredBackoffMs(retryIndex: number, random: number, capMs: number): number {
  return Math.min(capMs, 1000 * 2 ** retryIndex) * (0.5 + random / 2);
}
