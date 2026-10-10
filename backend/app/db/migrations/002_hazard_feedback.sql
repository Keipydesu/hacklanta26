CREATE TABLE hazard_feedback (
    id uuid PRIMARY KEY,
    hazard_id uuid NOT NULL REFERENCES hazards (id),
    response text NOT NULL CHECK (response IN ('still_there', 'gone')),
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hazard_feedback_hazard_idx ON hazard_feedback (hazard_id, received_at, id);
