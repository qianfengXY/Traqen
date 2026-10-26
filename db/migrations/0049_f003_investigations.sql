CREATE TABLE f003_investigation (
  workspace_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  operation_id text NOT NULL,
  request_digest text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  state text NOT NULL CHECK (state IN ('QUEUED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  worker_id text,
  lease_until timestamptz,
  source_input jsonb NOT NULL,
  profile jsonb NOT NULL,
  payload jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{"readBytes":0,"modelCalls":0}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,actor_id,operation_id)
);
CREATE INDEX f003_investigation_queue ON f003_investigation(state,lease_until,created_at);

CREATE TABLE f003_investigation_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id text NOT NULL,
  investigation_id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,investigation_id) REFERENCES f003_investigation(workspace_id,id)
);
CREATE TRIGGER f003_immutable_investigation_event BEFORE UPDATE OR DELETE ON f003_investigation_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TABLE f003_checkpoint (
  workspace_id text NOT NULL,
  investigation_id text NOT NULL,
  generation integer NOT NULL,
  checkpoint_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,investigation_id,generation,checkpoint_key),
  FOREIGN KEY (workspace_id,investigation_id) REFERENCES f003_investigation(workspace_id,id)
);
CREATE TRIGGER f003_immutable_checkpoint BEFORE UPDATE OR DELETE ON f003_checkpoint
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
