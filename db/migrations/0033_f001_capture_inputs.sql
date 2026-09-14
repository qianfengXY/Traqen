CREATE TABLE source_truth_policy (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL
);
CREATE TABLE source_truth_registration (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('GIT','DIRECTORY_UPLOAD')),
  locator text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,source_id)
);
CREATE TABLE source_truth_resolution (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id,run_id,source_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id)
);
CREATE TABLE source_truth_enumeration_batch (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  batch_id text NOT NULL,
  digest text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (workspace_id,run_id,source_id,batch_id),
  FOREIGN KEY (workspace_id,run_id,source_id) REFERENCES source_truth_run_source(workspace_id,run_id,source_id)
);
CREATE TABLE source_truth_directory_selection (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  manifest_id text NOT NULL CHECK (manifest_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES principal(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,source_id),
  FOREIGN KEY (workspace_id,run_id,source_id) REFERENCES source_truth_run_source(workspace_id,run_id,source_id)
);
CREATE TRIGGER source_truth_immutable_policy BEFORE UPDATE OR DELETE ON source_truth_policy
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_registration BEFORE UPDATE OR DELETE ON source_truth_registration
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_resolution BEFORE UPDATE OR DELETE ON source_truth_resolution
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_enumeration_batch BEFORE UPDATE OR DELETE ON source_truth_enumeration_batch
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_directory_selection BEFORE UPDATE OR DELETE ON source_truth_directory_selection
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
