ALTER TABLE human_decision
  ADD COLUMN append_sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX uq_human_decision_append_sequence
  ON human_decision(append_sequence);

CREATE INDEX idx_decision_claim_sequence
  ON human_decision(project_id, claim_id, claim_version, append_sequence);

CREATE FUNCTION enforce_claim_bound_scope() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_scope_id text;
  expected_scope_version integer;
BEGIN
  SELECT scope_id, scope_version
    INTO expected_scope_id, expected_scope_version
  FROM claim
  WHERE project_id = NEW.project_id
    AND id = NEW.claim_id
    AND version = NEW.claim_version;

  IF expected_scope_id IS NULL THEN
    RAISE EXCEPTION 'claim version does not exist in project'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.scope_id IS DISTINCT FROM expected_scope_id
     OR NEW.scope_version IS DISTINCT FROM expected_scope_version THEN
    RAISE EXCEPTION 'scope must match the referenced claim version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_decision_claim_scope
  BEFORE INSERT ON human_decision
  FOR EACH ROW EXECUTE FUNCTION enforce_claim_bound_scope();

CREATE TRIGGER enforce_conformance_claim_scope
  BEFORE INSERT ON implementation_conformance
  FOR EACH ROW EXECUTE FUNCTION enforce_claim_bound_scope();

CREATE FUNCTION enforce_decision_actor_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_tenant_id text;
  actor_tenant_id text;
BEGIN
  SELECT tenant_id INTO project_tenant_id
  FROM project
  WHERE id = NEW.project_id;

  SELECT tenant_id INTO actor_tenant_id
  FROM principal
  WHERE id = NEW.actor_id;

  IF project_tenant_id IS NULL OR actor_tenant_id IS NULL THEN
    RAISE EXCEPTION 'project or actor does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF project_tenant_id IS DISTINCT FROM actor_tenant_id THEN
    RAISE EXCEPTION 'decision actor must belong to the project tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_decision_tenant
  BEFORE INSERT ON human_decision
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_actor_tenant();
