CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE events (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    type text NOT NULL CHECK (type IN ('hard_brake', 'bump')),
    ts timestamptz NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    source text NOT NULL CHECK (source IN ('device', 'simulated', 'replay')),
    payload jsonb NOT NULL
);
CREATE INDEX events_type_ts_idx ON events (type, ts);
CREATE INDEX events_location_idx ON events USING gist (location);

CREATE TABLE points (
    id uuid PRIMARY KEY,
    ride_id uuid NOT NULL,
    ts timestamptz NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    source text NOT NULL CHECK (source IN ('device', 'simulated', 'replay')),
    payload jsonb NOT NULL
);
CREATE INDEX points_ride_ts_idx ON points (ride_id, ts);
CREATE INDEX points_ts_idx ON points (ts);  -- abandonment scans the last 14 days

-- Durable recompute marker: ingestion bumps dirty_seq in the same transaction as the observations.
CREATE TABLE worker_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    dirty_seq bigint NOT NULL DEFAULT 0,
    evaluated_seq bigint NOT NULL DEFAULT 0,
    last_evaluated_at timestamptz
);
INSERT INTO worker_state DEFAULT VALUES;

CREATE TABLE derived_hazards (
    external_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('braking', 'surface')),
    geometry geometry(Polygon, 4326) NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'resolved')),
    revision integer NOT NULL CHECK (revision >= 1),   -- latest allocated revision
    public_body jsonb NOT NULL,                        -- latest enqueued full publication body
    product_hazard_id uuid                             -- public ID from the product receipt
);
CREATE INDEX derived_active_idx ON derived_hazards (kind) WHERE status = 'active';
CREATE INDEX derived_geometry_idx ON derived_hazards USING gist (geometry);

CREATE TABLE outbox (
    external_id uuid NOT NULL,
    revision integer NOT NULL,
    body jsonb NOT NULL,                               -- immutable; never contains credentials
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'delivered', 'blocked')),
    attempts integer NOT NULL DEFAULT 0,
    due_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (external_id, revision)
);
CREATE INDEX outbox_due_idx ON outbox (due_at) WHERE state IN ('pending', 'sending');
