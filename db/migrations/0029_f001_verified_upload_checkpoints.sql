CREATE TABLE source_truth_upload_checkpoint (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  path_bytes bytea NOT NULL,
  offset_bytes numeric(40,0) NOT NULL CHECK (offset_bytes >= 0),
  size_bytes numeric(40,0) NOT NULL CHECK (size_bytes > 0),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  chunk_id text NOT NULL CHECK (chunk_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES principal(id),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,source_id,path_bytes,offset_bytes),
  FOREIGN KEY (workspace_id,run_id,source_id,path_bytes)
    REFERENCES source_truth_entry(workspace_id,run_id,source_id,path_bytes)
);
CREATE TRIGGER source_truth_immutable_upload_checkpoint BEFORE UPDATE OR DELETE ON source_truth_upload_checkpoint
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
