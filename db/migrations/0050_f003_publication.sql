-- Analysis checkpoints remain immutable and separate from publication. The
-- existing current_graph_head is the sole current knowledge head.
CREATE TABLE f003_publication_evidence (
  workspace_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('QUALITY','RECOVERY')),
  issuer_id text NOT NULL,
  binding_digest text NOT NULL,
  document jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id)
);
CREATE INDEX f003_evidence_binding ON f003_publication_evidence(workspace_id,binding_digest,evidence_kind);
CREATE TRIGGER f003_immutable_publication_evidence BEFORE UPDATE OR DELETE ON f003_publication_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TABLE f003_publication (
  workspace_id text NOT NULL,
  id text NOT NULL,
  investigation_id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  operation_id text NOT NULL,
  request_digest text NOT NULL,
  graph_revision_id text NOT NULL,
  revision_record_type text NOT NULL DEFAULT 'GRAPH_REVISION' CHECK (revision_record_type='GRAPH_REVISION'),
  head_version bigint NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,actor_id,operation_id),
  UNIQUE (workspace_id,head_version),
  FOREIGN KEY (workspace_id,investigation_id) REFERENCES f003_investigation(workspace_id,id),
  FOREIGN KEY (workspace_id,revision_record_type,graph_revision_id) REFERENCES understanding_record(project_id,record_type,id)
);
CREATE TRIGGER f003_immutable_publication BEFORE UPDATE OR DELETE ON f003_publication
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
