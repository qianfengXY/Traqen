ALTER TABLE understanding_record
  DROP CONSTRAINT IF EXISTS understanding_record_record_type_check;

ALTER TABLE understanding_record
  ADD CONSTRAINT understanding_record_record_type_check CHECK (record_type IN (
    'ARTIFACT_INVENTORY', 'EXTRACTOR_CAPABILITY', 'UNDERSTANDING_PLAN', 'WORK_UNIT',
    'MODEL_CAPABILITY_PROFILE', 'ANALYSIS_ROUTE_DECISION', 'SOURCE_SLICE',
    'RECONCILIATION', 'EVALUATION_RUN', 'GRAPH_ARTIFACT', 'GRAPH_REVISION',
    'SOURCE_REGISTRATION', 'FACT_BUNDLE', 'CANDIDATE_BUNDLE', 'EVIDENCE_ALLOWSET',
    'GAP', 'WORKSPACE_ANALYSIS_JOB', 'WORKSPACE_STATE', 'WORKSPACE_EVENT',
    'WORKSPACE_VIEW_PREFERENCE', 'WORKSPACE_CAPABILITY_CONFIG', 'WORKSPACE_EXECUTION_PROFILE',
    'SECRET_GRANT', 'ANALYSIS_BATCH', 'CHILD_WORK_UNIT', 'CHILD_BATCH_RESULT',
    'BATCH_BARRIER', 'CONFLICT_LEDGER', 'COVERAGE_LEDGER', 'QUARANTINED_CANDIDATE',
    'REVIEW_QUEUE_ITEM', 'REVIEW_BATCH_DECISION', 'FEATURE_HISTORY',
    'SOURCE_SLICE_AUTH_AUDIT', 'INCREMENTAL_PLAN'
  ));

CREATE TABLE source_slice_worker_credential_use (
  project_id text NOT NULL REFERENCES project(id),
  credential_id text NOT NULL,
  analysis_run_id text NOT NULL,
  work_unit_id text NOT NULL,
  route_decision_id text NOT NULL,
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, credential_id)
);

CREATE TRIGGER reject_source_slice_worker_credential_use_mutation
  BEFORE UPDATE OR DELETE ON source_slice_worker_credential_use
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
