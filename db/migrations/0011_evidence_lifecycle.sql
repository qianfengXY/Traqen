CREATE TABLE evidence_retention_policy (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  policy_payload jsonb NOT NULL CHECK (jsonb_typeof(policy_payload) = 'object'),
  actor_id text NOT NULL REFERENCES principal(id),
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id, version)
);

CREATE TABLE evidence_lifecycle_event (
  project_id text NOT NULL,
  evidence_id text NOT NULL,
  id text NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  action text NOT NULL CHECK (action IN (
    'ARCHIVED', 'LEGAL_HOLD_PLACED', 'LEGAL_HOLD_RELEASED',
    'DELETION_REQUESTED', 'DELETED', 'ACCESSED', 'EXPORTED'
  )),
  event_payload jsonb NOT NULL CHECK (jsonb_typeof(event_payload) = 'object'),
  actor_id text NOT NULL REFERENCES principal(id),
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  occurred_at timestamptz NOT NULL,
  append_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  PRIMARY KEY (project_id, evidence_id, id),
  FOREIGN KEY (project_id, evidence_id) REFERENCES evidence(project_id, id),
  FOREIGN KEY (project_id, policy_id, policy_version)
    REFERENCES evidence_retention_policy(project_id, id, version)
);

CREATE INDEX idx_evidence_lifecycle_event_order
  ON evidence_lifecycle_event(project_id, evidence_id, append_sequence);

CREATE TRIGGER enforce_evidence_policy_actor_tenant
  BEFORE INSERT ON evidence_retention_policy
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_actor_tenant();

CREATE TRIGGER enforce_evidence_event_actor_tenant
  BEFORE INSERT ON evidence_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_actor_tenant();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON evidence_retention_policy
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON evidence_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
