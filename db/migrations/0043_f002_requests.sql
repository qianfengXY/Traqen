CREATE TABLE f002_request (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES project(id),
  actor_id text NOT NULL REFERENCES principal(id),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  binding_digest text NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  investigation_id text NOT NULL,
  base_version_id text NOT NULL CHECK (base_version_id ~ '^[0-9a-f]{64}$'),
  request_kind text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  outcome text CHECK (outcome IN ('EXISTING_EVIDENCE','NEW_VERSION','LIMITATION','REJECTED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (workspace_id,actor_id,operation_id),
  FOREIGN KEY (workspace_id,base_version_id) REFERENCES f002_fact_set(workspace_id,graph_version_id)
);
CREATE INDEX f002_request_investigation ON f002_request(workspace_id,investigation_id,created_at);

CREATE TABLE f002_request_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id text NOT NULL REFERENCES f002_request(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER f002_immutable_request_event BEFORE UPDATE OR DELETE ON f002_request_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
