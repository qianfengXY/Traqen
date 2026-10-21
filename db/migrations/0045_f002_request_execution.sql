ALTER TABLE f002_request
  ADD COLUMN request_input jsonb,
  ADD COLUMN generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  ADD COLUMN worker_id text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN diagnostic jsonb;

ALTER TABLE f002_request
  ADD CONSTRAINT f002_request_input_object CHECK (request_input IS NULL OR jsonb_typeof(request_input) = 'object');

CREATE INDEX f002_request_claimable ON f002_request(workspace_id,state,lease_until,created_at);
