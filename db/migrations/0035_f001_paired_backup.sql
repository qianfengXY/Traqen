CREATE TABLE source_truth_backup_attempt (
  id text PRIMARY KEY,
  target_id text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  diagnostic jsonb,
  CHECK ((status='RUNNING') = (finished_at IS NULL))
);
CREATE UNIQUE INDEX source_truth_one_backup ON source_truth_backup_attempt((true)) WHERE status='RUNNING';
CREATE TABLE source_truth_backup_set (
  id text PRIMARY KEY REFERENCES source_truth_backup_attempt(id),
  target_id text NOT NULL,
  payload jsonb NOT NULL,
  completed_at timestamptz NOT NULL
);
-- Query index of the authenticated completion catalogue at the backup target.
-- Rebuilt on restore; never a separately editable coverage boolean.
CREATE TABLE source_truth_backup_member (
  backup_id text NOT NULL,
  workspace_id text NOT NULL,
  bundle_id text NOT NULL,
  receipt_id text NOT NULL,
  PRIMARY KEY (backup_id,workspace_id,bundle_id,receipt_id)
);
CREATE INDEX source_truth_backup_pair ON source_truth_backup_member(workspace_id,bundle_id,receipt_id,backup_id);
CREATE TABLE source_truth_backup_health (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backup_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('VERIFIED','UNAVAILABLE')),
  diagnostic jsonb,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE source_truth_restore_event (
  id text PRIMARY KEY,
  backup_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER source_truth_immutable_backup_set BEFORE UPDATE OR DELETE ON source_truth_backup_set
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_backup_health BEFORE UPDATE OR DELETE ON source_truth_backup_health
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_restore_event BEFORE UPDATE OR DELETE ON source_truth_restore_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
