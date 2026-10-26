-- Separate append-only mappings: neither analysis graphs nor human/execution
-- authority is rewritten when a binding or derived status changes.
CREATE TABLE f003_authority_binding_set (
  workspace_id text NOT NULL REFERENCES project(id),
  graph_revision_id text NOT NULL,
  revision_record_type text NOT NULL DEFAULT 'GRAPH_REVISION' CHECK (revision_record_type='GRAPH_REVISION'),
  object_key text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES principal(id),
  operation_id text NOT NULL,
  request_digest text NOT NULL,
  graph_digest text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,graph_revision_id,object_key,version),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,actor_id,operation_id),
  FOREIGN KEY(workspace_id,revision_record_type,graph_revision_id)
    REFERENCES understanding_record(project_id,record_type,id)
);
CREATE TRIGGER f003_immutable_authority_binding BEFORE UPDATE OR DELETE ON f003_authority_binding_set
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
