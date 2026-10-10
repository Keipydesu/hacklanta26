/**
 * Opt-in local diagnostic recorder. Raw motion and untrimmed GPS never go to the ingestion API;
 * they are written only to files on the phone, and only when the rider deliberately enables
 * recording for a ride.
 *
 * Format agreed with the simulator's replay adapter:
 *   motion.csv  t_ms,ax,ay,az,gx,gy,gz          epoch ms; gravity-removed acceleration and gravity, m/s²
 *   gps.csv     t_ms,lat,lon,speed_mps,accuracy_m  blank speed/accuracy = unknown (never zero)
 *   labels.csv  t_ms,type                        optional manual labels
 *   meta.json   ride id, units and `trimmed: false`
 *
 * A recording is raw: it contains the ride's endpoints. Remove the first and last 100 m (and the
 * events inside them) and set `trimmed: true` before it leaves the phone's owner. Never commit a
 * raw recording.
 */
import type { LocationFix, MotionSample } from '../../../detector/index';

export const MOTION_HEADER = 't_ms,ax,ay,az,gx,gy,gz';
export const GPS_HEADER = 't_ms,lat,lon,speed_mps,accuracy_m';
export const LABEL_HEADER = 't_ms,type';
/** Samples buffered before a part file is written (10 s of 50 Hz motion). */
export const FLUSH_ROWS = 500;

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6))));
const coord = (v: number) => v.toFixed(7);
const optional = (v: number | null) => (v === null ? '' : num(v));

export const motionRow = (s: MotionSample) =>
  [s.t_ms, num(s.accel.x), num(s.accel.y), num(s.accel.z), num(s.gravity.x), num(s.gravity.y), num(s.gravity.z)].join(',');
export const gpsRow = (f: LocationFix) => [f.t_ms, coord(f.lat), coord(f.lon), optional(f.speed_mps), optional(f.accuracy_m)].join(',');
export const labelRow = (tMs: number, type: string) => `${tMs},${type.replace(/[,\r\n]/g, ' ')}`;

/** Where files go. Every call writes one complete new file; nothing is appended or uploaded. */
export interface FileSink { write(directory: string, name: string, contents: string): Promise<void> }

export function createRecorder(sink: FileSink) {
  let directory: string | null = null;
  let motion: string[] = [], gps: string[] = [], labels: string[] = [];
  let parts = { motion: 0, gps: 0, labels: 0 };
  let writes: Promise<void> = Promise.resolve();
  let error: string | undefined;

  const part = (n: number) => String(n).padStart(4, '0');
  function write(name: string, contents: string): void {
    const target = directory;
    if (!target) return;
    writes = writes.then(() => sink.write(target, name, contents)).catch(e => { error = `Recording write failed: ${String(e)}`; });
  }
  function flush(kind: 'motion' | 'gps' | 'labels', force: boolean): void {
    const rows = kind === 'motion' ? motion : kind === 'gps' ? gps : labels;
    if (!rows.length || (!force && rows.length < FLUSH_ROWS)) return;
    const header = kind === 'motion' ? MOTION_HEADER : kind === 'gps' ? GPS_HEADER : LABEL_HEADER;
    write(`${kind}-${part(parts[kind]++)}.csv`, `${header}\n${rows.join('\n')}\n`);
    if (kind === 'motion') motion = []; else if (kind === 'gps') gps = []; else labels = [];
  }

  return {
    get active(): boolean { return directory !== null; },
    get error(): string | undefined { return error; },
    start(rideId: string, startedAtMs: number, source: string): void {
      if (directory) return;
      directory = `ride-${rideId}`;
      motion = []; gps = []; labels = []; parts = { motion: 0, gps: 0, labels: 0 }; error = undefined;
      write('meta.json', JSON.stringify({
        format: 1, ride_id: rideId, started_at: new Date(startedAtMs).toISOString(), source,
        trimmed: false, note: 'Raw local diagnostic recording. Contains ride endpoints. Do not share or commit untrimmed.',
        motion: { header: MOTION_HEADER, units: 'epoch ms; m/s^2; accel is gravity-removed' },
        gps: { header: GPS_HEADER, units: 'epoch ms; degrees; m/s; m; blank = unknown' },
        labels: { header: LABEL_HEADER },
      }, null, 2));
    },
    motion(sample: MotionSample): void { if (directory) { motion.push(motionRow(sample)); flush('motion', false); } },
    location(fix: LocationFix): void { if (directory) { gps.push(gpsRow(fix)); flush('gps', false); } },
    label(tMs: number, type: string): void { if (directory) { labels.push(labelRow(tMs, type)); flush('labels', false); } },
    /** Write what is buffered and close the recording. Resolves once every file write settled. */
    async stop(): Promise<string | null> {
      const finished = directory;
      if (!finished) return null;
      flush('motion', true); flush('gps', true); flush('labels', true);
      directory = null;
      await writes;
      return finished;
    },
  };
}
export type Recorder = ReturnType<typeof createRecorder>;
