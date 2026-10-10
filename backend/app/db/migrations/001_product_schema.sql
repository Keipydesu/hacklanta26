CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE manual_reports (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('pothole', 'obstruction', 'closure', 'other')),
    location geometry(Point, 4326) NOT NULL,
    observed_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    description text NOT NULL DEFAULT '',
    payload jsonb NOT NULL
);

CREATE TABLE hazards (
    id uuid PRIMARY KEY,
    source text NOT NULL CHECK (source IN ('manual', 'automatic')),
    kind text NOT NULL CHECK (kind IN ('pothole', 'obstruction', 'closure', 'other', 'braking', 'surface', 'abandoned')),
    geometry geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(geometry)),
    label text NOT NULL,
    score double precision NOT NULL CHECK (score >= 0 AND score <= 1),
    status text NOT NULL CHECK (status IN ('active', 'resolved')),
    first_seen timestamptz NOT NULL,
    last_seen timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    event_count integer NOT NULL CHECK (event_count >= 0),
    ride_count integer NOT NULL CHECK (ride_count >= 0),
    report_count integer NOT NULL CHECK (report_count >= 0),
    evidence_source text CHECK (evidence_source IN ('device', 'simulated', 'replay', 'mixed')),
    -- Manual linkage: at most one hazard per report.
    manual_report_id uuid UNIQUE REFERENCES manual_reports (id),
    -- Publication identity. Rows are never deleted on expiry, so accepted revisions persist.
    publisher text,
    external_id uuid,
    revision integer CHECK (revision >= 1),
    publication jsonb,
    -- The expires_at value for which a lifecycle hint was last recorded; lets the scan be repeat-safe.
    expiry_notified_for timestamptz,
    UNIQUE (publisher, external_id),
    CHECK (first_seen <= last_seen AND last_seen <= expires_at),
    CHECK (
        (source = 'manual' AND manual_report_id IS NOT NULL AND publisher IS NULL AND external_id IS NULL
            AND revision IS NULL AND publication IS NULL AND report_count = 1 AND event_count = 0
            AND ride_count = 0 AND evidence_source IS NULL)
        OR
        (source = 'automatic' AND manual_report_id IS NULL AND publisher IS NOT NULL AND external_id IS NOT NULL
            AND revision IS NOT NULL AND publication IS NOT NULL AND report_count = 0
            AND evidence_source IS NOT NULL)
    )
);

CREATE INDEX hazards_geometry_idx ON hazards USING gist (geometry);
-- Only rows the expiry scan still has to notify; notified rows leave the index.
CREATE INDEX hazards_active_expiry_idx ON hazards (expires_at)
    WHERE status = 'active' AND expiry_notified_for IS DISTINCT FROM expires_at;
