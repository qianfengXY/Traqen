CREATE TABLE reverse_run_job (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE reverse_run_job_event (
  project_id text NOT NULL,
  job_id text NOT NULL,
  id text NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'STARTED', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL,
  append_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  PRIMARY KEY (project_id, job_id, id),
  FOREIGN KEY (project_id, job_id) REFERENCES reverse_run_job(project_id, id)
);

CREATE INDEX idx_reverse_run_job_event_order
  ON reverse_run_job_event(project_id, job_id, append_sequence);

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON reverse_run_job
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON reverse_run_job_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
