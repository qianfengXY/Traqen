CREATE TABLE analysis_run_checkpoint (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_GAPS', 'CANCELLED')),
  request_payload jsonb NOT NULL,
  checkpoint_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id)
);

CREATE INDEX analysis_run_checkpoint_project_status_idx
  ON analysis_run_checkpoint(project_id, status, updated_at DESC);

CREATE TABLE analysis_result (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  snapshot_manifest_id text NOT NULL,
  baseline_run_id text,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'COMPLETED_WITH_GAPS')),
  result_payload jsonb NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, snapshot_manifest_id) REFERENCES snapshot_manifest(project_id, id),
  FOREIGN KEY (project_id, baseline_run_id) REFERENCES analysis_result(project_id, id)
);

CREATE INDEX analysis_result_project_completed_idx
  ON analysis_result(project_id, completed_at DESC, id);

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON analysis_result
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
