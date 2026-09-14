-- F001 v1 is separate from the legacy understanding snapshot and record APIs.
CREATE TABLE source_truth_workspace (
  workspace_id text PRIMARY KEY REFERENCES project(id),
  tenant_id text NOT NULL REFERENCES tenant(id),
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  backup_barrier boolean NOT NULL DEFAULT false,
  restore_ready boolean NOT NULL DEFAULT true
);

CREATE TABLE source_truth_access (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  actor_id text NOT NULL REFERENCES principal(id),
  role text NOT NULL CHECK (role IN ('READ','MAINTAIN','REVOKED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (workspace_id, actor_id)
);

CREATE TABLE source_truth_draft (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  revision integer NOT NULL CHECK (revision > 0),
  actor_id text NOT NULL REFERENCES principal(id),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, revision)
);

CREATE TABLE source_truth_run (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  draft_revision integer NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  policy_revision_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'PREFLIGHTING','ENUMERATING','MANIFEST_FROZEN','CAPTURING','RECONCILING',
    'WAITING_FOR_CLIENT','REVIEW_REQUIRED','PREPARING_SEAL','FINALIZING',
    'CANCELLING','CANCELLED','BLOCKED','FAILED_RETRYABLE','SUCCEEDED'
  )),
  station integer NOT NULL CHECK (station BETWEEN 3 AND 8),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  worker_id text,
  lease_until timestamptz,
  retry_of text,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostic jsonb,
  publication_operation_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, draft_revision) REFERENCES source_truth_draft(workspace_id, revision),
  FOREIGN KEY (workspace_id, retry_of) REFERENCES source_truth_run(workspace_id, id)
);

CREATE UNIQUE INDEX source_truth_one_active_run ON source_truth_run(workspace_id)
  WHERE status NOT IN ('CANCELLED','BLOCKED','FAILED_RETRYABLE','SUCCEEDED');

CREATE TABLE source_truth_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  run_id text,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, run_id) REFERENCES source_truth_run(workspace_id, id)
);
CREATE INDEX source_truth_event_run ON source_truth_event(workspace_id, run_id, sequence);

CREATE TABLE source_truth_bundle (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL CHECK (id ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TRIGGER source_truth_immutable_draft BEFORE UPDATE OR DELETE ON source_truth_draft
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_event BEFORE UPDATE OR DELETE ON source_truth_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_bundle BEFORE UPDATE OR DELETE ON source_truth_bundle
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TABLE source_truth_run_source (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('GIT','DIRECTORY_UPLOAD')),
  source jsonb NOT NULL,
  enumeration_closed boolean NOT NULL DEFAULT false,
  manifest_id text,
  PRIMARY KEY (workspace_id,run_id,source_id),
  UNIQUE (workspace_id,run_id,kind),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id)
);

CREATE TABLE source_truth_entry (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  path_bytes bytea NOT NULL,
  entry jsonb NOT NULL,
  disposition jsonb,
  PRIMARY KEY (workspace_id,run_id,source_id,path_bytes),
  FOREIGN KEY (workspace_id,run_id,source_id) REFERENCES source_truth_run_source(workspace_id,run_id,source_id)
);

CREATE TABLE source_truth_manifest_shard (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  manifest_id text NOT NULL CHECK (manifest_id ~ '^[0-9a-f]{64}$'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (workspace_id,manifest_id,ordinal)
);

-- The manifest header is a completion record, inserted only after its immutable
-- private shards have all been verified. No public route reads orphan shards.
CREATE TABLE source_truth_manifest (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL CHECK (id ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('GIT','DIRECTORY_UPLOAD')),
  file_count numeric(40,0) NOT NULL CHECK (file_count >= 0),
  directory_count numeric(40,0) NOT NULL CHECK (directory_count >= 0),
  known_bytes numeric(40,0) NOT NULL CHECK (known_bytes >= 0),
  shard_count integer NOT NULL CHECK (shard_count >= 0),
  PRIMARY KEY (workspace_id,id)
);

CREATE FUNCTION source_truth_guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM source_truth_run_source s WHERE s.workspace_id=NEW.workspace_id
      AND s.run_id=NEW.run_id AND s.source_id=NEW.source_id AND s.enumeration_closed) THEN
      RAISE EXCEPTION 'Closed source membership is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.disposition IS NOT NULL AND (TG_OP='DELETE' OR NEW.disposition IS DISTINCT FROM OLD.disposition) THEN
    RAISE EXCEPTION 'Terminal source disposition is immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM source_truth_run_source s WHERE s.workspace_id=OLD.workspace_id
    AND s.run_id=OLD.run_id AND s.source_id=OLD.source_id AND s.enumeration_closed) THEN
    IF TG_OP='DELETE' OR NEW.entry IS DISTINCT FROM OLD.entry
      OR NEW.path_bytes IS DISTINCT FROM OLD.path_bytes OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
      RAISE EXCEPTION 'Frozen source entry is immutable';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_frozen_entries BEFORE INSERT OR UPDATE OR DELETE ON source_truth_entry
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_entry();
CREATE TRIGGER source_truth_immutable_manifest BEFORE UPDATE OR DELETE ON source_truth_manifest
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_manifest_shard BEFORE UPDATE OR DELETE ON source_truth_manifest_shard
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
