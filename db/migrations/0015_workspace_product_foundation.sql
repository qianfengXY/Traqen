ALTER TABLE current_graph_head
  DROP CONSTRAINT IF EXISTS current_graph_head_project_id_graph_revision_id_fkey;

ALTER TABLE understanding_record
  DROP CONSTRAINT IF EXISTS understanding_record_project_id_id_key;

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
    'REVIEW_QUEUE_ITEM', 'REVIEW_BATCH_DECISION', 'FEATURE_HISTORY'
  ));

CREATE TABLE capability_template_revision (
  kind text NOT NULL CHECK (kind IN ('MODEL', 'SKILL', 'MCP')),
  logical_name text NOT NULL CHECK (btrim(logical_name) <> ''),
  revision integer NOT NULL CHECK (revision > 0),
  id text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (kind, logical_name, revision)
);

CREATE TRIGGER reject_capability_template_mutation
  BEFORE UPDATE OR DELETE ON capability_template_revision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
