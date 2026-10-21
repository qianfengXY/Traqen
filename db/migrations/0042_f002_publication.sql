-- Scope work checkpoints are mutable only before their scope is atomically sealed.
CREATE TABLE f002_scope_item (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  scope_id text NOT NULL,
  material_id text NOT NULL,
  capability_id text NOT NULL,
  generation integer NOT NULL CHECK (generation >= 0),
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','DONE','NOT_APPLICABLE','UNSUPPORTED','PARSE_FAILED')),
  record_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(record_ids) = 'array'),
  gap_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gap_ids) = 'array'),
  diagnostic jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,scope_id,material_id,capability_id),
  FOREIGN KEY (workspace_id,run_id,scope_id) REFERENCES f002_scope(workspace_id,run_id,scope_id)
);
CREATE INDEX f002_scope_item_pending ON f002_scope_item(workspace_id,run_id,scope_id,status);

CREATE TABLE f002_prepared_record (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  scope_id text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  kind text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,scope_id,kind,id),
  FOREIGN KEY (workspace_id,run_id,scope_id) REFERENCES f002_scope(workspace_id,run_id,scope_id)
);

CREATE FUNCTION f002_guard_prepared_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM f002_fact_set WHERE workspace_id=COALESCE(NEW.workspace_id,OLD.workspace_id)
    AND run_id=COALESCE(NEW.run_id,OLD.run_id) AND scope_id=COALESCE(NEW.scope_id,OLD.scope_id)) THEN
    RAISE EXCEPTION 'Prepared F002 records are immutable after publication';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER f002_guard_prepared_record_mutation BEFORE INSERT OR UPDATE OR DELETE ON f002_prepared_record
  FOR EACH ROW EXECUTE FUNCTION f002_guard_prepared_record();

CREATE TABLE f002_fact_set (
  workspace_id text NOT NULL,
  graph_version_id text NOT NULL CHECK (graph_version_id ~ '^[0-9a-f]{64}$'),
  run_id text NOT NULL,
  scope_id text NOT NULL,
  profile_id text NOT NULL REFERENCES f002_profile(id),
  bundle_id text NOT NULL CHECK (bundle_id ~ '^[0-9a-f]{64}$'),
  scope_revision integer NOT NULL CHECK (scope_revision > 0),
  record_digest text NOT NULL CHECK (record_digest ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,graph_version_id),
  UNIQUE (workspace_id,run_id,scope_id),
  FOREIGN KEY (workspace_id,run_id,scope_id) REFERENCES f002_scope(workspace_id,run_id,scope_id)
);

CREATE TABLE f002_record (
  workspace_id text NOT NULL,
  graph_version_id text NOT NULL,
  kind text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (workspace_id,graph_version_id,kind,id),
  FOREIGN KEY (workspace_id,graph_version_id) REFERENCES f002_fact_set(workspace_id,graph_version_id)
);

CREATE TABLE f002_replay (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  actor_id text NOT NULL,
  graph_version_id text NOT NULL,
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('MATCH','DIFFERENT','FAILED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,graph_version_id) REFERENCES f002_fact_set(workspace_id,graph_version_id)
);
CREATE INDEX f002_replay_version ON f002_replay(workspace_id,graph_version_id,created_at);

CREATE TRIGGER f002_immutable_fact_set BEFORE UPDATE OR DELETE ON f002_fact_set
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER f002_immutable_record BEFORE UPDATE OR DELETE ON f002_record
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER f002_immutable_replay BEFORE UPDATE OR DELETE ON f002_replay
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
