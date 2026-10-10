ALTER TABLE derived_hazards DROP CONSTRAINT derived_hazards_kind_check;
ALTER TABLE derived_hazards ADD CONSTRAINT derived_hazards_kind_check CHECK (kind IN ('braking', 'surface', 'abandoned'));

-- Latest evaluation's per-cell traffic rates (private; rides per day). Replaced on each evaluation.
CREATE TABLE cells (
    cell text PRIMARY KEY,
    resolution integer NOT NULL,
    window_end timestamptz NOT NULL,
    baseline_rate double precision NOT NULL,
    recent_rate double precision NOT NULL,
    flagged boolean NOT NULL,
    geometry geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX cells_flagged_idx ON cells (flagged) WHERE flagged;
