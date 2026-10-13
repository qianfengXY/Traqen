-- Append-only decisions about one exact Gap of one private candidate. These
-- records do not change component/Bundle identity or erase the missing content.
CREATE TABLE source_truth_gap_acceptance (
  workspace_id text NOT NULL,
  id text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  run_id text NOT NULL,
  candidate_id text NOT NULL CHECK (candidate_id ~ '^[a-f0-9]{64}$'),
  gap_set_id text NOT NULL CHECK (gap_set_id ~ '^[a-f0-9]{64}$'),
  component_id text NOT NULL CHECK (component_id ~ '^[a-f0-9]{64}$'),
  gap_key text NOT NULL CHECK (gap_key ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES principal(id),
  reason text NOT NULL CHECK (length(reason)>0 AND length(reason)<=2000),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id),
  FOREIGN KEY (workspace_id,component_id,gap_key) REFERENCES source_truth_component_gap(workspace_id,component_id,gap_key)
);
CREATE INDEX source_truth_gap_acceptance_latest ON source_truth_gap_acceptance
  (workspace_id,run_id,candidate_id,component_id,gap_key,sequence DESC);
CREATE TABLE source_truth_confirmation_gap_acceptance (
  workspace_id text NOT NULL,
  confirmation_id text NOT NULL,
  acceptance_id text NOT NULL,
  PRIMARY KEY (workspace_id,confirmation_id,acceptance_id),
  FOREIGN KEY (workspace_id,confirmation_id) REFERENCES source_truth_confirmation(workspace_id,id),
  FOREIGN KEY (workspace_id,acceptance_id) REFERENCES source_truth_gap_acceptance(workspace_id,id)
);
CREATE TRIGGER source_truth_immutable_gap_acceptance BEFORE UPDATE OR DELETE ON source_truth_gap_acceptance
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_confirmation_gap_acceptance BEFORE UPDATE OR DELETE ON source_truth_confirmation_gap_acceptance
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
