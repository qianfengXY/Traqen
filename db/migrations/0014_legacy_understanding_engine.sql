CREATE TABLE understanding_record (
  project_id text NOT NULL REFERENCES project(id),
  record_type text NOT NULL CHECK (record_type IN (
    'ARTIFACT_INVENTORY', 'EXTRACTOR_CAPABILITY', 'UNDERSTANDING_PLAN', 'WORK_UNIT',
    'MODEL_CAPABILITY_PROFILE', 'ANALYSIS_ROUTE_DECISION', 'SOURCE_SLICE',
    'RECONCILIATION', 'EVALUATION_RUN', 'GRAPH_ARTIFACT', 'GRAPH_REVISION',
    'SOURCE_REGISTRATION', 'FACT_BUNDLE', 'CANDIDATE_BUNDLE', 'EVIDENCE_ALLOWSET',
    'GAP', 'WORKSPACE_ANALYSIS_JOB'
  )),
  id text NOT NULL,
  snapshot_manifest_id text,
  analysis_run_id text,
  status text,
  record_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, record_type, id),
  UNIQUE (project_id, id)
);

CREATE INDEX understanding_record_project_type_created_idx
  ON understanding_record(project_id, record_type, created_at DESC, id);

CREATE TABLE current_graph_head (
  project_id text PRIMARY KEY REFERENCES project(id),
  graph_revision_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, graph_revision_id),
  FOREIGN KEY (project_id, graph_revision_id)
    REFERENCES understanding_record(project_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE current_graph_head_event (
  project_id text NOT NULL REFERENCES project(id),
  version bigint NOT NULL,
  graph_revision_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, version)
);

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON current_graph_head_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
