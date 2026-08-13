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
    'PROJECT_CAPABILITY_REVISION', 'WORKSPACE_CAPABILITY_DRAFT', 'WORKSPACE_POLICY_REVISION',
    'SECRET_GRANT', 'ANALYSIS_BATCH', 'CHILD_WORK_UNIT', 'CHILD_BATCH_RESULT',
    'BATCH_BARRIER', 'CONFLICT_LEDGER', 'COVERAGE_LEDGER', 'QUARANTINED_CANDIDATE',
    'REVIEW_QUEUE_ITEM', 'REVIEW_BATCH_DECISION', 'FEATURE_HISTORY',
    'SOURCE_SLICE_AUTH_AUDIT', 'INCREMENTAL_PLAN', 'EQUIVALENCE_REPORT',
    'UNDERSTANDING_SEMANTIC_SURFACE', 'INDEPENDENT_ANALYSIS_RUN', 'REVIEWED_MEASUREMENT',
    'MAIN_BATCH_RESULT'
  ));

CREATE TABLE workspace_capability_head (
  project_id text NOT NULL REFERENCES project(id),
  head_key text NOT NULL CHECK (btrim(head_key) <> ''),
  version integer NOT NULL CHECK (version >= 0),
  record_id text,
  PRIMARY KEY (project_id, head_key)
);

INSERT INTO workspace_capability_head (project_id, head_key, version, record_id)
SELECT project_id,
       'PROJECT_CAPABILITY_REVISION:' || (record_payload->>'kind') || ':' || (record_payload->>'normalizedName'),
       (record_payload->>'revision')::integer,
       id
FROM (
  SELECT DISTINCT ON (project_id, record_payload->>'kind', record_payload->>'normalizedName')
         project_id, id, record_payload
  FROM understanding_record
  WHERE record_type = 'PROJECT_CAPABILITY_REVISION'
  ORDER BY project_id, record_payload->>'kind', record_payload->>'normalizedName',
           (record_payload->>'revision')::integer DESC
) latest_project_capability;

INSERT INTO workspace_capability_head (project_id, head_key, version, record_id)
SELECT project_id, 'WORKSPACE_CAPABILITY_DRAFT', (record_payload->>'revision')::integer, id
FROM (
  SELECT DISTINCT ON (project_id) project_id, id, record_payload
  FROM understanding_record
  WHERE record_type = 'WORKSPACE_CAPABILITY_DRAFT'
  ORDER BY project_id, (record_payload->>'revision')::integer DESC
) latest_draft;

INSERT INTO workspace_capability_head (project_id, head_key, version, record_id)
SELECT project_id,
       'WORKSPACE_POLICY_REVISION:' || (record_payload->>'kind'),
       (record_payload->>'revision')::integer,
       id
FROM (
  SELECT DISTINCT ON (project_id, record_payload->>'kind') project_id, id, record_payload
  FROM understanding_record
  WHERE record_type = 'WORKSPACE_POLICY_REVISION'
  ORDER BY project_id, record_payload->>'kind', (record_payload->>'revision')::integer DESC
) latest_policy;
