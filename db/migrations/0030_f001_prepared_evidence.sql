-- Private evidence is not an admitted snapshot. Public readers must join from
-- a published bundle; these completion records alone never grant admission.
CREATE TABLE source_truth_component (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  id text NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
  run_id text NOT NULL,
  source_id text NOT NULL,
  payload jsonb NOT NULL,
  counts jsonb NOT NULL,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,run_id,source_id) REFERENCES source_truth_run_source(workspace_id,run_id,source_id)
);
CREATE TABLE source_truth_component_gap (
  workspace_id text NOT NULL REFERENCES source_truth_workspace(workspace_id),
  component_id text NOT NULL CHECK (component_id ~ '^[a-f0-9]{64}$'),
  gap_key text NOT NULL CHECK (gap_key ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL,
  PRIMARY KEY (workspace_id,component_id,gap_key)
);
CREATE TABLE source_truth_prepared_bundle (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  id text NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  counts jsonb NOT NULL,
  PRIMARY KEY (workspace_id,run_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES source_truth_run(workspace_id,id)
);
CREATE TRIGGER source_truth_immutable_component BEFORE UPDATE OR DELETE ON source_truth_component
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_component_gap BEFORE UPDATE OR DELETE ON source_truth_component_gap
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_truth_immutable_prepared_bundle BEFORE UPDATE OR DELETE ON source_truth_prepared_bundle
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE FUNCTION source_truth_guard_completed_gaps() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_truth_component WHERE workspace_id=NEW.workspace_id AND id=NEW.component_id) THEN
    RAISE EXCEPTION 'Completed component gap membership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_truth_closed_component_gaps BEFORE INSERT ON source_truth_component_gap
  FOR EACH ROW EXECUTE FUNCTION source_truth_guard_completed_gaps();
