CREATE TABLE decision_review_case (
  project_id text NOT NULL REFERENCES project(id),
  id text NOT NULL,
  claim_id text NOT NULL,
  claim_version integer NOT NULL CHECK (claim_version > 0),
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  risk text NOT NULL CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  approval_mode text NOT NULL CHECK (approval_mode IN ('SINGLE', 'DUAL', 'BUSINESS_COMPLIANCE', 'BREAK_GLASS')),
  proposed_decision_id text NOT NULL,
  case_payload jsonb NOT NULL CHECK (jsonb_typeof(case_payload) = 'object'),
  proposer_id text NOT NULL REFERENCES principal(id),
  proposer_role text NOT NULL CHECK (btrim(proposer_role) <> ''),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, proposed_decision_id),
  FOREIGN KEY (project_id, claim_id, claim_version) REFERENCES claim(project_id, id, version),
  FOREIGN KEY (project_id, scope_id, scope_version) REFERENCES claim_scope(project_id, id, version),
  CHECK (created_at < expires_at),
  CHECK (risk NOT IN ('HIGH', 'CRITICAL') OR approval_mode <> 'SINGLE'),
  CHECK (approval_mode <> 'BREAK_GLASS' OR risk IN ('HIGH', 'CRITICAL'))
);

CREATE TABLE decision_review_event (
  project_id text NOT NULL,
  case_id text NOT NULL,
  id text NOT NULL,
  action text NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'REVOKE', 'DISPUTE', 'REOPEN', 'POST_REVIEW')),
  actor_id text NOT NULL REFERENCES principal(id),
  actor_role text NOT NULL CHECK (btrim(actor_role) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  event_payload jsonb NOT NULL CHECK (jsonb_typeof(event_payload) = 'object'),
  created_at timestamptz NOT NULL,
  append_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  PRIMARY KEY (project_id, case_id, id),
  FOREIGN KEY (project_id, case_id) REFERENCES decision_review_case(project_id, id)
);

CREATE TABLE decision_review_materialization (
  project_id text NOT NULL,
  case_id text NOT NULL,
  event_id text NOT NULL,
  decision_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, case_id, event_id),
  UNIQUE (project_id, decision_id),
  FOREIGN KEY (project_id, case_id, event_id)
    REFERENCES decision_review_event(project_id, case_id, id),
  FOREIGN KEY (project_id, decision_id) REFERENCES human_decision(project_id, id)
);

CREATE INDEX idx_decision_review_case_claim
  ON decision_review_case(project_id, claim_id, claim_version, created_at DESC);

CREATE INDEX idx_decision_review_event_case
  ON decision_review_event(project_id, case_id, append_sequence);

CREATE TRIGGER enforce_review_case_claim_scope
  BEFORE INSERT ON decision_review_case
  FOR EACH ROW EXECUTE FUNCTION enforce_claim_bound_scope();

CREATE FUNCTION enforce_decision_review_case_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM principal actor
    JOIN project governed_project ON governed_project.tenant_id = actor.tenant_id
    WHERE actor.id = NEW.proposer_id AND governed_project.id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'decision proposer must belong to the project tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_decision_review_event_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM principal actor
    JOIN project governed_project ON governed_project.tenant_id = actor.tenant_id
    WHERE actor.id = NEW.actor_id AND governed_project.id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'decision review actor must belong to the project tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_review_case_tenant
  BEFORE INSERT ON decision_review_case
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_review_case_tenant();

CREATE TRIGGER enforce_review_event_tenant
  BEFORE INSERT ON decision_review_event
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_review_event_tenant();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON decision_review_case
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON decision_review_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER reject_mutation
  BEFORE UPDATE OR DELETE ON decision_review_materialization
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
