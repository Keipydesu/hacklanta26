# Recorded rides

No recordings are checked in. Nothing here is a real ride.

A recording is a directory written by the collector's opt-in recorder (or synthesized for tests):

| File | Columns |
|---|---|
| `motion*.csv` | `t_ms,ax,ay,az,gx,gy,gz` — epoch ms; gravity-removed acceleration and gravity, m/s² |
| `gps*.csv` | `t_ms,lat,lon,speed_mps,accuracy_m` — a blank speed or accuracy is unknown, never zero |
| `labels*.csv` | `t_ms,type` — optional, manually reviewed labels |
| `meta.json` | must contain `"trimmed": true` before any upload or sharing |

Rules:

- A raw recording contains the ride's start and end. Run
  `PYTHONPATH=simulator/src python3 -m simulator.cli trim --recording RAW --out TRIMMED` to drop the first and last 100 m
  (and the labels inside them), then review the result. The tool refuses to trim twice and refuses
  a ride of 200 m or less.
- `replay` refuses any recording not marked trimmed.
- Only commit a recording that is consented, trimmed and reviewed. Never commit a raw one.
- Synthetic recordings (`replay-detector/synthetic.mjs`) test the plumbing only. They say nothing
  about detector accuracy on real scooters.
