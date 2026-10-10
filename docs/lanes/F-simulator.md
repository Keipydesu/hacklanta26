# Lane F: Simulator and seed data

Produces the data nobody has yet. Without it there is no baseline traffic, no abandonment signal, and no way to test without riding a scooter.

**Owns:** `simulator/`.
**Uses:** the REST API only. No dependency on Valhalla or the database.

## What to build

1. **Campus routes** (`scenarios/routes.yaml`). Five or six hand-drawn polylines around GSU, each a list of `[lat, lon]` waypoints following real walkways. Trace them on a map by hand. Include two parallel routes between the same endpoints; the closure scenario needs them.
2. **Ride synthesis** (`rides.py`). Given a route and a start time, produce one ride:
   - Interpolate along the polyline at 1 Hz.
   - Speed drawn around 4.5 m/s with some variation, slower near turns.
   - GPS noise of about 4 m on each point, and a matching `accuracy_m`.
   - A fresh random `ride_id`.
   - Start times follow a class-change pattern: peaks near the top of each hour, 8 am to 6 pm, weekdays heavier.
3. **Scenarios** (`scenarios/*.yaml`). Each file lists routes, ride counts, date ranges, event rules, and an `expect:` block that Lane D's tests read.
   - `baseline`: 14 days of rides across all routes, with a 1% random background rate of hard brakes anywhere.
   - `pothole`: at one fixed spot, half of all rides in the last 3 days produce a `hard_brake` within 5 m. `expect` gives the spot and "one braking hazard".
   - `closure`: for the last 48 hours, rides on route R2 drop to 10% and the rest move to the parallel route R3. `expect` gives the closed stretch and "one abandoned hazard".
   - `demo_seed`: two fresh `hard_brake` events from two different rides at the demo spot, so the judge's event is the third.
4. **Generator CLI** (`generate.py`).
   `python -m simulator.generate --api http://localhost:8000 --scenario baseline --seed 42`
   - Deterministic for a given seed.
   - Backdates `ts` relative to the current time.
   - Posts in batches of at most 500 events and 2000 points.
   - Every item carries `source: "simulated"`.
   - `--dry-run` writes the payloads to a file instead of posting.
5. **Replay CLI** (`replay.py`). Reads a recorded ride and posts it with timestamps shifted to now, paced in real time or faster with `--speed 4`. Uses `source: "replay"`. This is the backup if a phone fails during the demo.
6. **Recorded ride format** (`recorded/README.md`). Three files per ride:
   - `<name>.motion.csv`: `t_ms,ax,ay,az,gx,gy,gz` (acceleration without gravity, then gravity, both in m/s²).
   - `<name>.gps.csv`: `t_ms,lat,lon,speed_mps,accuracy_m`.
   - `<name>.labels.csv` (optional): `t_ms,type`, written by hand after the ride.
   Lane A's recorder mode writes the first two. Lane B's tests read all three.
7. **Capture plan.** Get a teammate to record at least three real rides near the venue with deliberate hard stops at known landmarks, and commit them. Do this early: Lane B is blocked on tuning without them.

## Watch out for

- The abandonment rule needs a baseline of at least 5 rides per cell per day. Make baseline volume comfortably higher, around 30 rides per route per day.
- The closure only registers if the parallel route's traffic rises above 130% of its own baseline. Move the diverted riders, do not just delete them.
- Do not apply the 100 m privacy trim here. The simulator stands in for data after the phone has already trimmed it.
- Never mix simulated data into anything presented as real. The `source` field exists so the pitch can state exactly how many rides were real.

## Done when

- `baseline` loads 14 days of rides against a local stack.
- `pothole` and `closure` produce the hazards named in their `expect` blocks once Lane D is in place.
- `replay.py` plays a recorded ride and pins appear on the dashboard in real time.
- Three real recorded rides are committed in `recorded/`.
