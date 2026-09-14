-- Abandonment is an explicit append-only decision, never a mutation of run
-- history or an automatic TTL. Only private upload chunks are releasable.
CREATE TABLE source_truth_staging_release (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id)
);
CREATE TABLE source_truth_chunk_release (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  chunk_id text NOT NULL CHECK (chunk_id ~ '^[0-9a-f]{64}$'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  size_bytes numeric(40,0) NOT NULL CHECK (size_bytes>0),
  decision text NOT NULL CHECK (decision IN ('RELEASE','RETAIN_RUN_REFERENCE','RETAIN_BACKUP_REFERENCE','RETAIN_UNVERIFIED_BACKUP')),
  planned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,chunk_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_staging_release(workspace_id,run_id)
);
CREATE TABLE source_truth_chunk_release_result (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  chunk_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('REMOVED','ALREADY_ABSENT')),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,run_id,chunk_id),
  FOREIGN KEY (workspace_id,run_id,chunk_id) REFERENCES source_truth_chunk_release(workspace_id,run_id,chunk_id)
);
CREATE INDEX source_truth_checkpoint_reference ON source_truth_upload_checkpoint(workspace_id,chunk_id,run_id);
-- Rebuildable indexes of the authenticated target catalogue. Missing completion
-- index means unknown protection, not permission to reclaim.
CREATE TABLE source_truth_backup_object (
  backup_id text NOT NULL REFERENCES source_truth_backup_set(id),
  workspace_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('blobs','chunks')),
  object_id text NOT NULL,
  PRIMARY KEY (backup_id,workspace_id,kind,object_id)
);
CREATE INDEX source_truth_backup_object_reference ON source_truth_backup_object(workspace_id,kind,object_id);
CREATE TABLE source_truth_backup_index_complete (
  backup_id text PRIMARY KEY REFERENCES source_truth_backup_set(id),
  indexed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Older attempts have unknown target provenance. New attempts explicitly mark
-- the durable boundary BEFORE they may write an authenticated completion file.
ALTER TABLE source_truth_backup_attempt ADD COLUMN target_seal_attempted boolean NOT NULL DEFAULT true;
CREATE TRIGGER source_truth_immutable_staging_release BEFORE UPDATE OR DELETE ON source_truth_staging_release
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_chunk_release BEFORE UPDATE OR DELETE ON source_truth_chunk_release
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_chunk_release_result BEFORE UPDATE OR DELETE ON source_truth_chunk_release_result
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_backup_index_complete BEFORE UPDATE OR DELETE ON source_truth_backup_index_complete
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
