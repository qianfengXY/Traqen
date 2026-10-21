-- F002 owns its deterministic records. F001 remains the only owner of source bytes.
CREATE TABLE f002_profile (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  startable boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE f002_run (
  workspace_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  source_input jsonb NOT NULL CHECK (jsonb_typeof(source_input) = 'object'),
  profile_id text NOT NULL REFERENCES f002_profile(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,actor_id,operation_id)
);

CREATE TABLE f002_scope (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  scope_id text NOT NULL CHECK (scope_id ~ '^[0-9a-f]{64}$'),
  label text,
  selections jsonb NOT NULL CHECK (jsonb_typeof(selections) = 'array'),
  status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','READY_TO_SEAL','SEALED','FAILED_RETRYABLE','BLOCKED','CANCELLED')),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  worker_id text,
  lease_until timestamptz,
  seal_operation_id text,
  graph_version_id text CHECK (graph_version_id IS NULL OR graph_version_id ~ '^[0-9a-f]{64}$'),
  diagnostic jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,scope_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES f002_run(workspace_id,id)
);
CREATE INDEX f002_scope_claimable ON f002_scope(workspace_id,status,lease_until);

CREATE TABLE f002_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  scope_id text,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,run_id) REFERENCES f002_run(workspace_id,id),
  FOREIGN KEY (workspace_id,run_id,scope_id) REFERENCES f002_scope(workspace_id,run_id,scope_id)
);
CREATE INDEX f002_event_run ON f002_event(workspace_id,run_id,sequence);
